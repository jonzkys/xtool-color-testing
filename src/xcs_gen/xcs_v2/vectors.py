"""Content-addressed vector store for the v2 bundle.

PATH geometry (`dPath` strings) is externalized to ``vectors/svg/data-0.json``
and referenced from a display via
``vectorRef = {vectorHash, bucketType:"svg", originalField:"dPath"}``.

groundtruth.md §4 (VERIFIED on the real samples):
- ``vectorHash`` == sha256 of the stored ``dPath`` (utf-8 bytes).
- ``vectors/svg/data-<N>.json`` = ``{bucketType, chunkIndex, entries}`` where
  ``entries`` is a dict keyed by hash whose VALUE is the raw ``dPath`` string.
- ``vectors/svg/index.json`` = ``{bucketType:"svg", version:"1.0", entryCount,
  entries{<hash>:{hash, size}}}`` where ``size`` == ``len(dPath)``.
- Identical geometry dedups to one entry (content-addressed).

The store is only materialised (and ``vectors/`` dirs emitted) when at least
one PATH is externalized. This emitter inlines a display's ``dPath`` by default
and externalizes ONLY ``dPath`` strings that repeat across the project (see
``displays._dpath_counts``). So a shape-like single-path project has an empty
store and emits NO ``vectors/`` member at all, matching shape.xs; only shared
geometry is content-addressed here, matching Pikachu2.
"""

from __future__ import annotations

import json

from .resources import sha256_hex


class VectorStore:
    """Accumulates externalized SVG path geometry, deduplicating by sha256."""

    def __init__(self) -> None:
        self._entries: dict[str, str] = {}  # hash -> dPath string

    def add(self, d_path: str) -> dict:
        """Externalize ``d_path``; return the ``vectorRef`` object for a display."""
        vector_hash = sha256_hex(d_path.encode("utf-8"))
        self._entries.setdefault(vector_hash, d_path)
        return {
            "vectorHash": vector_hash,
            "bucketType": "svg",
            "originalField": "dPath",
        }

    def is_empty(self) -> bool:
        return not self._entries

    def members(self) -> dict[str, bytes]:
        """Return zip member name -> bytes for the vector store (or empty dict).

        Emits nothing when no path was externalized, so the bundle has no
        ``vectors/`` dir in that case (matching shape.xs).
        """
        if self.is_empty():
            return {}
        index = {
            "bucketType": "svg",
            "version": "1.0",
            "entryCount": len(self._entries),
            "entries": {
                h: {"hash": h, "size": len(d)} for h, d in self._entries.items()
            },
        }
        data = {
            "bucketType": "svg",
            "chunkIndex": 0,
            "entries": dict(self._entries),
        }
        return {
            "vectors/svg/index.json": json.dumps(
                index, separators=(",", ":")
            ).encode("utf-8"),
            "vectors/svg/data-0.json": json.dumps(
                data, separators=(",", ":")
            ).encode("utf-8"),
        }
