"""Image storage — thin facade over the active :mod:`storage` backend.

Preserves the module-level API (``save / read / delete / sha256_hex``)
so existing call sites don't need to know which backend is active.
The actual backend is resolved lazily from ``Settings.from_env()`` on
first use; ``create_app`` can pre-pin a backend via :func:`use_storage`
(tests do too) so a different settings object overrides the env.

This module is a *facade*, not the storage logic — add new backends
in :mod:`storage`, not here.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import Settings
from .storage import (
    DispatchingStorage,
    FilesystemStorage,
    StorageBackend,
    default_fs_root,
    get_storage,
    sha256_hex,
)

__all__ = [
    "sha256_hex",
    "save",
    "save_at",
    "read",
    "delete",
    "use_storage",
    "images_root",
]


_active: StorageBackend | None = None


def _backend() -> StorageBackend:
    """Return the active backend, constructing a default from env if needed."""
    global _active
    if _active is None:
        _active = _build_from_settings(Settings.from_env())
    return _active


def _build_from_settings(settings: Settings) -> StorageBackend:
    primary = get_storage(settings)
    # FS fallback for reading legacy filesystem paths after an S3 migration.
    fs = (
        primary
        if isinstance(primary, FilesystemStorage)
        else FilesystemStorage(
            Path(settings.images_dir) if settings.images_dir else default_fs_root()
        )
    )
    return DispatchingStorage(primary, fs)


def use_storage(settings: Settings) -> None:
    """Pin the backend for the current process.

    Called from ``create_app`` once settings are resolved, and from
    test fixtures to swap in a deterministic filesystem root. Safe to
    call multiple times.
    """
    global _active
    _active = _build_from_settings(settings)


def reset_for_tests() -> None:
    """Drop the cached backend so the next call rebuilds from env."""
    global _active
    _active = None


def images_root() -> Path:
    """Legacy helper — still used by a couple of places that write
    debug artefacts beside user-facing results. Returns the FS root
    regardless of whether S3 is active."""
    return default_fs_root()


def save(*, test_id: int, result_id: int, data: bytes,
         suffix: str, kind: str = "") -> dict[str, Any]:
    return _backend().save(
        test_id=test_id, result_id=result_id,
        data=data, suffix=suffix, kind=kind,
    )


def save_at(path: str, data: bytes) -> None:
    _backend().save_at(path, data)


def read(path: str) -> bytes:
    return _backend().read(path)


def delete(path: str) -> None:
    _backend().delete(path)
