"""Deployment smoke tests.

These don't spin up Docker — they just guard the invariants the
Dockerfile assumes: that the required Python deps are importable, and
that the CMD line still references them. If either drifts, prod
deploys break in a way that's hard to discover without running the
actual image, so fail fast in pytest instead.
"""

from __future__ import annotations

from pathlib import Path


def test_gunicorn_with_uvicorn_worker_available() -> None:
    """The Dockerfile relies on gunicorn + uvicorn.workers.UvicornWorker.

    If either dependency is missing from pyproject.toml, the prod
    image will boot-loop with ``ModuleNotFoundError`` — surface it
    here instead.
    """
    import gunicorn  # noqa: F401
    from uvicorn.workers import UvicornWorker  # noqa: F401


def test_dockerfile_uses_gunicorn() -> None:
    """Dockerfile CMD must wire up gunicorn with the uvicorn worker
    class and the ``XCS_GEN_WEB_WORKERS`` env-var override.

    Cheap regression check — catches a rebase that accidentally
    reverts the prod CMD back to bare uvicorn.
    """
    text = Path(__file__).resolve().parent.parent.joinpath("Dockerfile").read_text()
    assert "gunicorn" in text
    assert "uvicorn.workers.UvicornWorker" in text
    assert "--workers" in text
    assert "XCS_GEN_WEB_WORKERS" in text
