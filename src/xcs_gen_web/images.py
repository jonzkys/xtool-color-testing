"""Filesystem storage for result photos.

Canonical layout: <images_root>/<test_id>/<result_id>.<ext>.
Path is returned as an absolute string; the caller stores it in
results.image_path.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any


def images_root() -> Path:
    override = os.environ.get("XCS_GEN_IMAGES_DIR")
    if override:
        return Path(override)
    return Path.home() / ".xcs-gen" / "images"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save(*, test_id: int, result_id: int, data: bytes,
         suffix: str) -> dict[str, Any]:
    root = images_root()
    target_dir = root / str(test_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{result_id}{suffix}"
    path.write_bytes(data)
    return {"path": str(path), "sha256": sha256_hex(data)}


def read(path: str) -> bytes:
    return Path(path).read_bytes()


def delete(path: str) -> None:
    try:
        Path(path).unlink()
    except FileNotFoundError:
        pass
