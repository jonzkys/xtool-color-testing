"""FastAPI application serving the generate endpoint and (optionally) the built UI."""

from __future__ import annotations

import math
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
    PaletteEntryCreateManual,
    PaletteEntryPatch,
    PaletteEntryResponse,
    PaletteEntryValidateRequest,
    PaletteQueryResult,
    PaletteValidationStatus,
    PresetCreate,
    PresetResponse,
    PresetUpdate,
    GridLayout,
    ResultPatch,
    ResultResponse,
    ResultSwatch,
    InspectCellResponse,
    SavedSpectrumCreate,
    SavedSpectrumPatch,
    SavedSpectrumResponse,
    SwatchPreviewResponse,
    SvgLayersRequest,
    SvgPreviewRequest,
    SvgPreviewResponse,
    SvgStackRequest,
    TextRegMachineDefault,
    TextRegMaterialDefault,
    TextRegParamsBody,
    TextRegResolveResponse,
    TestCreate,
    TestUpdate,
    TestResponse,
    UserMePatch,
    UserRegisterRequest,
    UserResponse,
    ValidationCellsPatch,
)
from .svg_converter import svg_stack_to_xcs_bytes
from .svg_layers_converter import (
    svg_layers_to_xcs_bytes,
    svg_preview,
)


def _find_changelog_dir() -> Path | None:
    """Locate the ``changelog/`` directory. Mirrors the alembic-dir
    search: env override, cwd, then three levels up from this file
    (editable-install layout)."""
    import os
    override = os.environ.get("XCS_GEN_CHANGELOG_DIR")
    if override:
        p = Path(override)
        if p.is_dir():
            return p
    cwd = Path.cwd()
    if (cwd / "changelog").is_dir():
        return cwd / "changelog"
    try:
        repo_root = Path(__file__).resolve().parents[2]
    except IndexError:
        return None
    if (repo_root / "changelog").is_dir():
        return repo_root / "changelog"
    return None


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
    # Sentry — no-op when XCS_GEN_SENTRY_DSN is unset. Init order: after
    # logging (so the SDK's status line appears), before migrations and
    # routing (so any boot-time exception lands in Sentry too).
    from .sentry import init_sentry
    init_sentry(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.sentry_release,
        traces_sample_rate=settings.sentry_traces_sample_rate,
    )
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

    # Demo write-block runs outermost so a disallowed write is 403'd
    # before any body is read or DB query runs. Disabled when
    # demo_api_key is empty or mode is standalone (standalone ignores
    # the header entirely).
    if settings.mode != "standalone" and settings.demo_api_key:
        from .demo import DemoReadOnlyMiddleware
        app.add_middleware(
            DemoReadOnlyMiddleware,
            demo_api_key=settings.demo_api_key,
            user_header=settings.user_header,
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
    def health() -> dict[str, object]:
        # Exposes mode so the frontend can adapt its UI (e.g. show a
        # user-id header prompt) without a separate discovery endpoint.
        # ``available_machines`` is the cheap-to-fetch list of registry
        # ids so the bootstrap can render the machine switcher without
        # a second round-trip; the full registry comes from /api/machines.
        from xcs_gen.machines import known_ids
        return {
            "status": "ok",
            "mode": settings.mode,
            "available_machines": list(known_ids()),
        }

    @app.get("/api/machines")
    def machines_list() -> dict:
        """Static registry payload — machines + validation profiles.

        Cacheable indefinitely from the frontend's perspective; add an
        ETag header here later if the payload size or request volume
        warrants it. For now, just serialise.
        """
        from dataclasses import asdict
        from xcs_gen.machines import all_machines, PROFILES
        machines_out: list[dict] = []
        for m in all_machines():
            d = asdict(m)
            # Image lives under web/public/machines/. Vite copies it
            # to web/dist/machines/ at build time, where it's served
            # both from the dev backend's SPA mount at "/" and from
            # S3+CloudFront in prod (the deploy syncs web/dist/ → S3).
            # No "/static/" prefix — that path doesn't exist on S3.
            d["image"] = f"/machines/{d['image']}"
            machines_out.append(d)
        return {"machines": machines_out, "profiles": PROFILES}

    # User repo is referenced by the changelog endpoints below for the
    # last-seen tracking, so import it before we define them (the
    # "User onboarding" block below re-binds the same name).
    from .repositories import users as u_repo
    from .repositories.users import DuplicateKeyError  # noqa: F401 - re-imported below

    # Changelog ---------------------------------------------------------
    # Entries live as markdown+frontmatter files under repo-root
    # changelog/. Re-read on every request so adding a file lands
    # without a server restart.
    from . import changelog as _changelog

    changelog_dir = _find_changelog_dir()
    if changelog_dir is not None:
        images_dir = changelog_dir / "images"
        images_dir.mkdir(exist_ok=True)
        # Mounted before the "/" SPA mount so specific paths win.
        app.mount(
            "/changelog-media",
            StaticFiles(directory=str(images_dir)),
            name="changelog-media",
        )

    @app.get("/api/changelog")
    def changelog_list(
        user_id: int = Depends(get_current_user),
    ) -> dict:
        entries = (
            _changelog.load_entries(changelog_dir)
            if changelog_dir is not None else []
        )
        latest = _changelog.latest_id(entries)
        # last_seen is tracked server-side in multi-user mode and
        # client-side (localStorage) in standalone — the endpoint
        # always reports the authoritative value it knows about so
        # the frontend can compute `unseen_count` consistently.
        last_seen: str | None = None
        if settings.mode != "standalone":
            last_seen = u_repo.get_last_seen_change(user_id)
        unseen = 0
        if latest is not None:
            # Count entries strictly newer than last_seen (by id, which
            # sorts correctly because dates prefix it).
            if last_seen is None:
                unseen = len(entries)
            else:
                unseen = sum(1 for e in entries if e.id > last_seen)
        return {
            "entries": [e.to_api() for e in entries],
            "latest_id": latest,
            "last_seen_id": last_seen,
            "unseen_count": unseen,
        }

    @app.post("/api/users/me/seen-changelog")
    def users_me_seen_changelog(
        body: dict,
        user_id: int = Depends(get_current_user),
    ) -> dict:
        if settings.mode == "standalone":
            # Standalone has no users row to update; the frontend
            # tracks last-seen in localStorage and this endpoint is
            # a no-op for interface parity.
            return {"ok": True, "persisted": False}
        entry_id = str(body.get("id", "")).strip()
        if not entry_id:
            raise HTTPException(status_code=400, detail="id is required")
        u_repo.set_last_seen_change(user_id, entry_id)
        return {"ok": True, "persisted": True}

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
            tid=qr_id, spec=capture_service.effective_spec(t),
            data=data, filename=image.filename,
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
    @app.post("/api/palette/manual", response_model=PaletteEntryResponse, status_code=201)
    def palette_create_manual(
        body: PaletteEntryCreateManual,
        user_id: int = Depends(get_current_user),
    ) -> PaletteEntryResponse:
        # Material ownership is enforced indirectly: list_all filters by
        # owner_id, and any read of this entry will be owner-scoped.
        e = pal_repo.create_manual(
            material_id=body.material_id, hex_=body.hex,
            params=body.params, notes=body.notes,
            owner_id=user_id,
            machine_id=body.machine_id,
        )
        return PaletteEntryResponse(**e)

    @app.get("/api/palette", response_model=list[PaletteEntryResponse])
    def palette_list(
        material_id: int | None = None,
        favorites_only: bool = False,
        source: str | None = None,
        machine_id: str | None = None,
        validated_only: bool = False,
        user_id: int = Depends(get_current_user),
    ) -> list[PaletteEntryResponse]:
        """List palette entries scoped to the caller. Filters compose:
        ``validated_only=true`` restricts to entries whose
        ``is_validated`` flag is set, which is what the auto-match
        ``Prefer validated`` toggle on the SVG layers tab uses."""
        return [
            PaletteEntryResponse(**e)
            for e in pal_repo.list_all(
                owner_id=user_id, material_id=material_id,
                favorites_only=favorites_only, source=source,
                machine_id=machine_id,
                validated_only=validated_only,
            )
        ]

    @app.get("/api/palette/query", response_model=list[PaletteQueryResult])
    def palette_query(
        hex: str, limit: int = 5, material_id: int | None = None,
        machine_id: str | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[PaletteQueryResult]:
        results = pal_repo.query_by_hex(
            hex, owner_id=user_id, limit=limit, material_id=material_id,
            machine_id=machine_id,
        )
        return [
            PaletteQueryResult(
                entry=PaletteEntryResponse(**r["entry"]),
                delta_e=r["delta_e"],
            )
            for r in results
        ]

    @app.get(
        "/api/palette/validation-status",
        response_model=list[PaletteValidationStatus],
    )
    def palette_validation_status(
        material_id: int,
        machine_id: str | None = None,
        max_de: float = 5.0,
        user_id: int = Depends(get_current_user),
    ) -> list[PaletteValidationStatus]:
        """Per-palette-entry validation status for a material — drives
        the SVG-Layers tab's "validated colour" badge. ``max_de``
        defaults to 5 (just-perceptible); callers wanting stricter
        confidence can lower it."""
        rows = pal_repo.validation_status_for_material(
            material_id=material_id,
            owner_id=user_id,
            machine_id=machine_id,
            max_de=max_de,
        )
        return [PaletteValidationStatus(**r) for r in rows]

    @app.delete("/api/palette/by-test/{test_id}", status_code=204)
    def palette_delete_by_test(
        test_id: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        pal_repo.delete_by_test(test_id, owner_id=user_id)
        return Response(status_code=204)

    @app.delete("/api/palette/by-material/{material_id}")
    def palette_delete_by_material(
        material_id: int, user_id: int = Depends(get_current_user),
    ) -> dict[str, int]:
        """Wipe every palette entry for a material. Tests, results, and
        the material itself are untouched — re-ingest from the existing
        results when ready. Returns the row count for the toast."""
        deleted = pal_repo.delete_by_material(
            material_id, owner_id=user_id,
        )
        return {"deleted": deleted}

    @app.delete("/api/palette/{entry_id}", status_code=204)
    def palette_delete(
        entry_id: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        if not pal_repo.delete_entry(entry_id, owner_id=user_id):
            raise HTTPException(status_code=404, detail="entry not found")
        return Response(status_code=204)

    @app.post(
        "/api/palette/{entry_id}/validate",
        response_model=PaletteEntryResponse,
    )
    def palette_validate(
        entry_id: int,
        body: PaletteEntryValidateRequest,
        user_id: int = Depends(get_current_user),
    ) -> PaletteEntryResponse:
        """Mark an entry as validated and persist a corrected Lab.

        ``body.validated_lab`` is the burn-mean Lab the caller has
        decided is the authoritative colour — typically the
        cluster-robust mean across a validation test's results, but
        the route accepts any 3-vector so a manual override
        ("trust this measurement") works too. Returns 422 if the
        Lab triple is malformed, 404 if the entry doesn't exist
        (or wrong owner). Re-validation is a refresh.
        """
        if len(body.validated_lab) != 3:
            raise HTTPException(
                status_code=422,
                detail="validated_lab must be a 3-vector (L*, a*, b*)",
            )
        L, a, b = body.validated_lab
        if not all(isinstance(v, (int, float)) for v in (L, a, b)):
            raise HTTPException(
                status_code=422,
                detail="validated_lab values must be numeric",
            )
        result = pal_repo.validate_entry(
            entry_id,
            validated_lab=(float(L), float(a), float(b)),
            validated_test_id=body.validated_test_id,
            run_count=body.run_count,
            owner_id=user_id,
        )
        if result is None:
            raise HTTPException(status_code=404, detail="entry not found")
        return PaletteEntryResponse(**result)

    @app.delete(
        "/api/palette/{entry_id}/validate",
        response_model=PaletteEntryResponse,
    )
    def palette_invalidate(
        entry_id: int,
        user_id: int = Depends(get_current_user),
    ) -> PaletteEntryResponse:
        """Clear the validated state on an entry — flag flips back
        to ``False`` and the validated_* columns reset. The original
        ``lab_*`` is left untouched so the entry remains usable as
        an unvalidated row."""
        result = pal_repo.invalidate_entry(entry_id, owner_id=user_id)
        if result is None:
            raise HTTPException(status_code=404, detail="entry not found")
        return PaletteEntryResponse(**result)

    @app.patch("/api/palette/{entry_id}", response_model=PaletteEntryResponse)
    def palette_patch(
        entry_id: int, patch: PaletteEntryPatch,
        user_id: int = Depends(get_current_user),
    ) -> PaletteEntryResponse:
        wants_recipe_change = (
            patch.hex is not None or patch.material_id is not None or patch.params is not None
        )
        if wants_recipe_change:
            src = pal_repo.get_source(entry_id, owner_id=user_id)
            if src is None:
                raise HTTPException(status_code=404, detail="entry not found")
            if src != "manual":
                raise HTTPException(
                    status_code=409,
                    detail="cannot mutate hex/material_id/params on ingested swatch",
                )
        if patch.favorited is not None:
            fav_result = pal_repo.set_favorited(
                entry_id, patch.favorited, owner_id=user_id,
            )
            if fav_result is None:
                raise HTTPException(status_code=404, detail="entry not found")
        try:
            result = pal_repo.update_entry(
                entry_id,
                hex_=patch.hex, material_id=patch.material_id,
                params=patch.params, notes=patch.notes,
                owner_id=user_id,
            )
        except pal_repo.NotMutableError as exc:
            # Should be unreachable after the pre-flight, but kept as defense
            # in depth in case a future patch field bypasses the gate.
            raise HTTPException(status_code=409, detail=str(exc))
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
            shape=body.shape, diameter_mm=body.diameter_mm,
            width_mm=body.width_mm, height_mm=body.height_mm,
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
        # Forward shape/dimension fields only when the client sent them
        # (model_fields_set) so a PATCH that omits them doesn't clear
        # the stored values. Sending null explicitly clears (the repo
        # uses a sentinel to tell the two cases apart).
        update_kwargs: dict[str, Any] = {
            "name": body.name, "notes": body.notes,
        }
        for field_name in ("shape", "diameter_mm", "width_mm", "height_mm"):
            if field_name in body.model_fields_set:
                update_kwargs[field_name] = getattr(body, field_name)
        return MaterialResponse(**m_repo.update(
            mid, owner_id=user_id, **update_kwargs,
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

    @app.post("/api/materials/{mid}/set-default", status_code=204)
    def materials_set_default(
        mid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        if not m_repo.set_default(mid, owner_id=user_id):
            raise HTTPException(status_code=404, detail="material not found")
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
            machine_id=body.machine_id,
        ))

    @app.get("/api/presets", response_model=list[PresetResponse])
    def presets_list(
        material_id: int | None = None,
        machine_id: str | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[PresetResponse]:
        rows = (
            p_repo.list_by_material(material_id, owner_id=user_id, machine_id=machine_id)
            if material_id is not None
            else p_repo.list_all(owner_id=user_id, machine_id=machine_id)
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

    def _default_mode_for(machine_id: str) -> str:
        """When a request omits mode, pick the most representative mode for the
        machine. F2 Ultra's marquee feature is color engrave; everything else
        defaults to plain engrave."""
        return "color_engrave" if machine_id == "F2Ultra" else "engrave"

    # Tests --------------------------------------------------------------
    @app.post("/api/tests", response_model=TestResponse, status_code=201)
    def tests_create(
        body: TestCreate, user_id: int = Depends(get_current_user),
    ) -> TestResponse:
        if m_repo.get(body.material_id, owner_id=user_id) is None:
            raise HTTPException(status_code=400, detail="unknown material_id")
        # Validate the test's params against the profile selected by
        # (machine_id, mode). Mode lookup falls back to the machine's most
        # representative mode if the spec doesn't carry one — pre-multi-machine
        # specs predate the mode concept; we pick color_engrave for F2 (its
        # marquee feature) and engrave for everything else.
        # NOTE: We strip fields that are not_applicable for the profile
        # (e.g. pulse_width on STANDARD) before validating so that
        # legacy base_params, which always carry those fields, still
        # pass.  Full constraint enforcement is a future tightening pass.
        from xcs_gen.machines import PROFILES, profile_for, ValidationError as ProfileError
        spec_dict = body.spec.model_dump()
        mode = spec_dict.get("base_params", {}).get("mode") or _default_mode_for(body.machine_id)
        try:
            profile_id = profile_for(body.machine_id, mode)
        except KeyError as e:
            raise HTTPException(status_code=422, detail=str(e))
        try:
            from xcs_gen.machines import validate_against_profile
            # Strip not_applicable fields before validation so legacy
            # base_params (which always carry pulse_width) don't fail on
            # machines where the field is irrelevant (e.g. F2Ultra STANDARD).
            profile = PROFILES[profile_id]
            not_applicable = {
                k for k, v in profile.items() if v.get("kind") == "not_applicable"
            }
            params_to_validate = {
                k: v for k, v in spec_dict["base_params"].items()
                if k not in not_applicable
            }
            # Pre-clamp range fields onto [min, max] so legacy
            # base_params from a different machine/mode (eg. freq=125
            # from F2 carried into a saved test loaded on F1, where
            # freq is [30, 60]) snap into the active profile instead
            # of failing the save with a 422. Mirrors the snap-on-load
            # behaviour the stepped/pulse_width path already has —
            # see CLAUDE.md "Pydantic validators snap legacy values".
            range_clamps: dict[str, tuple[object, float]] = {}
            for field_name, constraint in profile.items():
                if constraint.get("kind") != "range":
                    continue
                if field_name not in params_to_validate:
                    continue
                v = params_to_validate[field_name]
                lo, hi = constraint["min"], constraint["max"]
                try:
                    nv = float(v)
                except (TypeError, ValueError):
                    continue
                if not (lo <= nv <= hi):
                    clamped = max(float(lo), min(float(hi), nv))
                    out_v = int(clamped) if isinstance(v, int) else clamped
                    range_clamps[field_name] = (v, out_v)
                    params_to_validate[field_name] = out_v
            result = validate_against_profile(profile_id, params_to_validate)
            # Apply both pre-clamps and any stepped/pulse_width snaps
            # the validator made back onto the spec so we persist the
            # actually-burnable values.
            if range_clamps or result.snapped:
                spec_dict["base_params"].update(result.values)
        except ProfileError as e:
            raise HTTPException(status_code=422, detail={"field": e.field, "message": e.message})
        t = t_repo.create(
            name=body.name, material_id=body.material_id,
            spec=spec_dict, notes=body.notes,
            owner_id=user_id,
            machine_id=body.machine_id,
            kind=body.kind,
        )
        return TestResponse(**t)

    @app.get("/api/tests", response_model=list[TestResponse])
    def tests_list(
        material_id: int | None = None,
        status: str | None = None,
        machine_id: str | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[TestResponse]:
        return [TestResponse(**t) for t in t_repo.list_all(
            owner_id=user_id, material_id=material_id, status=status,
            machine_id=machine_id,
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
            machine_id=t.get("machine_id", "F2Ultra"),
            kind=t.get("kind", "sweep") or "sweep",
            validation_cells=t.get("validation_cells"),
            owner_id=user_id,
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

    from .repositories import validation_cells as vc_repo

    @app.patch("/api/tests/{tid}/validation-cells")
    def tests_patch_validation_cells(
        tid: int,
        body: ValidationCellsPatch,
        user_id: int = Depends(get_current_user),
    ) -> dict:
        """Replace the validation-cell list for a kind=validation test.

        Frontend calls this after the user finishes adjusting picks
        (or after an auto-pick). Cells are stored in the order
        received; the builder iterates them by ``cell_index`` ascending,
        so the frontend is responsible for L*-sorting before posting.
        """
        t = t_repo.get(tid, owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        if t.get("kind") != "validation":
            raise HTTPException(
                status_code=409, detail="test kind is not 'validation'",
            )
        if t.get("locked"):
            raise HTTPException(status_code=409, detail="test is locked")
        vc_repo.replace_for_test(
            test_id=tid,
            cells=[c.model_dump() for c in body.cells],
        )
        return {"ok": True, "count": len(body.cells)}

    from .services import capture as capture_service
    from .services import warped_cache
    from .repositories import results as r_repo
    from . import images, models
    from .db import session_scope

    def _transcode_heic_to_jpeg(raw: bytes) -> bytes:
        """Decode HEIC/HEIF bytes via PIL (with the heif opener
        registered at module load) and re-encode as JPEG. Used to give
        browsers a format they can render inline; the original HEIC
        stays untouched in storage.

        EXIF orientation is honoured so the preview matches what
        ArUco detection saw — without ``exif_transpose`` an iPhone
        portrait photo arrives sideways."""
        import io as _io
        from PIL import Image as _Image, ImageOps as _ImageOps
        img = _Image.open(_io.BytesIO(raw))
        img = _ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        out = _io.BytesIO()
        img.save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue()

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
            missing_markers=r.get("missing_markers", []),
        )

    def _persist_upload(
        *, tid: int, spec: dict, data: bytes, filename: str | None,
        user_id: int, via: str = "desktop",
    ) -> ResultResponse:
        """Shared tail for both upload routes: run capture against the
        already-read image bytes, persist the result + image, mark test
        tested, and return the ResultResponse. Raises HTTPException(400)
        if the capture fails (e.g. photo doesn't align), or 409 if the
        same photo (by SHA-256) has already been uploaded for this test
        — the existing result_id is surfaced so the UI can offer to
        view it instead of re-processing. The user can hard-delete the
        existing result to free the hash for re-upload."""
        sha = images.sha256_hex(data)
        existing = r_repo.find_by_hash_for_test(tid, sha, owner_id=user_id)
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "kind": "duplicate_image",
                    "message": (
                        f"This photo was already uploaded as result "
                        f"#{existing['id']} ({existing['uploaded_at']}). "
                        f"Delete that result first if you want to re-process the same image."
                    ),
                    "existing_result_id": existing["id"],
                    "existing_uploaded_at": existing["uploaded_at"],
                },
            )

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
            image_sha256=sha,
            swatches=cap_result.swatches,
            owner_id=user_id,
            via=via,
            retest_index=cap_result.retest_index,
            missing_markers=cap_result.missing_markers,
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

    @app.post(
        "/api/results/{rid}/reingest",
        response_model=ResultResponse,
    )
    def results_reingest(
        rid: int, user_id: int = Depends(get_current_user),
    ) -> ResultResponse:
        """Re-run the capture pipeline against the result's saved photo.

        Replaces ``swatches_json`` and ``missing_markers_json`` on the
        row using current detection code and the test's current spec.
        Useful after detection improvements, after retest spec edits,
        or when the user wants to verify a previously-flagged result
        is now accurate.
        """
        r = r_repo.get(rid, owner_id=user_id)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        t = t_repo.get(r["test_id"], owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        try:
            data = images.read(r["image_path"])
        except FileNotFoundError:
            raise HTTPException(
                status_code=410,
                detail="source image no longer available — cannot reingest",
            )
        try:
            cap_result = capture_service.run_capture(
                image_bytes=data, test_id=r["test_id"],
                spec=capture_service.effective_spec(t),
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        refreshed = r_repo.replace_capture(
            rid,
            swatches=cap_result.swatches,
            missing_markers=cap_result.missing_markers,
            owner_id=user_id,
        )
        if refreshed is None:
            # Owner check passed in r_repo.get; row should still exist.
            raise HTTPException(status_code=500, detail="reingest write failed")
        return _result_to_response(refreshed)

    @app.get(
        "/api/results/{rid}/swatches/preview",
        response_model=SwatchPreviewResponse,
    )
    def results_swatches_preview(
        rid: int, aggregator: str,
        user_id: int = Depends(get_current_user),
    ) -> SwatchPreviewResponse:
        """Re-aggregate the saved photo with the requested aggregator and
        return the resulting swatches. Does NOT write to the DB. Used by
        the result-detail dialog's aggregator dropdown for live preview.
        """
        from xcs_gen.sampling_aggregators import LEGAL_AGGREGATORS
        if aggregator not in LEGAL_AGGREGATORS:
            raise HTTPException(
                status_code=400,
                detail=f"unknown aggregator: {aggregator!r}; "
                       f"legal values: {list(LEGAL_AGGREGATORS)}",
            )
        r = r_repo.get(rid, owner_id=user_id)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        t = t_repo.get(r["test_id"], owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        try:
            data = images.read(r["image_path"])
        except FileNotFoundError:
            raise HTTPException(
                status_code=410,
                detail="source image no longer available — cannot preview",
            )
        # Re-run the full pipeline with the requested aggregator. We do
        # the full pipeline (decode + detect + warp + sample) rather than
        # just re-aggregating because the warped image isn't persisted.
        # Future optimisation: cache the warped image per result.
        try:
            cap_result = capture_service.run_capture(
                image_bytes=data, test_id=r["test_id"],
                spec={**capture_service.effective_spec(t), "sample_aggregator": aggregator},
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except ValueError as e:
            # aggregate() raises ValueError for unknown aggregator —
            # convert to 400 for the caller.
            raise HTTPException(status_code=400, detail=str(e))

        return SwatchPreviewResponse(
            aggregator=aggregator,
            swatches=[ResultSwatch(**s) for s in cap_result.swatches],
        )

    @app.get(
        "/api/results/{rid}/inspect/{row}/{col}",
        response_model=InspectCellResponse,
    )
    def results_inspect_cell(
        rid: int, row: int, col: int,
        user_id: int = Depends(get_current_user),
    ) -> InspectCellResponse:
        """Return per-cell inspection data: the warped cell crop,
        the sampling-region descriptor, and all 5 aggregators applied
        to that cell. Powers the InspectMatchDialog.
        """
        r = r_repo.get(rid, owner_id=user_id)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        t = t_repo.get(r["test_id"], owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        try:
            data = images.read(r["image_path"])
        except FileNotFoundError:
            raise HTTPException(
                status_code=410,
                detail="source image no longer available — cannot inspect",
            )
        eff_spec = capture_service.effective_spec(t)
        try:
            cap_result = capture_service.run_capture(
                image_bytes=data, test_id=r["test_id"], spec=eff_spec,
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))

        try:
            payload = capture_service.inspect_cell(
                warped=cap_result.warped_image_bgr,
                spec=eff_spec, row=row, col=col,
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return InspectCellResponse(**payload)

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
            tid=tid, spec=capture_service.effective_spec(t),
            data=data, filename=image.filename,
            user_id=user_id,
        )

    @app.post("/api/results/preflight")
    async def results_upload_preflight(
        image: UploadFile = File(...),
        user_id: int = Depends(get_current_user),
    ) -> dict:
        """Decode the photo's QR and return what test it matches + how
        many results that test already has + whether this exact photo
        was uploaded before — without persisting anything.

        The upload modal calls this first so it can warn the user
        before re-processing, and short-circuit duplicate uploads
        without sending the file twice."""
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
        sha = images.sha256_hex(data)
        duplicate = r_repo.find_by_hash_for_test(qr_id, sha, owner_id=user_id)
        return {
            "test_id": qr_id,
            "test_name": t["name"],
            "existing_result_count": len(existing),
            "duplicate_of_result_id": duplicate["id"] if duplicate else None,
            "duplicate_uploaded_at": (
                duplicate["uploaded_at"] if duplicate else None
            ),
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
            tid=qr_id, spec=capture_service.effective_spec(t),
            data=data, filename=image.filename,
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
        # Invalidate the warped sidecar BEFORE deleting the row — once
        # the row is gone we can't look up the cached path. Best-effort.
        warped_cache.invalidate(rid, owner_id=user_id)
        path = r_repo.delete(rid, owner_id=user_id)
        if path is None:
            raise HTTPException(status_code=404, detail="result not found")
        images.delete(path)
        return Response(status_code=204)

    @app.get("/api/results/{rid}/image")
    def results_image(
        rid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        from .storage import content_type_for
        r = r_repo.get(rid, owner_id=user_id)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        data = images.read(r["image_path"])
        suffix = Path(r["image_path"]).suffix.lower()
        # Browsers don't natively decode HEIC/HEIF, so the inline
        # preview on the test page broke for iPhone uploads. Transcode
        # to JPEG on demand. The browser-side cache + the
        # ``Cache-Control`` header below mean a typical session
        # transcodes each image once.
        if suffix in (".heic", ".heif"):
            data = _transcode_heic_to_jpeg(data)
            return Response(
                content=data,
                media_type="image/jpeg",
                headers={"Cache-Control": "private, max-age=3600"},
            )
        # ``image/*`` is a wildcard only valid in Accept headers, not a real
        # Content-Type — browsers that MIME-sniff strictly (e.g. Safari
        # cross-origin) refuse to render it. Derive the real type from the
        # stored file's suffix so every browser displays the image.
        return Response(content=data, media_type=content_type_for(suffix))

    def _warped_or_http(rid: int, user_id: int):
        """Adapt :mod:`warped_cache` exceptions to FastAPI HTTP errors.
        Returns ``(warped_bgr, test, result)``. The cache transparently
        handles the slow first-call path and the fast cached path."""
        try:
            return warped_cache.get_warped_bgr(rid, owner_id=user_id)
        except warped_cache.CacheError as e:
            # Source-missing cases (deleted photo etc.) collapse to 410
            # — same posture as the previous _capture_or_410 helper.
            msg = str(e)
            if msg in ("result not found", "test not found"):
                raise HTTPException(status_code=404, detail=msg)
            raise HTTPException(status_code=410, detail=msg)
        except warped_cache.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/api/results/{rid}/grid-layout", response_model=GridLayout)
    def results_grid_layout(
        rid: int, user_id: int = Depends(get_current_user),
    ) -> GridLayout:
        """Pixel-space cell geometry — drives the cell-inspector
        overlay's mouse → cell math. Pure function of the result's
        TestSpec, no I/O on the warped image, so this is cheap and
        works for every historical result."""
        r = r_repo.get(rid, owner_id=user_id)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        t = t_repo.get(r["test_id"], owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        payload = capture_service.grid_layout_payload(capture_service.effective_spec(t))
        return GridLayout(**payload)

    @app.get("/api/results/{rid}/warped-image")
    def results_warped_image(
        rid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        """Cached PNG of the rectified burn-space image. First request
        runs the capture pipeline + writes a sidecar; subsequent
        requests stream the cached PNG."""
        try:
            png = warped_cache.get_warped_png(rid, owner_id=user_id)
        except warped_cache.CacheError as e:
            msg = str(e)
            if msg in ("result not found", "test not found"):
                raise HTTPException(status_code=404, detail=msg)
            raise HTTPException(status_code=410, detail=msg)
        except warped_cache.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return Response(content=png, media_type="image/png")

    @app.get("/api/results/{rid}/debug/warped-with-grid")
    def results_debug_warped_with_grid(
        rid: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        """Warped image with cell rectangles + sample dots overlaid and
        a small parameter title strip. Powers the result-debug modal."""
        warped_bgr, t, _ = _warped_or_http(rid, user_id)
        try:
            png = capture_service.render_warped_with_grid(
                warped_bgr, capture_service.effective_spec(t),
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return Response(content=png, media_type="image/png")

    @app.get("/api/results/{rid}/debug/row-count")
    def results_debug_row_count(
        rid: int, user_id: int = Depends(get_current_user),
    ) -> dict:
        """Number of physical grid rows in the result's test — the
        debug modal uses this to know how many per-row strips to fetch.
        Pure spec metadata, no capture pipeline."""
        r = r_repo.get(rid, owner_id=user_id)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        t = t_repo.get(r["test_id"], owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        return {"rows": capture_service.grid_row_count(capture_service.effective_spec(t))}

    @app.get("/api/results/{rid}/debug/row/{row}")
    def results_debug_row(
        rid: int, row: int, user_id: int = Depends(get_current_user),
    ) -> Response:
        """One row's actual-vs-captured strip."""
        warped_bgr, t, r = _warped_or_http(rid, user_id)
        try:
            png = capture_service.render_row_strip(
                warped_bgr, capture_service.effective_spec(t), r["swatches"], row,
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return Response(content=png, media_type="image/png")

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
        # Test-level angle behaviour determines the actual stroke count
        # and pattern for every cell — without it stored, a palette entry
        # can't be reproduced (a "fixed x2" colour is not a "crosshatch x2"
        # colour). Persist alongside the per-cell params dict; legacy
        # ``angle_mode="crosshatch"`` is snapped at write time too.
        spec_angle_mode = t["spec"].get("angle_mode", "fixed")
        spec_crosshatch = bool(t["spec"].get("crosshatch", False))
        if spec_angle_mode == "crosshatch":
            spec_angle_mode = "fixed"
            spec_crosshatch = True

        # Validation tests don't sweep an axis — every cell carries its
        # own frozen params. ``swatch.x_value`` is the cell index (the
        # capture sampler uses x_min=0, x_max=cell_count-1), so the
        # sweep-style `params[x_param] = x_value` projection writes
        # nonsense values like power=N for cell N. Build an index from
        # validation_cells so we can reach in for the actual params
        # the burn used. ``cells_per_row`` is set by the picker;
        # fallback derives it from x_steps / rows so older validation
        # tests created before the column existed still work.
        is_validation = (t.get("kind") or "sweep") == "validation"
        validation_cells = t.get("validation_cells") or []
        cells_per_row: int | None = None
        if is_validation:
            cells_per_row = t["spec"].get("cells_per_row")
            if not cells_per_row or cells_per_row <= 0:
                rows = max(1, t["spec"].get("rows") or 1)
                cell_count = max(1, len(validation_cells))
                cells_per_row = max(1, math.ceil(cell_count / rows))
        validation_by_index: dict[int, dict] = {
            int(vc["cell_index"]): vc for vc in validation_cells
        }

        payload = []
        for s in picked:
            params = dict(base)
            params["angle_mode"] = spec_angle_mode
            params["crosshatch"] = spec_crosshatch
            if is_validation and cells_per_row:
                # Match swatch (row, col) → cell_index → frozen params.
                # `swatch.x_value` for validation tests is itself the
                # cell index because of the bytes_for_test override —
                # but we round-trip through (row, col) anyway so older
                # results that lack the override still resolve cleanly.
                cell_idx = int(s["row"]) * cells_per_row + int(s["col"])
                vc = validation_by_index.get(cell_idx)
                if vc is not None:
                    # Override with the cell's frozen params; this is
                    # the only truth-source for what was actually burned.
                    # Filter ``None`` values so legacy `mode: null`
                    # entries don't poison new palette rows.
                    for k, v in (vc.get("params") or {}).items():
                        if v is not None:
                            params[k] = v
            else:
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
                "machine_id": t.get("machine_id", "F2Ultra"),
            })
        if body.replace_existing:
            ids = pal_repo.replace_for_test(tid, payload, owner_id=user_id)
        else:
            ids = pal_repo.insert_bulk(payload, owner_id=user_id)
        return {"added": len(ids), "ids": ids}

    from .repositories import saved_spectrums as ss_repo

    # ── Saved spectrums (stage 1: store + list, no predictor yet) ──

    @app.post(
        "/api/spectrums",
        response_model=SavedSpectrumResponse,
        status_code=201,
    )
    def saved_spectrums_create(
        body: SavedSpectrumCreate,
        user_id: int = Depends(get_current_user),
    ) -> SavedSpectrumResponse:
        # Pydantic guarantees fit_degree ∈ {1,2,3}, but it doesn't check
        # that each channel's coefficient list is the right length —
        # enforce here.
        for channel in ("l", "a", "b"):
            coeffs = body.fit_coefficients.get(channel)
            if coeffs is None or len(coeffs) != body.fit_degree + 1:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"fit_coefficients[{channel!r}] must have length "
                        f"{body.fit_degree + 1} for fit_degree={body.fit_degree}"
                    ),
                )

        try:
            rec = ss_repo.create(
                body.model_dump(),
                owner_id=user_id,
            )
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return SavedSpectrumResponse(**rec)

    @app.get(
        "/api/spectrums",
        response_model=list[SavedSpectrumResponse],
    )
    def saved_spectrums_list(
        request: Request,
        material_id: int | None = None,
        min_r2: float | None = None,
        source_test_id: int | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[SavedSpectrumResponse]:
        machine_id = request.headers.get("X-Machine-Id", "F2Ultra")
        rows = ss_repo.list_(
            machine_id=machine_id,
            material_id=material_id,
            min_r2=min_r2,
            source_test_id=source_test_id,
            owner_id=user_id,
        )
        return [SavedSpectrumResponse(**r) for r in rows]

    @app.get(
        "/api/spectrums/{spectrum_id}",
        response_model=SavedSpectrumResponse,
    )
    def saved_spectrums_get(
        spectrum_id: int,
        user_id: int = Depends(get_current_user),
    ) -> SavedSpectrumResponse:
        rec = ss_repo.get(spectrum_id)
        if rec is None or rec["owner_id"] != user_id:
            raise HTTPException(status_code=404, detail="saved spectrum not found")
        return SavedSpectrumResponse(**rec)

    @app.patch(
        "/api/spectrums/{spectrum_id}",
        response_model=SavedSpectrumResponse,
    )
    def saved_spectrums_patch(
        spectrum_id: int,
        patch_body: SavedSpectrumPatch,
        user_id: int = Depends(get_current_user),
    ) -> SavedSpectrumResponse:
        existing = ss_repo.get(spectrum_id)
        if existing is None or existing["owner_id"] != user_id:
            raise HTTPException(status_code=404, detail="saved spectrum not found")
        updated = ss_repo.patch(
            spectrum_id, patch_body.model_dump(exclude_none=True)
        )
        # patch returns None only if the row vanished mid-call.
        if updated is None:
            raise HTTPException(status_code=404, detail="saved spectrum not found")
        return SavedSpectrumResponse(**updated)

    @app.delete(
        "/api/spectrums/{spectrum_id}",
        status_code=204,
    )
    def saved_spectrums_delete(
        spectrum_id: int,
        user_id: int = Depends(get_current_user),
    ) -> Response:
        existing = ss_repo.get(spectrum_id)
        if existing is None or existing["owner_id"] != user_id:
            raise HTTPException(status_code=404, detail="saved spectrum not found")
        ss_repo.delete(spectrum_id)
        return Response(status_code=204)

    # ── Text/registration default ProcessingParams ───────────────────────────
    #
    # These power QR + ArUco fiducials, axis ticks, axis labels, and
    # the summary text strip. Two endpoints write (machine vs material
    # level), one resolves the effective triple back for the caller +
    # tags which level it came from so the UI can surface "from material"
    # vs "from machine" vs "built-in fallback".

    from .repositories import text_reg_defaults as treg_repo
    from xcs_gen.generators import _DEFAULT_ANNOTATION_PARAMS

    @app.get(
        "/api/text-registration-defaults/resolve",
        response_model=TextRegResolveResponse,
    )
    def text_reg_resolve(
        machine_id: str,
        material_id: int | None = None,
        user_id: int = Depends(get_current_user),
    ) -> TextRegResolveResponse:
        """Effective annotation params for ``(machine, material)`` plus
        a ``source`` tag describing which layer they came from. Mirrors
        the resolver the converter uses at burn time."""
        # Try material first to get the precise source label, then fall
        # back to machine, then to the renderer's built-in constants.
        if material_id is not None:
            material_row = treg_repo.get_material(
                owner_id=user_id, machine_id=machine_id,
                material_id=material_id,
            )
            if material_row is not None:
                return TextRegResolveResponse(
                    speed=material_row["speed"],
                    power=material_row["power"],
                    density=material_row["density"],
                    repeat=material_row["repeat"],
                    pulse_width=material_row["pulse_width"],
                    mopa_frequency=material_row["mopa_frequency"],
                    processing_light_source=material_row["processing_light_source"],
                    source="material",
                )
        machine_row = treg_repo.get_machine(
            owner_id=user_id, machine_id=machine_id,
        )
        if machine_row is not None:
            return TextRegResolveResponse(
                speed=machine_row["speed"],
                power=machine_row["power"],
                density=machine_row["density"],
                repeat=machine_row["repeat"],
                pulse_width=machine_row["pulse_width"],
                mopa_frequency=machine_row["mopa_frequency"],
                processing_light_source=machine_row["processing_light_source"],
                source="machine",
            )
        fb = _DEFAULT_ANNOTATION_PARAMS
        return TextRegResolveResponse(
            speed=fb.speed,
            power=fb.power,
            density=fb.density,
            repeat=fb.repeat,
            pulse_width=fb.pulse_width,
            mopa_frequency=fb.mopa_frequency,
            processing_light_source=fb.processing_light_source,
            source="fallback",
        )

    @app.get(
        "/api/text-registration-defaults/machine/{machine_id}",
        response_model=TextRegMachineDefault | None,
    )
    def text_reg_machine_get(
        machine_id: str, user_id: int = Depends(get_current_user),
    ) -> TextRegMachineDefault | None:
        row = treg_repo.get_machine(owner_id=user_id, machine_id=machine_id)
        return TextRegMachineDefault(**row) if row else None

    @app.put(
        "/api/text-registration-defaults/machine/{machine_id}",
        response_model=TextRegMachineDefault,
    )
    def text_reg_machine_put(
        machine_id: str,
        body: TextRegParamsBody,
        user_id: int = Depends(get_current_user),
    ) -> TextRegMachineDefault:
        row = treg_repo.upsert_machine(
            owner_id=user_id, machine_id=machine_id,
            params=body.model_dump(),
        )
        return TextRegMachineDefault(**row)

    @app.delete(
        "/api/text-registration-defaults/machine/{machine_id}",
        status_code=204,
    )
    def text_reg_machine_delete(
        machine_id: str, user_id: int = Depends(get_current_user),
    ) -> Response:
        treg_repo.delete_machine(owner_id=user_id, machine_id=machine_id)
        return Response(status_code=204)

    @app.get(
        "/api/text-registration-defaults/material/{material_id}",
        response_model=list[TextRegMaterialDefault],
    )
    def text_reg_material_list(
        material_id: int, user_id: int = Depends(get_current_user),
    ) -> list[TextRegMaterialDefault]:
        """Every per-machine override the user has for this material —
        powers the Library page's "Text & Registration" cards."""
        # Material visibility check: only the owner's material row is
        # walked. The repo already scopes by owner_id, but we 404 here
        # if the material itself doesn't exist for this user so the
        # caller gets a precise error.
        if m_repo.get(material_id, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="material not found")
        return [
            TextRegMaterialDefault(**r)
            for r in treg_repo.list_for_material(
                owner_id=user_id, material_id=material_id,
            )
        ]

    @app.put(
        "/api/text-registration-defaults/material/{material_id}/{machine_id}",
        response_model=TextRegMaterialDefault,
    )
    def text_reg_material_put(
        material_id: int, machine_id: str,
        body: TextRegParamsBody,
        user_id: int = Depends(get_current_user),
    ) -> TextRegMaterialDefault:
        if m_repo.get(material_id, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="material not found")
        row = treg_repo.upsert_material(
            owner_id=user_id, machine_id=machine_id,
            material_id=material_id, params=body.model_dump(),
        )
        return TextRegMaterialDefault(**row)

    @app.delete(
        "/api/text-registration-defaults/material/{material_id}/{machine_id}",
        status_code=204,
    )
    def text_reg_material_delete(
        material_id: int, machine_id: str,
        user_id: int = Depends(get_current_user),
    ) -> Response:
        if m_repo.get(material_id, owner_id=user_id) is None:
            raise HTTPException(status_code=404, detail="material not found")
        treg_repo.delete_material(
            owner_id=user_id, machine_id=machine_id, material_id=material_id,
        )
        return Response(status_code=204)

    # Per-machine product images live under web/public/machines/. Vite
    # copies them to web/dist/machines/ at build time, so they're served
    # by the dev backend's SPA mount at "/" and by S3+CloudFront in
    # prod (the deploy syncs web/dist/ → S3). No backend-side static
    # mount needed; the URL contract from /api/machines is
    # /machines/<file>.png.

    # Mount built frontend at / if present (optional in dev / tests)
    web_dist = Path(__file__).parent.parent.parent / "web" / "dist"
    if web_dist.exists() and (web_dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="frontend")

    return app


# ASGI entry point for `uvicorn xcs_gen_web.app:app`
app = create_app()
