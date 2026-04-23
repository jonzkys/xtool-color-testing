"""FastAPI application serving the generate endpoint and (optionally) the built UI."""

from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .deps import get_current_user
from .logging_config import configure_logging
from .security import (
    MaxBodySizeMiddleware,
    RegistrationRateLimiter,
    source_ip,
)
from .schemas import (
    AveragedSwatch,
    BaseParams,
    IngestToPaletteRequest,
    MaterialCreate,
    MaterialResponse,
    MaterialUpdate,
    MobileCheckResponse,
    MobileIdResponse,
    MobileUploadResponse,
    RecentMobileUpload,
    PaletteEntryPatch,
    PaletteEntryResponse,
    PaletteQueryResult,
    PresetCreate,
    PresetResponse,
    PresetUpdate,
    ResultPatch,
    ResultResponse,
    ResultSwatch,
    SvgLayersRequest,
    SvgPreviewRequest,
    SvgPreviewResponse,
    SvgStackRequest,
    TestCreate,
    TestUpdate,
    TestResponse,
    UserMePatch,
    UserRegisterRequest,
    UserResponse,
)
from .svg_converter import svg_stack_to_xcs_bytes
from .svg_layers_converter import (
    svg_layers_to_xcs_bytes,
    svg_preview,
)


def _find_alembic_dir() -> Path | None:
    """Locate the directory containing ``alembic.ini`` + ``alembic/``.

    Checked in order:

    1. ``XCS_GEN_ALEMBIC_DIR`` env override — escape hatch for unusual
       deployment layouts where the code and the migration scripts
       don't sit at a predictable relative offset.
    2. Current working directory — the Dockerfile sets ``WORKDIR=/app``
       and copies ``alembic/`` + ``alembic.ini`` there; the CI runner
       runs pytest from the repo root; local dev usually does too.
    3. Three levels up from this file — works for editable installs
       (``src/xcs_gen_web/app.py`` → repo root).

    Returns ``None`` when nothing matches. Callers decide whether that's
    fatal or a skip.
    """
    import os
    override = os.environ.get("XCS_GEN_ALEMBIC_DIR")
    if override:
        p = Path(override)
        if (p / "alembic.ini").exists() and (p / "alembic").is_dir():
            return p

    cwd = Path.cwd()
    if (cwd / "alembic.ini").exists() and (cwd / "alembic").is_dir():
        return cwd

    try:
        repo_root = Path(__file__).resolve().parents[2]
    except IndexError:
        return None
    if (repo_root / "alembic.ini").exists() and (repo_root / "alembic").is_dir():
        return repo_root

    return None


def _run_migrations() -> None:
    """Run alembic upgrade head.

    Safe to call from multiple concurrent processes on MySQL — wraps
    the upgrade in a ``GET_LOCK`` advisory lock so only one process
    executes the migration at a time; concurrent callers wait, then
    find alembic is already at head and no-op cleanly. SQLite doesn't
    need the guard (single-file DB, not typically multi-process in
    deployment).

    If the alembic scripts can't be located (e.g. the package was
    installed without its accompanying migration directory), the call
    is a no-op with a warning — the operator is expected to have
    migrated the DB out-of-band.
    """
    import logging
    log = logging.getLogger("xcs_gen")

    alembic_root = _find_alembic_dir()
    if alembic_root is None:
        log.warning(
            "auto-migrate is enabled but alembic.ini + alembic/ could not "
            "be located; skipping. Set XCS_GEN_ALEMBIC_DIR to the "
            "directory containing them, or disable with "
            "XCS_GEN_AUTO_MIGRATE=false and run migrations out-of-band.",
        )
        return

    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text
    from .db import db_url

    url = db_url()
    cfg = Config(str(alembic_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(alembic_root / "alembic"))
    # Escape `%` so ConfigParser's interpolation doesn't choke on
    # passwords containing a literal `%` (or URL-encoded %XX bytes).
    # Doubled `%%` collapses back to `%` when alembic reads the value.
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))

    if not url.startswith(("mysql", "mariadb")):
        # SQLite / Postgres / anything else — just run it.
        command.upgrade(cfg, "head")
        return

    # MySQL advisory lock guards concurrent boots. Session-scoped:
    # the lock auto-releases if this connection drops (e.g. the task
    # crashes mid-migration), so a crashed task can't leave the lock
    # wedged. 300s timeout is longer than any realistic migration for
    # this schema but short enough that a truly stuck lock fails the
    # ECS task start rather than hanging forever.
    import logging
    log = logging.getLogger("xcs_gen")
    lock_name = "xcsgen_migrate"
    lock_timeout = 300

    engine = create_engine(url, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            got = conn.execute(
                text("SELECT GET_LOCK(:name, :timeout)"),
                {"name": lock_name, "timeout": lock_timeout},
            ).scalar()
            if got != 1:
                raise RuntimeError(
                    f"could not acquire migration advisory lock {lock_name!r} "
                    f"within {lock_timeout}s — another task is migrating or "
                    "the lock is stuck; aborting to avoid a racing upgrade"
                )
            try:
                log.info("acquired migration lock; running alembic upgrade head")
                command.upgrade(cfg, "head")
                log.info("alembic upgrade head complete")
            finally:
                conn.execute(
                    text("SELECT RELEASE_LOCK(:name)"),
                    {"name": lock_name},
                )
    finally:
        engine.dispose()


def _log_storage_choice(settings: Settings) -> None:
    """One-line announcement at startup so the operator can confirm
    where result photos are going. S3 bucket name is safe to log;
    credentials are never here (boto3's default chain handles auth)."""
    import logging
    log = logging.getLogger("xcs_gen")
    if settings.s3_bucket:
        prefix = f"/{settings.s3_prefix}" if settings.s3_prefix else ""
        log.info(
            "result photos → s3://%s%s (encryption: SSE-S3; "
            "credentials: boto3 default chain)",
            settings.s3_bucket, prefix,
        )
    else:
        from .storage import default_fs_root
        from pathlib import Path
        root = Path(settings.images_dir) if settings.images_dir else default_fs_root()
        log.info("result photos → filesystem at %s", root)


def _warn_about_mysql_charset(url: str) -> None:
    """Log a startup warning when a MySQL URL lacks charset=utf8mb4.

    Without the hint, MySQL falls back to latin1 on older installs and
    quietly truncates non-ASCII material names / notes. The app never
    crashes, it just corrupts text. Surfaced loudly because the
    failure mode is silent."""
    if not url.startswith(("mysql", "mariadb")):
        return
    if "charset=utf8mb4" in url.lower():
        return
    import logging
    logging.getLogger("xcs_gen").warning(
        "XCS_GEN_DB_URL is MySQL/MariaDB but lacks charset=utf8mb4. "
        "Non-ASCII material/test names can be silently corrupted. "
        "Append '?charset=utf8mb4' (or '&charset=utf8mb4' if the URL "
        "already has a querystring)."
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI app.

    ``settings`` can be injected (typically by tests); when ``None`` the
    settings are loaded from the environment with single-user defaults.
    The resolved settings live on ``app.state.settings`` so dependencies
    (``get_current_user``) and route handlers can read them.
    """
    if settings is None:
        settings = Settings.from_env()
    # Configure logging before anything that might log (migrations emit
    # INFO lines; without this call they'd be swallowed).
    configure_logging()
    if settings.auto_migrate:
        _run_migrations()
    # Startup sanity check for common misconfiguration.
    from .db import db_url as _resolved_db_url
    _warn_about_mysql_charset(_resolved_db_url())
    # Pin the image-storage backend so all request handlers see the same
    # resolved settings rather than re-reading env per-call.
    from . import images as _images
    _images.use_storage(settings)
    _log_storage_choice(settings)
    app = FastAPI(title="xcs-gen", version="0.1.0")
    app.state.settings = settings

    # Body-size cap applies to every endpoint. Ordered first so nothing
    # else reads the body before the check.
    app.add_middleware(MaxBodySizeMiddleware, max_bytes=settings.max_upload_bytes)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # Registration rate limiter — shared state so all /register calls
    # from the same IP share a bucket.
    register_limiter = RegistrationRateLimiter(
        per_hour=settings.register_rate_per_hour,
    )
    app.state.register_limiter = register_limiter

    from .security import MobileUploadRateLimiter
    app.state.mobile_upload_limiter = MobileUploadRateLimiter(
        per_hour=settings.mobile_upload_rate_per_hour,
        per_day=settings.mobile_upload_rate_per_day,
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        # Exposes mode so the frontend can adapt its UI (e.g. show a
        # user-id header prompt) without a separate discovery endpoint.
        return {"status": "ok", "mode": settings.mode}

    # User onboarding (alpha bearer-token "auth") ------------------------
    # Registration is the one endpoint that doesn't require a valid key
    # in the header — the caller is claiming one. Everything else uses
    # get_current_user, which validates against the users table.
    from .repositories import users as u_repo
    from .repositories.users import DuplicateKeyError

    @app.post("/api/users/register", response_model=UserResponse, status_code=201)
    async def users_register(
        body: UserRegisterRequest,
        request: Request,
    ) -> UserResponse:
        if settings.mode == "standalone":
            raise HTTPException(
                status_code=400,
                detail="registration is disabled in standalone mode",
            )
        if not u_repo.is_valid_api_key(body.api_key):
            raise HTTPException(
                status_code=400,
                detail="api_key must be 16 url-safe base64 chars",
            )
        # Per-IP rate limit (in-memory leaky bucket). Trips well before
        # the users table fills with junk rows.
        retry_after = await register_limiter.check(source_ip(request))
        if retry_after is not None:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"too many registrations from this address — "
                    f"try again in {retry_after}s"
                ),
                headers={"Retry-After": str(retry_after)},
            )
        try:
            user = u_repo.register(
                api_key=body.api_key,
                first_name=body.first_name.strip(),
            )
        except DuplicateKeyError:
            raise HTTPException(
                status_code=409,
                detail="this key is already claimed — pick another",
            )
        return UserResponse(**user)

    @app.post("/api/me/mobile-id", response_model=MobileIdResponse)
    def me_mobile_id_get_or_create(
        user_id: int = Depends(get_current_user),
    ) -> MobileIdResponse:
        return MobileIdResponse(
            mobile_id=u_repo.get_or_create_mobile_id(user_id),
        )

    @app.post("/api/me/mobile-id/rotate", response_model=MobileIdResponse)
    def me_mobile_id_rotate(
        user_id: int = Depends(get_current_user),
    ) -> MobileIdResponse:
        return MobileIdResponse(
            mobile_id=u_repo.rotate_mobile_id(user_id),
        )

    @app.get("/api/m/{mid}/check", response_model=MobileCheckResponse)
    def mobile_check(mid: str) -> MobileCheckResponse:
        """Resolve a mobile_id to a user's display name. The mobile
        page calls this on load to confirm the link is live and to
        greet the phone-holder by name (so they can verify they're
        about to upload to the right account before they shoot)."""
        user = u_repo.get_by_mobile_id(mid)
        if user is None:
            raise HTTPException(status_code=404, detail="mobile id not found")
        return MobileCheckResponse(
            ok=True, display_name=user.get("first_name") or "you",
        )

    @app.post(
        "/api/m/{mid}/upload",
        response_model=MobileUploadResponse,
        status_code=201,
    )
    async def mobile_upload(
        mid: str,
        request: Request,
        image: UploadFile = File(...),
    ) -> MobileUploadResponse:
        """Unauthenticated upload tied to a mobile_id. Resolves the mid
        to a user, then runs the existing fiducial pipeline and persists
        the result against that user's matching test.

        IMPORTANT: this endpoint MUST NOT consult X-User-Id. The mid is
        the only identity signal accepted here."""
        from .services import capture as capture_service
        from .repositories import results as r_repo
        from . import images, models
        from .db import session_scope

        user = u_repo.get_by_mobile_id(mid)
        if user is None:
            raise HTTPException(status_code=404, detail="mobile id not found")

        limiter = request.app.state.mobile_upload_limiter
        retry = await limiter.check(mid)
        if retry is not None:
            return JSONResponse(
                {"detail": "rate limit exceeded"},
                status_code=429,
                headers={"Retry-After": str(retry)},
            )

        data = await image.read()
        try:
            qr_id, _retest_idx = capture_service.detect_test_id(data)
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))

        from .repositories import tests as t_repo
        t = t_repo.get(qr_id, owner_id=user["id"])
        if t is None:
            # Generic message — the mobile route is unauthenticated
            # beyond the mid, so we deliberately don't echo the test
            # id back or hint that it might exist in another account.
            raise HTTPException(
                status_code=404,
                detail="test not found — it may have been deleted, or the QR is from a different account",
            )

        result = _persist_upload(
            tid=qr_id, spec=t["spec"], data=data, filename=image.filename,
            user_id=user["id"], via="mobile",
        )
        return MobileUploadResponse(
            result_id=result.id, test_id=qr_id, test_name=t["name"],
        )

    @app.get(
        "/api/me/mobile-uploads/recent",
        response_model=list[RecentMobileUpload],
    )
    def me_mobile_uploads_recent(
        since: int = 0,
        user_id: int = Depends(get_current_user),
    ) -> list[RecentMobileUpload]:
        """Polled by the desktop QR dialog. ``since`` is unix seconds —
        the dialog passes the timestamp of the most recent row it has
        already shown."""
        from .repositories import results as r_repo
        from .repositories import tests as t_repo
        rows = r_repo.list_recent_for_user(
            owner_id=user_id, since_unix=since, via="mobile",
        )
        out: list[RecentMobileUpload] = []
        for row in rows:
            t = t_repo.get(row["test_id"], owner_id=user_id)
            if t is None:
                continue
            out.append(RecentMobileUpload(
                result_id=row["id"], test_id=row["test_id"],
                test_name=t["name"], uploaded_at=row["uploaded_at"],
            ))
        return out

    @app.get("/api/me", response_model=UserResponse)
    def users_me(user_id: int = Depends(get_current_user)) -> UserResponse:
        if settings.mode == "standalone":
            # Synthesise a record — no users row exists for the sentinel.
            return UserResponse(
                id=user_id, api_key="", first_name="",
                created_at="", last_seen_at="",
            )
        user = u_repo.get_by_id(user_id)
        if user is None:
            # Shouldn't happen — dep would 401 first — but don't throw 500.
            raise HTTPException(status_code=404, detail="user not found")
        return UserResponse(**user)

    @app.patch("/api/me", response_model=UserResponse)
    def users_me_patch(
        body: UserMePatch, user_id: int = Depends(get_current_user),
    ) -> UserResponse:
        if settings.mode == "standalone":
            raise HTTPException(
                status_code=400,
                detail="profile edits disabled in standalone mode",
            )
        if body.first_name is not None:
            u_repo.update_first_name(user_id, body.first_name.strip())
        user = u_repo.get_by_id(user_id)
        assert user is not None
        return UserResponse(**user)

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

    # /api/svg-detect-layers moved into the frontend as a DOMParser +
    # getComputedStyle walk in web/src/svg/detectLayers.ts — the browser
    # already has the SVG text, so the round-trip through svgelements
    # was pure overhead.

    @app.post("/api/svg-preview", response_model=SvgPreviewResponse)
    def svg_preview_endpoint(request: SvgPreviewRequest) -> SvgPreviewResponse:
        try:
            return svg_preview(request)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # /api/raster-to-svg moved into the frontend as vtracer-wasm. See
    # web/src/tracer/vtracer.ts — no more server CPU burned on per-user
    # tracing, no more network round-trip, and the backend no longer
    # depends on the `vtracer` Python wheel.

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

    # Palette ------------------------------------------------------------
    @app.get("/api/palette", response_model=list[PaletteEntryResponse])
    def palette_list(
        material_id: int | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[PaletteEntryResponse]:
        return [
            PaletteEntryResponse(**e)
            for e in pal_repo.list_all(owner_id=user_id, material_id=material_id)
        ]

    @app.get("/api/palette/query", response_model=list[PaletteQueryResult])
    def palette_query(
        hex: str, limit: int = 5, material_id: int | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[PaletteQueryResult]:
        results = pal_repo.query_by_hex(
            hex, owner_id=user_id, limit=limit, material_id=material_id,
        )
        return [
            PaletteQueryResult(
                entry=PaletteEntryResponse(**r["entry"]),
                delta_e=r["delta_e"],
            )
            for r in results
        ]

    @app.delete("/api/palette/by-test/{test_id}", status_code=204)
    def palette_delete_by_test(
        test_id: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        pal_repo.delete_by_test(test_id, owner_id=user_id)
        return Response(status_code=204)

    @app.delete("/api/palette/{entry_id}", status_code=204)
    def palette_delete(
        entry_id: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        if not pal_repo.delete_entry(entry_id, owner_id=user_id):
            raise HTTPException(status_code=404, detail="entry not found")
        return Response(status_code=204)

    @app.patch("/api/palette/{entry_id}", response_model=PaletteEntryResponse)
    def palette_patch(
        entry_id: int, patch: PaletteEntryPatch,
        user_id: int = Depends(get_current_user),
    ) -> PaletteEntryResponse:
        result = pal_repo.update_notes(entry_id, patch.notes, owner_id=user_id)
        if result is None:
            raise HTTPException(status_code=404, detail="entry not found")
        return PaletteEntryResponse(**result)

    # Materials ----------------------------------------------------------
    @app.post("/api/materials", response_model=MaterialResponse, status_code=201)
    def materials_create(
        body: MaterialCreate, user_id: int = Depends(get_current_user),
    ) -> MaterialResponse:
        return MaterialResponse(**m_repo.create(
            name=body.name, notes=body.notes, owner_id=user_id,
        ))

    @app.get("/api/materials", response_model=list[MaterialResponse])
    def materials_list(
        user_id: int = Depends(get_current_user),
    ) -> list[MaterialResponse]:
        return [MaterialResponse(**m) for m in m_repo.list_all(owner_id=user_id)]

    @app.get("/api/materials/{mid}", response_model=MaterialResponse)
    def materials_get(
        mid: int, user_id: int = Depends(get_current_user),
    ) -> MaterialResponse:
        m = m_repo.get(mid, owner_id=user_id)
        if m is None:
            raise HTTPException(status_code=404, detail="material not found")
        return MaterialResponse(**m)

    @app.patch("/api/materials/{mid}", response_model=MaterialResponse)
    def materials_patch(
        mid: int, body: MaterialUpdate,
        user_id: int = Depends(get_current_user),
    ) -> MaterialResponse:
        if m_repo.get(mid, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="material not found")
        return MaterialResponse(**m_repo.update(
            mid, owner_id=user_id, name=body.name, notes=body.notes,
        ))

    @app.delete("/api/materials/{mid}", status_code=204)
    def materials_delete(
        mid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        try:
            m_repo.delete(mid, owner_id=user_id)
        except InUseError as e:
            raise HTTPException(status_code=409, detail=str(e))
        return Response(status_code=204)

    # Presets ------------------------------------------------------------
    @app.post("/api/presets", response_model=PresetResponse, status_code=201)
    def presets_create(
        body: PresetCreate, user_id: int = Depends(get_current_user),
    ) -> PresetResponse:
        if m_repo.get(body.material_id, owner_id=user_id) is None:
            raise HTTPException(status_code=400, detail="unknown material_id")
        return PresetResponse(**p_repo.create(
            material_id=body.material_id, name=body.name, color=body.color,
            base_params=body.base_params.model_dump(), owner_id=user_id,
        ))

    @app.get("/api/presets", response_model=list[PresetResponse])
    def presets_list(
        material_id: int | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[PresetResponse]:
        rows = (
            p_repo.list_by_material(material_id, owner_id=user_id)
            if material_id is not None
            else p_repo.list_all(owner_id=user_id)
        )
        return [PresetResponse(**p) for p in rows]

    @app.get("/api/presets/{pid}", response_model=PresetResponse)
    def presets_get(
        pid: int, user_id: int = Depends(get_current_user),
    ) -> PresetResponse:
        p = p_repo.get(pid, owner_id=user_id)
        if p is None:
            raise HTTPException(status_code=404, detail="preset not found")
        return PresetResponse(**p)

    @app.patch("/api/presets/{pid}", response_model=PresetResponse)
    def presets_patch(
        pid: int, body: PresetUpdate,
        user_id: int = Depends(get_current_user),
    ) -> PresetResponse:
        if p_repo.get(pid, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="preset not found")
        base_params = body.base_params.model_dump() if body.base_params else None
        return PresetResponse(**p_repo.update(
            pid, owner_id=user_id, name=body.name, color=body.color,
            base_params=base_params,
        ))

    @app.post("/api/presets/{pid}/set-default", status_code=204)
    def presets_set_default(
        pid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        if p_repo.get(pid, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="preset not found")
        p_repo.set_default(pid, owner_id=user_id)
        return Response(status_code=204)

    @app.delete("/api/presets/{pid}", status_code=204)
    def presets_delete(
        pid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        p_repo.delete(pid, owner_id=user_id)
        return Response(status_code=204)

    from .repositories import tests as t_repo
    from .repositories.tests import LockedError

    # Tests --------------------------------------------------------------
    @app.post("/api/tests", response_model=TestResponse, status_code=201)
    def tests_create(
        body: TestCreate, user_id: int = Depends(get_current_user),
    ) -> TestResponse:
        if m_repo.get(body.material_id, owner_id=user_id) is None:
            raise HTTPException(status_code=400, detail="unknown material_id")
        t = t_repo.create(
            name=body.name, material_id=body.material_id,
            spec=body.spec.model_dump(), notes=body.notes,
            owner_id=user_id,
        )
        return TestResponse(**t)

    @app.get("/api/tests", response_model=list[TestResponse])
    def tests_list(
        material_id: int | None = None,
        status: str | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[TestResponse]:
        return [TestResponse(**t) for t in t_repo.list_all(
            owner_id=user_id, material_id=material_id, status=status,
        )]

    @app.get("/api/tests/{tid}", response_model=TestResponse)
    def tests_get(
        tid: int, user_id: int = Depends(get_current_user),
    ) -> TestResponse:
        t = t_repo.get(tid, owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        return TestResponse(**t)

    @app.patch("/api/tests/{tid}", response_model=TestResponse)
    def tests_patch(
        tid: int, body: TestUpdate,
        user_id: int = Depends(get_current_user),
    ) -> TestResponse:
        if t_repo.get(tid, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="test not found")
        # Validate a material reassignment target exists + is owned by
        # the caller before the repo commits it. Keeps a malicious
        # client from reseating the test onto a stranger's material id.
        if body.material_id is not None:
            if m_repo.get(body.material_id, owner_id=user_id) is None:
                raise HTTPException(status_code=400, detail="unknown material_id")
        try:
            t = t_repo.update(
                tid, owner_id=user_id,
                name=body.name, notes=body.notes,
                spec=body.spec.model_dump() if body.spec else None,
                material_id=body.material_id,
            )
        except LockedError as e:
            raise HTTPException(status_code=409, detail=str(e))
        return TestResponse(**t)

    @app.delete("/api/tests/{tid}", status_code=204)
    def tests_delete(
        tid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        if t_repo.get(tid, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="test not found")
        t_repo.soft_delete(tid, owner_id=user_id)
        return Response(status_code=204)

    from .services import xcs as xcs_service

    @app.post("/api/tests/{tid}/generate")
    def tests_generate(
        tid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        t = t_repo.get(tid, owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        body = xcs_service.bytes_for_test(
            test_id=t["id"], name=t["name"],
            material_id=t["material_id"], spec=t["spec"],
            retest_index=t.get("retest_index", 0),
        )
        safe_name = xcs_service._safe_project_name(t["name"], fallback=f"test-{t['id']}")
        return Response(
            content=body,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.xcs"'},
        )

    @app.post("/api/tests/{tid}/retest", response_model=TestResponse)
    def tests_retest(
        tid: int, user_id: int = Depends(get_current_user),
    ) -> TestResponse:
        """Increment the test's retest counter.

        Each call bumps ``retest_index`` by one — the user then hits
        Generate to download an XCS whose QR carries the new number.
        On ingest, the decoded retest_index lands on the result row so
        the variability viz can label per-run history.
        """
        try:
            row = t_repo.bump_retest_index(tid, owner_id=user_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="test not found")
        return TestResponse(**row)

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
            owner_id=r["owner_id"],
            visibility=r["visibility"],
            retest_index=r.get("retest_index", 0),
        )

    def _persist_upload(
        *, tid: int, spec: dict, data: bytes, filename: str | None,
        user_id: int, via: str = "desktop",
    ) -> ResultResponse:
        """Shared tail for both upload routes: run capture against the
        already-read image bytes, persist the result + image, mark test
        tested, and return the ResultResponse. Raises HTTPException(400)
        if the capture fails (e.g. photo doesn't align)."""
        try:
            cap_result = capture_service.run_capture(
                image_bytes=data, test_id=tid, spec=spec,
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))

        suffix = Path(filename or "upload.png").suffix or ".png"
        # Two-step: insert with a placeholder image_path → get id → write file → update path.
        placeholder = r_repo.create(
            test_id=tid,
            image_path="pending",
            image_sha256=images.sha256_hex(data),
            swatches=cap_result.swatches,
            owner_id=user_id,
            via=via,
            retest_index=cap_result.retest_index,
        )
        rec = images.save(test_id=tid, result_id=placeholder["id"],
                          data=data, suffix=suffix)
        with session_scope() as s:
            s.execute(
                models.results.update()
                .where(models.results.c.id == placeholder["id"])
                .values(image_path=rec["path"])
            )
        t_repo.mark_tested_and_lock(tid, owner_id=user_id)
        refreshed = r_repo.get(placeholder["id"], owner_id=user_id)
        return _result_to_response(refreshed)

    @app.post("/api/tests/{tid}/results", response_model=ResultResponse, status_code=201)
    async def results_upload(
        tid: int, image: UploadFile = File(...),
        user_id: int = Depends(get_current_user),
    ) -> ResultResponse:
        t = t_repo.get(tid, owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        data = await image.read()
        return _persist_upload(
            tid=tid, spec=t["spec"], data=data, filename=image.filename,
            user_id=user_id,
        )

    @app.post("/api/results/preflight")
    async def results_upload_preflight(
        image: UploadFile = File(...),
        user_id: int = Depends(get_current_user),
    ) -> dict:
        """Decode the photo's QR and return what test it matches + how
        many results that test already has — without persisting anything.

        The upload modal calls this first so it can warn the user before
        re-processing a test that already has uploads."""
        data = await image.read()
        try:
            qr_id, _retest_idx = capture_service.detect_test_id(data)
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        t = t_repo.get(qr_id, owner_id=user_id)
        if t is None:
            raise HTTPException(
                status_code=404,
                detail=f"QR matches test #{qr_id}, which doesn't exist for you. "
                       f"Was the test deleted, or does it belong to another user?",
            )
        existing = r_repo.list_by_test(qr_id, owner_id=user_id, include_excluded=True)
        return {
            "test_id": qr_id,
            "test_name": t["name"],
            "existing_result_count": len(existing),
        }

    @app.post("/api/results/upload", response_model=ResultResponse, status_code=201)
    async def results_upload_auto(
        image: UploadFile = File(...),
        user_id: int = Depends(get_current_user),
    ) -> ResultResponse:
        """Auto-match upload: read the QR on the photo, route to that test.

        Only the caller's own tests are considered — a QR whose id matches
        another user's test yields 404 (we don't want to silently leak the
        existence of another account's tests)."""
        data = await image.read()
        try:
            qr_id, _retest_idx = capture_service.detect_test_id(data)
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        t = t_repo.get(qr_id, owner_id=user_id)
        if t is None:
            raise HTTPException(
                status_code=404,
                detail=f"QR matches test #{qr_id}, which doesn't exist for you. "
                       f"Was the test deleted, or does it belong to another user?",
            )
        return _persist_upload(
            tid=qr_id, spec=t["spec"], data=data, filename=image.filename,
            user_id=user_id,
        )

    @app.get("/api/tests/{tid}/results", response_model=list[ResultResponse])
    def results_list(
        tid: int, user_id: int = Depends(get_current_user),
    ) -> list[ResultResponse]:
        if t_repo.get(tid, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="test not found")
        return [
            _result_to_response(r)
            for r in r_repo.list_by_test(tid, owner_id=user_id)
        ]

    @app.patch("/api/results/{rid}", response_model=ResultResponse)
    def results_patch(
        rid: int, body: ResultPatch,
        user_id: int = Depends(get_current_user),
    ) -> ResultResponse:
        if r_repo.get(rid, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="result not found")
        if body.excluded is not None:
            r_repo.set_excluded(rid, body.excluded, owner_id=user_id)
        if body.notes is not None:
            r_repo.set_notes(rid, body.notes, owner_id=user_id)
        return _result_to_response(r_repo.get(rid, owner_id=user_id))

    @app.delete("/api/results/{rid}", status_code=204)
    def results_delete(
        rid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        path = r_repo.delete(rid, owner_id=user_id)
        if path is None:
            raise HTTPException(status_code=404, detail="result not found")
        images.delete(path)
        return Response(status_code=204)

    @app.get("/api/results/{rid}/image")
    def results_image(
        rid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        r = r_repo.get(rid, owner_id=user_id)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        data = images.read(r["image_path"])
        return Response(content=data, media_type="image/*")

    @app.get("/api/tests/{tid}/swatches", response_model=list[AveragedSwatch])
    def test_swatches(
        tid: int, user_id: int = Depends(get_current_user),
    ) -> list[AveragedSwatch]:
        if t_repo.get(tid, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="test not found")
        return [
            AveragedSwatch(**s)
            for s in r_repo.averaged_swatches(tid, owner_id=user_id)
        ]

    @app.post("/api/tests/{tid}/ingest-to-palette")
    def tests_ingest_to_palette(
        tid: int, body: IngestToPaletteRequest,
        user_id: int = Depends(get_current_user),
    ) -> dict:
        t = t_repo.get(tid, owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")

        if body.mode == "averaged":
            swatches = r_repo.averaged_swatches(tid, owner_id=user_id)
            source_result_id = None
        else:
            if body.result_id is None:
                raise HTTPException(status_code=400, detail="result_id required for single_result")
            r = r_repo.get(body.result_id, owner_id=user_id)
            if r is None or r["test_id"] != tid:
                raise HTTPException(status_code=400, detail="result_id does not belong to test")
            swatches = r["swatches"]
            source_result_id = r["id"]

        if any(i < 0 or i >= len(swatches) for i in body.swatch_indices):
            raise HTTPException(status_code=400, detail="swatch_indices out of range")
        picked = [swatches[i] for i in body.swatch_indices]

        base = t["spec"]["base_params"]
        x_param = t["spec"]["x_param"]
        y_param = t["spec"].get("y_param")

        payload = []
        for s in picked:
            params = dict(base)
            if s.get("x_value") is not None:
                params[x_param] = s["x_value"]
            if y_param and s.get("y_value") is not None:
                params[y_param] = s["y_value"]
            payload.append({
                "test_id": tid, "material_id": t["material_id"],
                "x_value": s.get("x_value"), "y_value": s.get("y_value"),
                "hex": s["hex"], "sigma": s["sigma"],
                "source": body.mode, "source_result_id": source_result_id,
                "params": params,
            })
        if body.replace_existing:
            ids = pal_repo.replace_for_test(tid, payload, owner_id=user_id)
        else:
            ids = pal_repo.insert_bulk(payload, owner_id=user_id)
        return {"added": len(ids), "ids": ids}

    # Mount built frontend at / if present (optional in dev / tests)
    web_dist = Path(__file__).parent.parent.parent / "web" / "dist"
    if web_dist.exists() and (web_dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="frontend")

    return app


# ASGI entry point for `uvicorn xcs_gen_web.app:app`
app = create_app()
