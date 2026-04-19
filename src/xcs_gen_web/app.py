"""FastAPI application serving the generate endpoint and (optionally) the built UI."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from xcs_gen.capture.layout import (
    MARKER_MARGIN_MM,
    _QR_SIZE_ID_ONLY_MM,
    _QR_SIZE_INLINE_MM,
)
from xcs_gen.capture.qr_payload import PayloadError, decode_payload

from .capture_pipeline import DetectionError, detect_qr, warp_to_burn_space
from .capture_sampling import sample_grid
from .converter import project_to_xcs_bytes
from .raster_to_svg import RasterTraceOptions, decode_base64_image, png_to_svg
from .schemas import (
    BaseParams,
    CaptureIngestResponse,
    CaptureSwatch,
    DetectedLayer,
    Project,
    RasterToSvgRequest,
    RasterToSvgResponse,
    SvgDetectRequest,
    SvgLayersRequest,
    SvgPreviewRequest,
    SvgPreviewResponse,
    SvgStackRequest,
)
from .svg_converter import svg_stack_to_xcs_bytes
from .svg_layers_converter import (
    detect_svg_layers,
    svg_layers_to_xcs_bytes,
    svg_preview,
)


def create_app() -> FastAPI:
    app = FastAPI(title="xcs-gen", version="0.1.0")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/generate")
    def generate(project: Project) -> Response:
        try:
            body = project_to_xcs_bytes(project)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        filename = f"{project.name or 'output'}.xcs"
        return Response(
            content=body,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    @app.post("/api/svg-stack")
    def svg_stack(request: SvgStackRequest) -> Response:
        try:
            body = svg_stack_to_xcs_bytes(request)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        filename = f"{request.name or 'svg-stack'}.xcs"
        return Response(
            content=body,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    @app.post("/api/svg-detect-layers", response_model=list[DetectedLayer])
    def svg_detect(request: SvgDetectRequest) -> list[DetectedLayer]:
        try:
            return detect_svg_layers(request)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/api/svg-preview", response_model=SvgPreviewResponse)
    def svg_preview_endpoint(request: SvgPreviewRequest) -> SvgPreviewResponse:
        try:
            return svg_preview(request)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/api/raster-to-svg", response_model=RasterToSvgResponse)
    def raster_to_svg_endpoint(request: RasterToSvgRequest) -> RasterToSvgResponse:
        try:
            img_bytes, fmt = decode_base64_image(request.image_data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not decode image: {e}")

        try:
            svg = png_to_svg(
                img_bytes, image_format=fmt,
                options=RasterTraceOptions(
                    color_precision=request.color_precision,
                    layer_difference=request.layer_difference,
                    filter_speckle=request.filter_speckle,
                    max_colors=request.max_colors,
                ),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Trace failed: {e}")

        return RasterToSvgResponse(svg=svg)

    @app.post("/api/svg-layers")
    def svg_layers(request: SvgLayersRequest) -> Response:
        try:
            body = svg_layers_to_xcs_bytes(request)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        filename = f"{request.name or 'svg-layers'}.xcs"
        return Response(
            content=body,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    @app.post("/api/capture/ingest", response_model=CaptureIngestResponse)
    async def capture_ingest(image: UploadFile = File(...)) -> CaptureIngestResponse:
        raw = await image.read()
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="could not decode image")

        try:
            qr_text, qr_corners = detect_qr(img)
        except DetectionError as e:
            raise HTTPException(status_code=400, detail=f"QR detection failed: {e}")

        try:
            spec = decode_payload(qr_text)
        except PayloadError as e:
            raise HTTPException(status_code=400, detail=f"QR payload invalid: {e}")

        # Inline QRs carry grid/x/b; id_only QRs only carry the id and need
        # external lookup. The ingest endpoint needs the full spec to sample.
        if "grid" not in spec:
            raise HTTPException(
                status_code=400,
                detail="id_only QR cannot be sampled; re-burn with inline payload",
            )

        # Frame the warp with QR top-left at origin. Newer payloads carry the
        # exact grid offset from the QR as ox/oy. Older burns (before that
        # field was added) fall back to (qr_size + MARKER_MARGIN, qr_size +
        # MARKER_MARGIN) which matches compute_layout()'s placement rule.
        qr_size_mm = _QR_SIZE_INLINE_MM  # id_only already rejected above
        grid_dict = spec["grid"]
        grid_w = grid_dict["w"]
        grid_h = grid_dict["h"]
        default_offset = qr_size_mm + MARKER_MARGIN_MM
        grid_origin_mm = (
            grid_dict.get("ox", default_offset),
            grid_dict.get("oy", default_offset),
        )
        burn_size_mm = (
            grid_origin_mm[0] + grid_w,
            grid_origin_mm[1] + grid_h,
        )

        warped = warp_to_burn_space(
            img,
            qr_corners_px=qr_corners,
            qr_size_mm=qr_size_mm,
            qr_origin_mm=(0.0, 0.0),
            burn_size_mm=burn_size_mm,
            px_per_mm=10.0,
        )

        x_axis = spec["x"]
        y_axis = spec.get("y")
        swatches = sample_grid(
            warped,
            grid_origin_mm=grid_origin_mm,
            grid_size_mm=(grid_w, grid_h),
            px_per_mm=10.0,
            x_param=x_axis["p"],
            x_min=x_axis["min"],
            x_max=x_axis["max"],
            x_steps=x_axis["n"],
            y_param=(y_axis["p"] if y_axis else None),
            y_min=(y_axis["min"] if y_axis else 0.0),
            y_max=(y_axis["max"] if y_axis else 0.0),
            y_steps=(y_axis["n"] if y_axis else 1),
        )

        b = spec["b"]
        return CaptureIngestResponse(
            test_id=spec["id"],
            kind=spec.get("t", "grid"),
            x_param=x_axis["p"],
            y_param=(y_axis["p"] if y_axis else None),
            base_params=BaseParams(
                power=b["p"],
                speed=b["s"],
                frequency=b["f"],
                density=b["d"],
                passes=b["r"],
                pulse_width=b["pw"],
                laser=b["l"],
            ),
            swatches=[CaptureSwatch(**s.__dict__) for s in swatches],
        )

    # Mount built frontend at / if present (optional in dev / tests)
    web_dist = Path(__file__).parent.parent.parent / "web" / "dist"
    if web_dist.exists() and (web_dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="frontend")

    return app


# ASGI entry point for `uvicorn xcs_gen_web.app:app`
app = create_app()
