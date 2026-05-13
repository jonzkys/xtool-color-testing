"""Results repository + averaged-swatch computation.

Results inherit ownership from their parent test — the owner id passed
to ``create`` must match the test's owner (routes enforce this via the
current-user dependency).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, select

from ..config import DEFAULT_VISIBILITY, STANDALONE_USER_ID
from ..db import session_scope
from ..models import results
from ..palette import hex_to_lab, lab_to_hex


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r) -> dict[str, Any]:
    wb_anchor_raw = getattr(r, "wb_anchor_rgb_json", None)
    wb_correction_raw = getattr(r, "wb_correction_json", None)
    wb_mode = getattr(r, "wb_mode", None)
    return {
        "id": r.id,
        "test_id": r.test_id,
        "uploaded_at": r.uploaded_at,
        "image_path": r.image_path,
        "image_sha256": r.image_sha256,
        "excluded": bool(r.excluded),
        "notes": r.notes,
        "swatches": json.loads(r.swatches_json),
        "owner_id": r.owner_id,
        "import_source": getattr(r, "import_source", None),
        "visibility": r.visibility,
        "via": r.via,
        # Pre-0006 rows lack the column — keep older test DBs loading.
        "retest_index": int(getattr(r, "retest_index", 0) or 0),
        "missing_markers": json.loads(getattr(r, "missing_markers_json", None) or "[]"),
        "warped_image_path": getattr(r, "warped_image_path", None),
        "wb": (
            {
                "mode": wb_mode,
                "anchor_rgb": (
                    json.loads(wb_anchor_raw) if wb_anchor_raw else None
                ),
                "correction": (
                    json.loads(wb_correction_raw) if wb_correction_raw else None
                ),
                "canonical_id": getattr(r, "wb_canonical_id", None),
            }
            if wb_mode is not None
            else None
        ),
    }


def create(
    *, test_id: int, image_path: str, image_sha256: str,
    swatches: list[dict[str, Any]], owner_id: int = STANDALONE_USER_ID,
    notes: str = "",
    visibility: str = DEFAULT_VISIBILITY,
    via: str = "desktop",
    retest_index: int = 0,
    missing_markers: list[int] | None = None,
) -> dict[str, Any]:
    with session_scope() as s:
        res = s.execute(results.insert().values(
            test_id=test_id,
            uploaded_at=_now(),
            image_path=image_path,
            image_sha256=image_sha256,
            excluded=0, notes=notes,
            swatches_json=json.dumps(swatches, separators=(",", ":")),
            owner_id=owner_id, visibility=visibility,
            via=via,
            retest_index=int(retest_index),
            missing_markers_json=json.dumps(
                list(missing_markers or []), separators=(",", ":"),
            ),
        ))
        rid = res.inserted_primary_key[0]
    return get(rid, owner_id=owner_id)  # type: ignore[return-value]


def get(rid: int, *, owner_id: int = STANDALONE_USER_ID) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(
            select(results).where(
                and_(results.c.id == rid, results.c.owner_id == owner_id),
            )
        ).one_or_none()
        return _row(row) if row else None


def find_by_hash_for_test(
    tid: int,
    sha256: str,
    *,
    owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any] | None:
    """Return the existing result row whose ``image_sha256`` matches the
    given hash for this test (owner-scoped), or ``None`` if no match.

    Drives the upload-time dedup check: re-uploading the same photo to
    the same test 409s instead of duplicating disk + DB rows. Hard-
    deleting a result removes the row and its hash, so the user can
    delete-and-re-upload any time. ``include_excluded`` is intentionally
    not configurable — an excluded row still occupies storage and the
    user almost certainly meant the same upload, just hidden."""
    with session_scope() as s:
        row = s.execute(
            select(results).where(
                and_(
                    results.c.test_id == tid,
                    results.c.image_sha256 == sha256,
                    results.c.owner_id == owner_id,
                ),
            ).limit(1)
        ).one_or_none()
        return _row(row) if row else None


def list_by_test(
    tid: int, *, owner_id: int = STANDALONE_USER_ID, include_excluded: bool = True,
) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(results).where(
            and_(
                results.c.test_id == tid,
                results.c.owner_id == owner_id,
            ),
        )
        if not include_excluded:
            q = q.where(results.c.excluded == 0)
        q = q.order_by(results.c.uploaded_at.desc())
        return [_row(r) for r in s.execute(q).all()]


def set_excluded(rid: int, excluded: bool, *, owner_id: int = STANDALONE_USER_ID) -> None:
    with session_scope() as s:
        s.execute(
            results.update()
            .where(and_(results.c.id == rid, results.c.owner_id == owner_id))
            .values(excluded=1 if excluded else 0)
        )


def set_notes(rid: int, notes: str, *, owner_id: int = STANDALONE_USER_ID) -> None:
    with session_scope() as s:
        s.execute(
            results.update()
            .where(and_(results.c.id == rid, results.c.owner_id == owner_id))
            .values(notes=notes)
        )


def delete(rid: int, *, owner_id: int = STANDALONE_USER_ID) -> str | None:
    """Delete the row and return the image_path so the caller can unlink."""
    row = get(rid, owner_id=owner_id)
    if row is None:
        return None
    with session_scope() as s:
        s.execute(
            results.delete().where(
                and_(results.c.id == rid, results.c.owner_id == owner_id),
            )
        )
    return row["image_path"]


def list_recent_for_user(
    *, owner_id: int, since_unix: int, via: str = "mobile",
) -> list[dict[str, Any]]:
    """Return rows owned by ``owner_id`` whose ``uploaded_at`` (ISO
    timestamp) is greater than ``since_unix``, optionally filtered to a
    given ``via``. Newest first.

    The polling endpoint passes since_unix as the unix-seconds threshold
    to filter on. Comparing on the ISO column directly works because ISO
    8601 sorts lexicographically; we convert since to ISO with the same
    timezone (UTC) the writes use."""
    since_iso = datetime.fromtimestamp(since_unix, tz=timezone.utc).isoformat()
    with session_scope() as s:
        rows = s.execute(
            select(results)
            .where(
                and_(
                    results.c.owner_id == owner_id,
                    results.c.via == via,
                    results.c.uploaded_at > since_iso,
                ),
            )
            .order_by(results.c.uploaded_at.desc())
        ).fetchall()
    return [_row(r) for r in rows]


def averaged_swatches(tid: int, *, owner_id: int = STANDALONE_USER_ID) -> list[dict[str, Any]]:
    """Per (row, col): mean Lab across non-excluded results.

    Cells with no contributing samples are omitted. The sigma of the
    averaged row is the max per-result sigma; the hex is the inverse
    Lab→sRGB round-trip of the mean Lab.
    """
    buckets: dict[tuple[int, int, Any], list[dict[str, Any]]] = {}
    results_list = list_by_test(tid, owner_id=owner_id, include_excluded=False)
    for r in results_list:
        for sw in r["swatches"]:
            key = (sw["row"], sw["col"], sw["x_value"])
            buckets.setdefault(key, []).append({
                "x_value": sw["x_value"], "y_value": sw.get("y_value"),
                "hex": sw["hex"], "lab": sw["lab"], "sigma": sw["sigma"],
                "result_id": r["id"],
                "retest_index": int(r.get("retest_index", 0) or 0),
            })

    out: list[dict[str, Any]] = []
    for (row, col, _x), items in sorted(buckets.items()):
        labs = [[*hex_to_lab(it["hex"])] for it in items]
        n = len(labs)
        L = sum(x[0] for x in labs) / n
        a = sum(x[1] for x in labs) / n
        b = sum(x[2] for x in labs) / n
        out.append({
            "row": row, "col": col,
            "x_value": items[0]["x_value"], "y_value": items[0]["y_value"],
            "hex": lab_to_hex(L, a, b),
            "lab": [L, a, b],
            "sigma": max(it["sigma"] for it in items),
            "sample_count": n,
            "per_result": [
                {
                    "result_id": it["result_id"],
                    "hex": it["hex"],
                    "sigma": it["sigma"],
                    "retest_index": it["retest_index"],
                }
                for it in items
            ],
        })
    return out


def replace_capture(
    rid: int,
    *,
    swatches: list[dict[str, Any]],
    missing_markers: list[int],
    owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any] | None:
    """Replace ``swatches_json`` and ``missing_markers_json`` on an
    existing result row. Used by the reingest endpoint to write fresh
    capture output without touching the source photo or upload metadata.
    Returns None if the row does not exist or is not owned by ``owner_id``.

    Also nulls ``warped_image_path`` — the previous cached warped is
    stale once we re-run capture; the next debug-modal fetch will
    repopulate.
    """
    with session_scope() as s:
        s.execute(
            results.update()
            .where(and_(results.c.id == rid, results.c.owner_id == owner_id))
            .values(
                swatches_json=json.dumps(swatches, separators=(",", ":")),
                missing_markers_json=json.dumps(
                    list(missing_markers), separators=(",", ":"),
                ),
                warped_image_path=None,
            )
        )
    return get(rid, owner_id=owner_id)


def set_warped_image_path(
    rid: int, path: str | None, *, owner_id: int = STANDALONE_USER_ID,
) -> None:
    """Persist (or clear) the cached warped-image sidecar path. ``None``
    invalidates the cache."""
    with session_scope() as s:
        s.execute(
            results.update()
            .where(and_(results.c.id == rid, results.c.owner_id == owner_id))
            .values(warped_image_path=path)
        )


def update_wb_state(
    result_id: int,
    *,
    mode: str | None,
    anchor_rgb: list | None,
    correction: list | dict | None,
    canonical_id: str | None,
    owner_id: int = STANDALONE_USER_ID,
) -> None:
    """Patch the WB-correction columns on a result row."""
    fields = {
        "wb_mode": mode,
        "wb_anchor_rgb_json": (
            json.dumps(anchor_rgb) if anchor_rgb is not None else None
        ),
        "wb_correction_json": (
            json.dumps(correction) if correction is not None else None
        ),
        "wb_canonical_id": canonical_id,
    }
    with session_scope() as s:
        result = s.execute(
            results.update()
            .where(
                and_(results.c.id == result_id, results.c.owner_id == owner_id),
            )
            .values(**fields)
        )
        if result.rowcount == 0:
            raise KeyError(result_id)
