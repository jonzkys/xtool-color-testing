"""FastAPI application serving the generate endpoint and (optionally) the built UI."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from .converter import project_to_xcs_bytes
from .raster_to_svg import RasterTraceOptions, decode_base64_image, png_to_svg
from .schemas import (
    AveragedSwatch,
    BaseParams,
    DetectedLayer,
    MaterialCreate,
    MaterialResponse,
    MaterialUpdate,
    PaletteEntryPatch,
    PaletteEntryResponse,
    PaletteQueryResult,
    PresetCreate,
    PresetResponse,
    PresetUpdate,
    Project,
    RasterToSvgRequest,
    RasterToSvgResponse,
    ResultPatch,
    ResultResponse,
    ResultSwatch,
    SvgDetectRequest,
    SvgLayersRequest,
    SvgPreviewRequest,
    SvgPreviewResponse,
    SvgStackRequest,
    TestCreate,
    TestUpdate,
    TestResponse,
)
from .svg_converter import svg_stack_to_xcs_bytes
from .svg_layers_converter import (
    detect_svg_layers,
    svg_layers_to_xcs_bytes,
    svg_preview,
)


def _run_migrations() -> None:
    from pathlib import Path
    from alembic import command
    from alembic.config import Config
    from .db import db_url
    repo_root = Path(__file__).resolve().parents[2]
    cfg = Config(str(repo_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(repo_root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", db_url())
    command.upgrade(cfg, "head")


def create_app() -> FastAPI:
    _run_migrations()
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

    from .repositories import palette as pal_repo
    from .repositories import materials as m_repo
    from .repositories import presets as p_repo
    from .repositories.materials import InUseError

    # Palette
    @app.get("/api/palette", response_model=list[PaletteEntryResponse])
    def palette_list(material_id: int | None = None) -> list[PaletteEntryResponse]:
        return [PaletteEntryResponse(**e) for e in pal_repo.list_all(material_id=material_id)]

    @app.get("/api/palette/query", response_model=list[PaletteQueryResult])
    def palette_query(
        hex: str, limit: int = 5, material_id: int | None = None,
    ) -> list[PaletteQueryResult]:
        results = pal_repo.query_by_hex(hex, limit=limit, material_id=material_id)
        return [
            PaletteQueryResult(
                entry=PaletteEntryResponse(**r["entry"]),
                delta_e=r["delta_e"],
            )
            for r in results
        ]

    @app.delete("/api/palette/by-test/{test_id}", status_code=204)
    def palette_delete_by_test(test_id: int) -> Response:
        pal_repo.delete_by_test(test_id)
        return Response(status_code=204)

    @app.delete("/api/palette/{entry_id}", status_code=204)
    def palette_delete(entry_id: int) -> Response:
        if not pal_repo.delete_entry(entry_id):
            raise HTTPException(status_code=404, detail="entry not found")
        return Response(status_code=204)

    @app.patch("/api/palette/{entry_id}", response_model=PaletteEntryResponse)
    def palette_patch(entry_id: int, patch: PaletteEntryPatch) -> PaletteEntryResponse:
        result = pal_repo.update_notes(entry_id, patch.notes)
        if result is None:
            raise HTTPException(status_code=404, detail="entry not found")
        return PaletteEntryResponse(**result)

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
        rows = p_repo.list_by_material(material_id) if material_id is not None else p_repo.list_all()
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

    from .repositories import tests as t_repo
    from .repositories.tests import LockedError

    # Tests
    @app.post("/api/tests", response_model=TestResponse, status_code=201)
    def tests_create(body: TestCreate) -> TestResponse:
        if m_repo.get(body.material_id) is None:
            raise HTTPException(status_code=400, detail="unknown material_id")
        t = t_repo.create(
            name=body.name, material_id=body.material_id,
            spec=body.spec.model_dump(), notes=body.notes,
        )
        return TestResponse(**t)

    @app.get("/api/tests", response_model=list[TestResponse])
    def tests_list(material_id: int | None = None,
                   status: str | None = None) -> list[TestResponse]:
        return [TestResponse(**t) for t in t_repo.list_all(
            material_id=material_id, status=status,
        )]

    @app.get("/api/tests/{tid}", response_model=TestResponse)
    def tests_get(tid: int) -> TestResponse:
        t = t_repo.get(tid)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        return TestResponse(**t)

    @app.patch("/api/tests/{tid}", response_model=TestResponse)
    def tests_patch(tid: int, body: TestUpdate) -> TestResponse:
        if t_repo.get(tid) is None:
            raise HTTPException(status_code=404, detail="test not found")
        try:
            t = t_repo.update(
                tid, name=body.name, notes=body.notes,
                spec=body.spec.model_dump() if body.spec else None,
            )
        except LockedError as e:
            raise HTTPException(status_code=409, detail=str(e))
        return TestResponse(**t)

    @app.delete("/api/tests/{tid}", status_code=204)
    def tests_delete(tid: int) -> Response:
        if t_repo.get(tid) is None:
            raise HTTPException(status_code=404, detail="test not found")
        t_repo.soft_delete(tid)
        return Response(status_code=204)

    from .services import xcs as xcs_service

    @app.post("/api/tests/{tid}/generate")
    def tests_generate(tid: int) -> Response:
        t = t_repo.get(tid)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        body = xcs_service.bytes_for_test(
            test_id=t["id"], name=t["name"],
            material_id=t["material_id"], spec=t["spec"],
        )
        safe_name = t["name"].replace("/", "_") or f"test-{t['id']}"
        return Response(
            content=body,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.xcs"'},
        )

    from .services import capture as capture_service
    from .repositories import results as r_repo
    from . import images, models
    from .db import session_scope

    def _result_to_response(r: dict) -> ResultResponse:
        return ResultResponse(
            id=r["id"], test_id=r["test_id"],
            uploaded_at=r["uploaded_at"],
            image_url=f"/api/results/{r['id']}/image",
            image_sha256=r["image_sha256"],
            excluded=r["excluded"], notes=r["notes"],
            swatches=[ResultSwatch(**s) for s in r["swatches"]],
        )

    @app.post("/api/tests/{tid}/results", response_model=ResultResponse, status_code=201)
    async def results_upload(tid: int, image: UploadFile = File(...)) -> ResultResponse:
        t = t_repo.get(tid)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")

        data = await image.read()
        try:
            cap_result = capture_service.run_capture(
                image_bytes=data, test_id=tid, spec=t["spec"],
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))

        suffix = Path(image.filename or "upload.png").suffix or ".png"
        # Two-step: insert with a placeholder image_path → get id → write file → update path.
        placeholder = r_repo.create(
            test_id=tid,
            image_path="pending",
            image_sha256=images.sha256_hex(data),
            swatches=cap_result.swatches,
        )
        rec = images.save(test_id=tid, result_id=placeholder["id"],
                          data=data, suffix=suffix)
        # Write the real path back.
        with session_scope() as s:
            s.execute(
                models.results.update()
                .where(models.results.c.id == placeholder["id"])
                .values(image_path=rec["path"])
            )
        t_repo.mark_tested_and_lock(tid)
        refreshed = r_repo.get(placeholder["id"])
        return _result_to_response(refreshed)

    @app.get("/api/tests/{tid}/results", response_model=list[ResultResponse])
    def results_list(tid: int) -> list[ResultResponse]:
        if t_repo.get(tid) is None:
            raise HTTPException(status_code=404, detail="test not found")
        return [_result_to_response(r) for r in r_repo.list_by_test(tid)]

    @app.patch("/api/results/{rid}", response_model=ResultResponse)
    def results_patch(rid: int, body: ResultPatch) -> ResultResponse:
        if r_repo.get(rid) is None:
            raise HTTPException(status_code=404, detail="result not found")
        if body.excluded is not None:
            r_repo.set_excluded(rid, body.excluded)
        if body.notes is not None:
            r_repo.set_notes(rid, body.notes)
        return _result_to_response(r_repo.get(rid))

    @app.delete("/api/results/{rid}", status_code=204)
    def results_delete(rid: int) -> Response:
        path = r_repo.delete(rid)
        if path is None:
            raise HTTPException(status_code=404, detail="result not found")
        images.delete(path)
        return Response(status_code=204)

    @app.get("/api/results/{rid}/image")
    def results_image(rid: int) -> Response:
        r = r_repo.get(rid)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        data = images.read(r["image_path"])
        return Response(content=data, media_type="image/*")

    @app.get("/api/tests/{tid}/swatches", response_model=list[AveragedSwatch])
    def test_swatches(tid: int) -> list[AveragedSwatch]:
        if t_repo.get(tid) is None:
            raise HTTPException(status_code=404, detail="test not found")
        return [AveragedSwatch(**s) for s in r_repo.averaged_swatches(tid)]

    # Mount built frontend at / if present (optional in dev / tests)
    web_dist = Path(__file__).parent.parent.parent / "web" / "dist"
    if web_dist.exists() and (web_dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="frontend")

    return app


# ASGI entry point for `uvicorn xcs_gen_web.app:app`
app = create_app()
