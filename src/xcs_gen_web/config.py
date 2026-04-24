"""Runtime settings for xcs-gen.

Two deployment modes:

- ``standalone`` (default) — the historical single-user flow. Every
  request resolves to the reserved user id ``0`` so nothing about the
  experience changes from before multi-user support existed.

- ``multi_user`` — each request must carry a user identifier (by default
  the ``X-User-Id`` header; the value is a 16-char api_key). Data is
  scoped per user: listing materials / tests / palettes only returns
  rows owned by the caller.

Auth (sign-in, token verification, sessions) is deliberately out of
scope at this stage. The header is trusted — a future auth layer will
replace the header read with a real identity check without touching the
rest of the codebase.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal

Mode = Literal["standalone", "multi_user"]

# Reserved sentinel owner_id for standalone deployments. Since user ids
# are autoincrement integers starting at 1, 0 is never issued to a real
# registered user and is unambiguous.
STANDALONE_USER_ID = 0

# Valid visibility values (kept in one place so the CHECK constraint, the
# repo writes, and any future UI stay in sync).
VISIBILITIES = ("private", "public")
DEFAULT_VISIBILITY = "private"

# Upload body cap. 20 MiB comfortably fits a 12-MP phone photo (which
# is what the capture pipeline expects) with headroom; anything bigger
# is almost certainly an abuse/DoS attempt, not a legitimate swatch
# photo. Applied server-wide so every endpoint inherits the limit.
MAX_UPLOAD_BYTES_DEFAULT = 20 * 1024 * 1024  # 20 MiB


@dataclass(frozen=True)
class Settings:
    """Runtime configuration, loaded once at app creation.

    Pass a custom ``Settings`` to ``create_app`` in tests; otherwise
    ``Settings.from_env()`` reads environment variables with sensible
    defaults that preserve the current standalone behaviour.
    """

    mode: Mode = "standalone"
    db_url: str | None = None
    images_dir: str | None = None
    host: str = "127.0.0.1"
    port: int = 4000
    # Header carrying the user id in multi_user mode. Made configurable
    # so reverse proxies can rename it (e.g. behind an auth gateway).
    user_header: str = "X-User-Id"
    # Sentinel id used in standalone mode.
    standalone_user_id: int = STANDALONE_USER_ID
    # Extra allowed-origin URLs for CORS (useful when a multi-user
    # deployment serves the API separately from the frontend).
    cors_origins: tuple[str, ...] = field(default_factory=tuple)
    # Whether to run `alembic upgrade head` automatically on app boot.
    # Default True preserves the zero-config single-user story; public
    # deployments should disable this and run migrations as a separate
    # deploy step so a failed migration doesn't leave the app wedged.
    auto_migrate: bool = True
    # Hard cap on request body size in bytes. Enforced by middleware
    # (see app.py) so upload endpoints don't DoS the host's disk or
    # the capture pipeline.
    max_upload_bytes: int = MAX_UPLOAD_BYTES_DEFAULT
    # How many /api/users/register calls we'll accept from a single
    # source IP per rolling hour. Prevents trivial "fill the users
    # table" spam on public deployments. Disable by setting to 0.
    register_rate_per_hour: int = 20
    # Per-mobile-id caps for /api/m/{mid}/upload. Failed fiducial
    # detections still count against the budget — the work cost is
    # the same. Set either to 0 to disable.
    mobile_upload_rate_per_hour: int = 30
    mobile_upload_rate_per_day: int = 200

    # Image storage ------------------------------------------------------
    # Setting ``s3_bucket`` activates S3 for *new* uploads. Reads transparently
    # dispatch based on the stored path — filesystem paths keep working after
    # a migration to S3, so existing data doesn't need rewriting.
    #
    # boto3 picks up credentials from the default chain (instance profile,
    # ECS task role, Lambda execution role, env vars, ~/.aws/credentials).
    # Never place secrets in the URL or env vars for this app — rely on IAM.
    s3_bucket: str | None = None
    s3_prefix: str = ""                  # key namespace, e.g. "xcsgen-prod/"
    s3_region: str | None = None         # None = let boto3 resolve from env
    s3_endpoint_url: str | None = None   # custom endpoint for MinIO/LocalStack

    # Demo account — read-only impersonation of ``demo_target_user_id``.
    # Set ``demo_api_key`` to the empty string to disable the feature;
    # the middleware short-circuits on empty keys so standalone deploys
    # and tests that don't want a demo key see zero overhead.
    demo_api_key: str = "DEMO"
    demo_target_user_id: int = 1

    @classmethod
    def from_env(cls) -> "Settings":
        mode_raw = os.environ.get("XCS_GEN_MODE", "standalone").strip().lower()
        if mode_raw not in ("standalone", "multi_user"):
            raise ValueError(
                f"XCS_GEN_MODE must be 'standalone' or 'multi_user', got {mode_raw!r}",
            )
        cors_raw = os.environ.get("XCS_GEN_CORS_ORIGINS", "").strip()
        cors_origins = tuple(o.strip() for o in cors_raw.split(",") if o.strip())
        auto_migrate_raw = os.environ.get("XCS_GEN_AUTO_MIGRATE", "true").strip().lower()
        return cls(
            mode=mode_raw,  # type: ignore[arg-type]
            db_url=os.environ.get("XCS_GEN_DB_URL") or None,
            images_dir=os.environ.get("XCS_GEN_IMAGES_DIR") or None,
            host=os.environ.get("XCS_GEN_HOST", "127.0.0.1"),
            port=int(os.environ.get("XCS_GEN_PORT", "4000")),
            user_header=os.environ.get("XCS_GEN_USER_HEADER", "X-User-Id"),
            standalone_user_id=STANDALONE_USER_ID,
            cors_origins=cors_origins,
            auto_migrate=auto_migrate_raw in ("1", "true", "yes", "on"),
            max_upload_bytes=int(
                os.environ.get("XCS_GEN_MAX_UPLOAD_BYTES", str(MAX_UPLOAD_BYTES_DEFAULT)),
            ),
            register_rate_per_hour=int(
                os.environ.get("XCS_GEN_REGISTER_RATE_PER_HOUR", "20"),
            ),
            mobile_upload_rate_per_hour=int(
                os.environ.get("XCS_GEN_MOBILE_UPLOAD_RATE_PER_HOUR", "30")
            ),
            mobile_upload_rate_per_day=int(
                os.environ.get("XCS_GEN_MOBILE_UPLOAD_RATE_PER_DAY", "200")
            ),
            s3_bucket=os.environ.get("XCS_GEN_S3_BUCKET") or None,
            s3_prefix=os.environ.get("XCS_GEN_S3_PREFIX", "").strip("/"),
            s3_region=os.environ.get("XCS_GEN_S3_REGION") or None,
            s3_endpoint_url=os.environ.get("XCS_GEN_S3_ENDPOINT_URL") or None,
            demo_api_key=os.environ.get("XCS_GEN_DEMO_API_KEY", "DEMO"),
            demo_target_user_id=int(
                os.environ.get("XCS_GEN_DEMO_TARGET_USER_ID", "1"),
            ),
        )
