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
from ..palette import hex_to_lab


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r) -> dict[str, Any]:
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
        "visibility": r.visibility,
        "via": r.via,
    }


def create(
    *, test_id: int, image_path: str, image_sha256: str,
    swatches: list[dict[str, Any]], owner_id: int = STANDALONE_USER_ID,
    notes: str = "",
    visibility: str = DEFAULT_VISIBILITY,
    via: str = "desktop",
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


def _lab_to_hex(L: float, a: float, b: float) -> str:
    """Inverse of palette.hex_to_lab for rendering the averaged colour.

    Round-trip through XYZ → linear sRGB → sRGB. Values clamped to [0,1].
    """
    def f_inv(t: float) -> float:
        return t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787

    fy = (L + 16) / 116
    fx = fy + a / 500
    fz = fy - b / 200
    xn, yn, zn = 0.95047, 1.00000, 1.08883
    X, Y, Z = f_inv(fx) * xn, f_inv(fy) * yn, f_inv(fz) * zn
    # XYZ → linear sRGB (D65)
    r =  3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z
    g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z
    b_ = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z

    def to_srgb(u: float) -> int:
        if u <= 0:
            return 0
        if u >= 1:
            return 255
        v = 12.92 * u if u <= 0.0031308 else 1.055 * (u ** (1 / 2.4)) - 0.055
        return max(0, min(255, round(v * 255)))

    return f"#{to_srgb(r):02x}{to_srgb(g):02x}{to_srgb(b_):02x}"


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
            "hex": _lab_to_hex(L, a, b),
            "lab": [L, a, b],
            "sigma": max(it["sigma"] for it in items),
            "sample_count": n,
            "per_result": [
                {"result_id": it["result_id"], "hex": it["hex"], "sigma": it["sigma"]}
                for it in items
            ],
        })
    return out
