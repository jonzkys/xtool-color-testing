# syntax=docker/dockerfile:1.6
#
# xcs-gen API image.
#
# Two-stage build: ``builder`` creates a venv with the package + mysql
# + s3 extras pre-installed; ``runtime`` carries only the venv and the
# runtime system libraries (no gcc, no headers, no pip cache).
#
# The frontend (web/dist) is NOT included — in the ECS + S3 deployment
# the static bundle is served from CloudFront. Single-host deployments
# that still want the single-container setup should run `npm run build`
# and COPY web/dist manually (or use the legacy standalone pip install).

# ---------------------------------------------------------------------
# Stage 1 — builder: resolve and install Python deps into a venv.
# ---------------------------------------------------------------------
FROM python:3.12-slim AS builder

# Build-only deps. Kept out of the runtime image so the final size
# stays small.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy pyproject first so the pip install layer caches across source
# edits — only invalidates when dependencies change.
COPY pyproject.toml ./
COPY src ./src

RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir ".[mysql,s3]"


# ---------------------------------------------------------------------
# Stage 2 — runtime: slim image with only the venv + system libs.
# ---------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# Runtime-only system libraries:
#   libzbar0 — pyzbar ctypes binding for QR decoding
#   libgomp1 — OpenMP runtime that OpenCV wheels link against
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libzbar0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Pull the pre-installed venv across — one layer, no second resolve.
COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# Everything the app needs at runtime. alembic/ must be present so the
# one-shot migration task can find the migration scripts.
COPY src ./src
COPY alembic ./alembic
COPY alembic.ini ./
# changelog/ is read at request time by /api/changelog. Without this
# COPY the prod container has no entries to serve regardless of which
# .md files are in the repo.
COPY changelog ./changelog

# Non-root execution. The image should have no reason to escalate.
RUN useradd --create-home --shell /bin/bash --uid 10001 xcsgen \
    && chown -R xcsgen:xcsgen /app
USER xcsgen

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Container default is OFF for migrations. Auto-migrate on boot is
    # convenient for dev but a foot-gun in prod on MySQL — with no
    # transactional DDL, any interruption (ECS health-check timeout
    # while uvicorn isn't yet listening, OOM, rolling-deploy cancel)
    # leaves the schema half-built and unrecoverable without manual
    # stamping. Run migrations as a separate one-off ECS task instead
    # (deploy.yml does this automatically). Set to "true" in dev only.
    XCS_GEN_AUTO_MIGRATE=false \
    XCS_GEN_HOST=0.0.0.0 \
    XCS_GEN_PORT=4000

EXPOSE 4000

# The /api/health endpoint is public in any mode — safe for the LB to poll.
# Hits gunicorn on :4000, which proxies to a uvicorn worker; if all workers
# are blocked the request times out and the LB reaps the task.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request, sys; \
r = urllib.request.urlopen('http://127.0.0.1:4000/api/health', timeout=3); \
sys.exit(0 if r.status == 200 else 1)"

# gunicorn manages N uvicorn workers — process isolation means one
# stuck capture pipeline can't block the others. 2 workers matches
# the 2-vCPU ECS Fargate task spec; bump via XCS_GEN_WEB_WORKERS if
# the task ever moves to bigger hardware. --timeout 90 covers the
# worst-case capture (2-6s typical + S3 transfer headroom). --graceful-timeout
# lets in-flight uploads finish before SIGKILL. --max-requests recycles
# workers periodically to bound memory creep from OpenCV temporaries.
# sh -c form so ${XCS_GEN_WEB_WORKERS:-2} is expanded at container start
# rather than baked into the image; ECS task overrides can tune workers
# without rebuilding.
CMD ["sh", "-c", "gunicorn xcs_gen_web.app:app \
    --workers ${XCS_GEN_WEB_WORKERS:-2} \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:4000 \
    --timeout 90 \
    --graceful-timeout 30 \
    --max-requests 500 \
    --max-requests-jitter 50 \
    --access-logfile - \
    --error-logfile -"]
