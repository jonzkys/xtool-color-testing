"""Saved spectrums repository — multi-table CRUD.

The parent row in ``saved_spectrums`` carries the indexed Lab bounding
box and centroid (server-derived from the supplied swatches — never
client-supplied for derived numbers). The two child tables hold the
raw swatches and the polynomial coefficients respectively. All three
inserts run in one transaction; cascade-delete cleans up children.

Material/machine FKs are denormalised from the source test at create
time so future predictor queries can prefilter by material without
joining ``tests``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, delete as sa_delete, select, update

from ..config import STANDALONE_USER_ID
from ..db import session_scope
from ..models import (
    saved_spectrums,
    saved_spectrum_swatches,
    saved_spectrum_fit_coefficients,
    tests,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bbox_and_centroid(swatches: list[dict[str, Any]]) -> dict[str, float]:
    """Server-derived Lab bbox + centroid from supplied swatches."""
    Ls = [s["lab"][0] for s in swatches]
    As = [s["lab"][1] for s in swatches]
    Bs = [s["lab"][2] for s in swatches]
    n = len(swatches)
    return {
        "lab_l_min": min(Ls), "lab_l_max": max(Ls),
        "lab_a_min": min(As), "lab_a_max": max(As),
        "lab_b_min": min(Bs), "lab_b_max": max(Bs),
        "lab_l_centroid": sum(Ls) / n,
        "lab_a_centroid": sum(As) / n,
        "lab_b_centroid": sum(Bs) / n,
    }


def _row_to_record(parent_row, swatch_rows, coefficient_rows) -> dict[str, Any]:
    """Reassemble the parent row + child rows into the response dict."""
    fit_coefficients: dict[str, list[float]] = {"l": [], "a": [], "b": []}
    for row in sorted(coefficient_rows, key=lambda r: (r.channel, r.degree)):
        fit_coefficients[row.channel].append(row.coeff)
    return {
        "id": parent_row.id,
        "name": parent_row.name,
        "source_test_id": parent_row.source_test_id,
        "machine_id": parent_row.machine_id,
        "material_id": parent_row.material_id,
        "owner_id": parent_row.owner_id,
        "axis_param": parent_row.axis_param,
        "axis_min": parent_row.axis_min,
        "axis_max": parent_row.axis_max,
        "fit_form": parent_row.fit_form,
        "fit_degree": parent_row.fit_degree,
        "fit_coefficients": fit_coefficients,
        "fit_r2": {
            "l": parent_row.fit_l_r2,
            "a": parent_row.fit_a_r2,
            "b": parent_row.fit_b_r2,
        },
        "fit_r2_min": parent_row.fit_r2_min,
        "displayed_projection": parent_row.displayed_projection,
        "lab_l_min": parent_row.lab_l_min, "lab_l_max": parent_row.lab_l_max,
        "lab_a_min": parent_row.lab_a_min, "lab_a_max": parent_row.lab_a_max,
        "lab_b_min": parent_row.lab_b_min, "lab_b_max": parent_row.lab_b_max,
        "lab_l_centroid": parent_row.lab_l_centroid,
        "lab_a_centroid": parent_row.lab_a_centroid,
        "lab_b_centroid": parent_row.lab_b_centroid,
        "swatches": [
            {
                "swatch_row": r.swatch_row,
                "swatch_col": r.swatch_col,
                "x_value": r.x_value,
                "hex": r.hex,
                "lab": (r.lab_l, r.lab_a, r.lab_b),
            }
            for r in sorted(swatch_rows, key=lambda r: (r.swatch_row, r.swatch_col))
        ],
        "created_at": parent_row.created_at,
    }


def create(
    payload: dict[str, Any],
    *,
    owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any]:
    """Create a saved spectrum from a validated payload.

    Looks up ``machine_id`` and ``material_id`` from the source test
    so the FK denormalisation is server-driven. Caller (the API
    handler) is responsible for verifying that the requesting user
    can read the source test.

    Returns the freshly created record in response shape.
    """
    swatches = payload["swatches"]
    fit_coefficients = payload["fit_coefficients"]
    fit_r2 = payload["fit_r2"]
    fit_r2_min = min(fit_r2["l"], fit_r2["a"], fit_r2["b"])
    bbox = _bbox_and_centroid(swatches)
    now = _now()

    with session_scope() as s:
        # Derive machine_id and material_id from the source test.
        test_row = s.execute(
            select(tests.c.machine_id, tests.c.material_id)
            .where(tests.c.id == payload["source_test_id"])
        ).one_or_none()
        if test_row is None:
            raise LookupError(
                f"source test {payload['source_test_id']!r} not found",
            )

        result = s.execute(
            saved_spectrums.insert().values(
                name=payload["name"],
                source_test_id=payload["source_test_id"],
                machine_id=test_row.machine_id,
                material_id=test_row.material_id,
                owner_id=owner_id,
                axis_param=payload["axis_param"],
                axis_min=payload["axis_min"],
                axis_max=payload["axis_max"],
                fit_form=payload["fit_form"],
                fit_degree=payload["fit_degree"],
                fit_l_r2=fit_r2["l"],
                fit_a_r2=fit_r2["a"],
                fit_b_r2=fit_r2["b"],
                fit_r2_min=fit_r2_min,
                displayed_projection=payload["displayed_projection"],
                created_at=now,
                **bbox,
            )
        )
        new_id = result.inserted_primary_key[0]

        if swatches:
            s.execute(
                saved_spectrum_swatches.insert(),
                [
                    {
                        "saved_spectrum_id": new_id,
                        "swatch_row": w["swatch_row"],
                        "swatch_col": w["swatch_col"],
                        "x_value": w["x_value"],
                        "hex": w["hex"],
                        "lab_l": w["lab"][0],
                        "lab_a": w["lab"][1],
                        "lab_b": w["lab"][2],
                    }
                    for w in swatches
                ],
            )

        coeff_rows = []
        for channel in ("l", "a", "b"):
            for degree, coeff in enumerate(fit_coefficients[channel]):
                coeff_rows.append({
                    "saved_spectrum_id": new_id,
                    "channel": channel,
                    "degree": degree,
                    "coeff": coeff,
                })
        if coeff_rows:
            s.execute(saved_spectrum_fit_coefficients.insert(), coeff_rows)

        return _read_within_session(s, new_id)


def _read_within_session(s, spectrum_id: int) -> dict[str, Any] | None:
    """Reassemble a full record while the session is still open."""
    parent = s.execute(
        select(saved_spectrums).where(saved_spectrums.c.id == spectrum_id)
    ).one_or_none()
    if parent is None:
        return None
    swatch_rows = s.execute(
        select(saved_spectrum_swatches)
        .where(saved_spectrum_swatches.c.saved_spectrum_id == spectrum_id)
    ).all()
    coefficient_rows = s.execute(
        select(saved_spectrum_fit_coefficients)
        .where(
            saved_spectrum_fit_coefficients.c.saved_spectrum_id == spectrum_id
        )
    ).all()
    return _row_to_record(parent, swatch_rows, coefficient_rows)


def get(spectrum_id: int) -> dict[str, Any] | None:
    """Fetch a single saved spectrum by id, or None if not found."""
    with session_scope() as s:
        return _read_within_session(s, spectrum_id)


def delete(spectrum_id: int) -> None:
    """Delete a saved spectrum. Cascades to children via FK ON DELETE CASCADE."""
    with session_scope() as s:
        s.execute(
            sa_delete(saved_spectrums).where(saved_spectrums.c.id == spectrum_id)
        )


def list_(
    *,
    machine_id: str,
    material_id: int | None = None,
    min_r2: float | None = None,
    source_test_id: int | None = None,
    owner_id: int = STANDALONE_USER_ID,
) -> list[dict[str, Any]]:
    """List saved spectrums for the (owner, machine) scope.

    Optional filters: ``material_id``, ``min_r2`` (excludes anything
    with fit_r2_min below the threshold), ``source_test_id``.
    Newest-first by created_at, with id desc as tiebreaker.
    """
    with session_scope() as s:
        clauses = [
            saved_spectrums.c.owner_id == owner_id,
            saved_spectrums.c.machine_id == machine_id,
        ]
        if material_id is not None:
            clauses.append(saved_spectrums.c.material_id == material_id)
        if min_r2 is not None:
            clauses.append(saved_spectrums.c.fit_r2_min >= min_r2)
        if source_test_id is not None:
            clauses.append(saved_spectrums.c.source_test_id == source_test_id)
        parent_rows = s.execute(
            select(saved_spectrums)
            .where(and_(*clauses))
            .order_by(saved_spectrums.c.created_at.desc(), saved_spectrums.c.id.desc())
        ).all()
        if not parent_rows:
            return []
        ids = [r.id for r in parent_rows]
        all_swatches = s.execute(
            select(saved_spectrum_swatches)
            .where(saved_spectrum_swatches.c.saved_spectrum_id.in_(ids))
        ).all()
        all_coeffs = s.execute(
            select(saved_spectrum_fit_coefficients)
            .where(saved_spectrum_fit_coefficients.c.saved_spectrum_id.in_(ids))
        ).all()
        # Bucket children by parent id for assembly.
        sw_by_id: dict[int, list] = {i: [] for i in ids}
        co_by_id: dict[int, list] = {i: [] for i in ids}
        for r in all_swatches:
            sw_by_id[r.saved_spectrum_id].append(r)
        for r in all_coeffs:
            co_by_id[r.saved_spectrum_id].append(r)
        return [
            _row_to_record(p, sw_by_id[p.id], co_by_id[p.id])
            for p in parent_rows
        ]


def patch(spectrum_id: int, fields: dict[str, Any]) -> dict[str, Any] | None:
    """Apply a partial update. Stage 1 only allows ``name``."""
    allowed = {"name"}
    payload = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not payload:
        return get(spectrum_id)
    with session_scope() as s:
        s.execute(
            update(saved_spectrums)
            .where(saved_spectrums.c.id == spectrum_id)
            .values(**payload)
        )
        return _read_within_session(s, spectrum_id)
