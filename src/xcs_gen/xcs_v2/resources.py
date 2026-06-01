"""Content-addressed raster store for the v2 bundle.

Raster bytes are written to ``resources/<sha256(bytes)>.png`` with a
``<name>.png.meta.json`` sidecar. Identical bytes deduplicate to a single
resource (the sha256 is the natural dedup key). A BITMAP display references
its image by the FULL path ``resources/<sha>.png`` via ``resourcePath``.

See groundtruth.md §7: the filename stem == sha256 of the raw PNG bytes
(VERIFIED on the real samples), and the sha-named sidecar carries
``{ref, metadata:{kind,source:{type:"workspace",value}}}`` with NO pixel
dims/mimeType (those live on the BITMAP display). The literal
``project-cover.png`` sidecar additionally carries ``mimeType:"image/png"``.
"""

from __future__ import annotations

import hashlib
import json
import struct
import zlib

# project.json.cover points at this literal name (groundtruth.md §7).
COVER_NAME = "project-cover.png"


def _placeholder_cover_png() -> bytes:
    """Build a tiny valid 16x16 opaque-grey PNG without external deps.

    The real bundles ship a rendered preview; a small valid PNG is enough for
    import (the cover is a thumbnail, not processed geometry).
    """
    width = height = 16
    row = b"\x00" + (b"\x80\x80\x80" * width)  # filter byte 0 + RGB row
    raw = row * height
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def sha256_hex(data: bytes) -> str:
    """Return the lowercase hex sha256 of ``data``."""
    return hashlib.sha256(data).hexdigest()


def _sidecar(ref: str, value: str, *, mime: bool = False) -> dict:
    metadata: dict = {
        "kind": "image",
        "source": {"type": "workspace", "value": value},
    }
    if mime:
        metadata["mimeType"] = "image/png"
    return {"ref": ref, "metadata": metadata}


class ResourceStore:
    """Accumulates raster resources and their sidecars, deduplicating by sha."""

    def __init__(self) -> None:
        self._by_sha: dict[str, bytes] = {}  # sha -> raw bytes

    def add_png(self, data: bytes) -> str:
        """Add raster bytes; return the ``resources/<sha>.png`` resourcePath."""
        sha = sha256_hex(data)
        self._by_sha.setdefault(sha, data)
        return f"resources/{sha}.png"

    def members(self) -> dict[str, bytes]:
        """Return zip member name -> bytes for every resource.

        Always includes the literal project cover plus every sha-named PNG and
        their ``.meta.json`` sidecars.
        """
        out: dict[str, bytes] = {}

        cover = _placeholder_cover_png()
        out[f"resources/{COVER_NAME}"] = cover
        out[f"resources/{COVER_NAME}.meta.json"] = json.dumps(
            _sidecar(f"resources/{COVER_NAME}", COVER_NAME, mime=True),
            separators=(",", ":"),
        ).encode("utf-8")

        for sha, data in self._by_sha.items():
            name = f"resources/{sha}.png"
            out[name] = data
            out[f"{name}.meta.json"] = json.dumps(
                _sidecar(name, f"{sha}.png"),
                separators=(",", ":"),
            ).encode("utf-8")
        return out
