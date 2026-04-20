"""FastAPI application serving the generate endpoint and (optionally) the built UI."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
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

from .capture_pipeline import (
    DetectionError, decode_image_bytes, detect_qr, warp_to_burn_space,
)
from .capture_sampling import sample_grid
from .converter import project_to_xcs_bytes
from .palette import (
    PaletteEntry,
    append_entries,
    default_palette_path,
    hex_to_lab,
    load_palette,
    query_by_hex,
    save_palette,
)
from .raster_to_svg import RasterTraceOptions, decode_base64_image, png_to_svg
from .schemas import (
    BaseParams,
    CaptureIngestResponse,
    CaptureSwatch,
    DetectedLayer,
    MaterialCreate,
    MaterialResponse,
    MaterialUpdate,
    PaletteEntryPatch,
    PaletteEntryResponse,
    PaletteIngestRequest,
    PaletteIngestResponse,
    PaletteQueryResult,
    PresetCreate,
    PresetResponse,
    PresetUpdate,
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


def _palette_path() -> Path:
    """Resolve the active palette file path, honouring XCS_GEN_PALETTE_PATH for tests."""
    override = os.environ.get("XCS_GEN_PALETTE_PATH")
    return Path(override) if override else default_palette_path()


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
        try:
            img = decode_image_bytes(raw)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"could not decode image: {e}")

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

        # Newer payloads carry the exact grid offset from the QR as ox/oy, and
        # the actual QR edge length as "qs" (when user overrode the default).
        # Older burns fall back to defaults.
        qr_size_mm = float(spec.get("qs", _QR_SIZE_INLINE_MM))
        grid_dict = spec["grid"]
        grid_w = grid_dict["w"]
        grid_h = grid_dict["h"]
        default_offset = qr_size_mm + MARKER_MARGIN_MM
        ox = grid_dict.get("ox", default_offset)
        oy = grid_dict.get("oy", default_offset)

        # grid.h encodes rows * row_height (no inter-row gaps). For wrapped
        # multi-row tests the physical grid extends further than grid.h —
        # the warp canvas has to cover (rows-1)*rs + row_height or else the
        # last row's centre falls off and samples return #000000.
        rows_count = grid_dict.get("rows", 1)
        rs_mm = grid_dict.get("rs")
        if rows_count > 1 and rs_mm is not None:
            row_h_mm = grid_h / rows_count
            actual_grid_h = (rows_count - 1) * rs_mm + row_h_mm
        else:
            actual_grid_h = grid_h

        # Compute the minimal bounding box covering both the QR and the grid.
        # ox/oy may be negative when the QR is on the right or bottom of the
        # grid, so we can't assume burn-space starts at (0, 0).
        min_x = min(0.0, ox)
        max_x = max(qr_size_mm, ox + grid_w)
        min_y = min(0.0, oy)
        max_y = max(qr_size_mm, oy + actual_grid_h)
        burn_size_mm = (max_x - min_x, max_y - min_y)
        qr_origin_mm = (-min_x, -min_y)
        grid_origin_mm = (ox - min_x, oy - min_y)

        warped = warp_to_burn_space(
            img,
            qr_corners_px=qr_corners,
            qr_size_mm=qr_size_mm,
            qr_origin_mm=qr_origin_mm,
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
            # Wrapped single-axis tests need the row count + Y stride so the
            # sampler hits each physical row rather than averaging across them.
            rows=grid_dict.get("rows", 1),
            row_stride_mm=grid_dict.get("rs"),
        )

        b = spec["b"]
        return CaptureIngestResponse(
            test_id=spec["id"],
            kind=spec.get("t", "grid"),
            x_param=x_axis["p"],
            y_param=(y_axis["p"] if y_axis else None),
            material_id=spec.get("m"),
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

    @app.get("/api/palette", response_model=list[PaletteEntryResponse])
    def palette_list(material_id: str | None = None) -> list[PaletteEntryResponse]:
        entries = load_palette(_palette_path())
        if material_id is not None:
            entries = [e for e in entries if e.material_id == material_id]
        return [PaletteEntryResponse(**e.__dict__) for e in entries]

    @app.post("/api/palette/ingest", response_model=PaletteIngestResponse)
    def palette_ingest(req: PaletteIngestRequest) -> PaletteIngestResponse:
        now = datetime.now(timezone.utc).isoformat()
        base = req.base_params.model_dump()
        entries: list[PaletteEntry] = []
        for sw in req.swatches:
            params = dict(base)
            params[req.x_param] = sw.x_value
            if req.y_param and sw.y_value is not None:
                params[req.y_param] = sw.y_value
            entries.append(PaletteEntry(
                id=uuid.uuid4().hex,
                test_id=req.test_id,
                material_id=req.material_id,
                source="upload",
                timestamp=now,
                hex=sw.hex,
                lab=list(hex_to_lab(sw.hex)),
                params=params,
                sigma=sw.sigma,
                notes="",
            ))
        append_entries(_palette_path(), entries)
        return PaletteIngestResponse(added_ids=[e.id for e in entries])

    @app.get("/api/palette/query", response_model=list[PaletteQueryResult])
    def palette_query(
        hex: str, limit: int = 5, material_id: str | None = None,
    ) -> list[PaletteQueryResult]:
        results = query_by_hex(
            _palette_path(), hex, limit=limit, material_id=material_id,
        )
        return [
            PaletteQueryResult(
                entry=PaletteEntryResponse(**r.entry.__dict__),
                delta_e=r.delta_e,
            )
            for r in results
        ]

    @app.delete("/api/palette/by-test/{test_id}", status_code=204)
    def palette_delete_by_test(test_id: str) -> Response:
        path = _palette_path()
        entries = load_palette(path)
        remaining = [e for e in entries if e.test_id != test_id]
        save_palette(path, remaining)
        return Response(status_code=204)

    @app.delete("/api/palette/{entry_id}", status_code=204)
    def palette_delete(entry_id: str) -> Response:
        path = _palette_path()
        entries = load_palette(path)
        remaining = [e for e in entries if e.id != entry_id]
        if len(remaining) == len(entries):
            raise HTTPException(status_code=404, detail="entry not found")
        save_palette(path, remaining)
        return Response(status_code=204)

    @app.patch("/api/palette/{entry_id}", response_model=PaletteEntryResponse)
    def palette_patch(entry_id: str, patch: PaletteEntryPatch) -> PaletteEntryResponse:
        path = _palette_path()
        entries = load_palette(path)
        for e in entries:
            if e.id == entry_id:
                e.notes = patch.notes
                save_palette(path, entries)
                return PaletteEntryResponse(**e.__dict__)
        raise HTTPException(status_code=404, detail="entry not found")

    from .repositories import materials as m_repo
    from .repositories import presets as p_repo
    from .repositories.materials import InUseError

    # Materials
    @app.post("/api/materials", response_model=MaterialResponse, status_code=201)
    def materials_create(body: MaterialCreate) -> MaterialResponse:
        return MaterialResponse(**m_repo.create(name=body.name, notes=body.notes))

    @app.get("/api/materials", response_model=list[MaterialResponse])
    def materials_list() -> list[MaterialResponse]:
        return [MaterialResponse(**m) for m in m_repo.list_all()]

    @app.get("/api/materials/{mid}", response_model=MaterialResponse)
    def materials_get(mid: int) -> MaterialResponse:
        m = m_repo.get(mid)
        if m is None:
            raise HTTPException(status_code=404, detail="material not found")
        return MaterialResponse(**m)

    @app.patch("/api/materials/{mid}", response_model=MaterialResponse)
    def materials_patch(mid: int, body: MaterialUpdate) -> MaterialResponse:
        if m_repo.get(mid) is None:
            raise HTTPException(status_code=404, detail="material not found")
        return MaterialResponse(**m_repo.update(mid, name=body.name, notes=body.notes))

    @app.delete("/api/materials/{mid}", status_code=204)
    def materials_delete(mid: int) -> Response:
        try:
            m_repo.delete(mid)
        except InUseError as e:
            raise HTTPException(status_code=409, detail=str(e))
        return Response(status_code=204)

    # Presets
    @app.post("/api/presets", response_model=PresetResponse, status_code=201)
    def presets_create(body: PresetCreate) -> PresetResponse:
        if m_repo.get(body.material_id) is None:
            raise HTTPException(status_code=400, detail="unknown material_id")
        return PresetResponse(**p_repo.create(
            material_id=body.material_id, name=body.name, color=body.color,
            base_params=body.base_params.model_dump(),
        ))

    @app.get("/api/presets", response_model=list[PresetResponse])
    def presets_list(material_id: int | None = None) -> list[PresetResponse]:
        rows = p_repo.list_by_material(material_id) if material_id else p_repo.list_all()
        return [PresetResponse(**p) for p in rows]

    @app.get("/api/presets/{pid}", response_model=PresetResponse)
    def presets_get(pid: int) -> PresetResponse:
        p = p_repo.get(pid)
        if p is None:
            raise HTTPException(status_code=404, detail="preset not found")
        return PresetResponse(**p)

    @app.patch("/api/presets/{pid}", response_model=PresetResponse)
    def presets_patch(pid: int, body: PresetUpdate) -> PresetResponse:
        if p_repo.get(pid) is None:
            raise HTTPException(status_code=404, detail="preset not found")
        base_params = body.base_params.model_dump() if body.base_params else None
        return PresetResponse(**p_repo.update(
            pid, name=body.name, color=body.color, base_params=base_params,
        ))

    @app.post("/api/presets/{pid}/set-default", status_code=204)
    def presets_set_default(pid: int) -> Response:
        if p_repo.get(pid) is None:
            raise HTTPException(status_code=404, detail="preset not found")
        p_repo.set_default(pid)
        return Response(status_code=204)

    @app.delete("/api/presets/{pid}", status_code=204)
    def presets_delete(pid: int) -> Response:
        p_repo.delete(pid)
        return Response(status_code=204)

    # Mount built frontend at / if present (optional in dev / tests)
    web_dist = Path(__file__).parent.parent.parent / "web" / "dist"
    if web_dist.exists() and (web_dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="frontend")

    return app


# ASGI entry point for `uvicorn xcs_gen_web.app:app`
app = create_app()
