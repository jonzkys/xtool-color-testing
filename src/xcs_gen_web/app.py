"""FastAPI application serving the generate endpoint and (optionally) the built UI."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from .converter import project_to_xcs_bytes
from .schemas import (
    DetectedLayer,
    Project,
    SvgDetectRequest,
    SvgLayersRequest,
    SvgStackRequest,
)
from .svg_converter import svg_stack_to_xcs_bytes
from .svg_layers_converter import detect_svg_layers, svg_layers_to_xcs_bytes


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

    @app.post("/api/svg-layers")
    def svg_layers(request: SvgLayersRequest) -> Response:
        try:
            body = svg_layers_to_xcs_bytes(request)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        filename = f"{request.name or 'svg-layers'}.xcs"
        return Response(
            content=body,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    # Mount built frontend at / if present (optional in dev / tests)
    web_dist = Path(__file__).parent.parent.parent / "web" / "dist"
    if web_dist.exists() and (web_dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="frontend")

    return app


# ASGI entry point for `uvicorn xcs_gen_web.app:app`
app = create_app()
