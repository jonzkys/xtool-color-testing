"""App-wide Python logging setup.

Uvicorn configures its own access/error loggers, but our ``xcs_gen``
logger was previously un-configured — everything below WARNING got
dropped silently. This module installs a single StreamHandler on the
``xcs_gen`` tree with a compact format, so `log.info(...)` from our
code actually appears in stdout alongside uvicorn's lines.

Call ``configure_logging()`` exactly once at process start
(``create_app`` does this). Idempotent: re-running replaces the handler
rather than stacking duplicates, which matters in tests that build
multiple apps in the same interpreter.
"""

from __future__ import annotations

import logging
import os
import sys


_LOGGER_NAME = "xcs_gen"
_FORMAT = "%(asctime)s %(levelname)-7s %(name)s — %(message)s"
_DATEFMT = "%Y-%m-%dT%H:%M:%S"


def configure_logging(level: str | int | None = None) -> None:
    """Install a stdout StreamHandler on the ``xcs_gen`` logger.

    ``level`` resolution order: explicit arg → ``XCS_GEN_LOG_LEVEL`` env
    → ``INFO``. Accepts level names ("DEBUG", "info") or numeric levels.
    """
    if level is None:
        level = os.environ.get("XCS_GEN_LOG_LEVEL", "INFO")
    if isinstance(level, str):
        level = level.strip().upper()

    logger = logging.getLogger(_LOGGER_NAME)
    logger.setLevel(level)

    # Remove prior handlers we installed so repeat calls don't duplicate
    # output. Anything tagged via ``_managed=True`` is ours; external
    # handlers (e.g. pytest capture) stay put.
    for h in list(logger.handlers):
        if getattr(h, "_managed", False):
            logger.removeHandler(h)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT, datefmt=_DATEFMT))
    handler._managed = True  # type: ignore[attr-defined]
    logger.addHandler(handler)
    # Don't bubble to root — uvicorn already writes to stdout and root
    # forwarding would double-log every line.
    logger.propagate = False
