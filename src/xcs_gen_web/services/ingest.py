"""Ingest-from-sweep — backend service for batch palette ingestion.

The Stability page's INGEST mode (sweep tests only) calls this to walk
a sweep test's grid against its uploaded results and decide which
cells' burn-mean Lab is *stable enough across runs* to mint as a
brand-new palette entry. Sister to ``services/validate.py`` — same
robust-mean math, same stability gate — but no expected colour to
compare against (sweeps don't have one), so the bucket is just
``stable / unstable / skipped``.

A "stable" cell is one where the max ΔE76 between any kept run's
mean and the consensus is at or below the user-chosen threshold
(default 3 ΔE — half the just-perceptible boundary). Unstable cells
stay in the preview but stay un-ticked; the user can override per
cell.

Pure functions — no DB writes happen here. The route in ``app.py``
handles persistence + per-cell param projection.
"""

from __future__ import annotations

import math
from typing import Any

from .validate import _delta_e_76, _kept_labs, _mean, _robust_mean

# Default σ threshold — looser than the just-perceptible 5 ΔE because
# sweep tests run noisier than authored validation, but tighter than
# validate's 8 ΔE because the user explicitly asked for a stable-
# colour gate. The frontend slider reseeds this; this is just the
# starting point.
DEFAULT_MAX_SIGMA_DE = 3.0
MIN_RESULTS = 2

REASON_INSUFFICIENT_RUNS = "insufficient_runs"
REASON_NO_MEASUREMENTS = "no_measurements"


def compute_ingest_buckets(
    *,
    swatches_per_result: list[list[dict[str, Any]]],
    spec: dict[str, Any],
    max_sigma_de: float = DEFAULT_MAX_SIGMA_DE,
) -> dict[str, list[dict[str, Any]]]:
    """Bucket each sweep cell into stable / unstable / skipped.

    ``swatches_per_result`` is one swatches-list per non-excluded
    result — each containing ``{row, col, lab: [L,a,b], x_value,
    y_value, hex}`` entries. Sweep tests don't have a
    ``validation_cells`` table, so the cell set comes from enumerating
    the spec grid: every (row, col) within ``rows × cells_per_row``
    that any result actually measured.

    ``spec`` is the test's spec dict (for ``cells_per_row``, falling
    back to ``ceil(x_steps / rows)`` for older tests).

    Returns ``{"stable": [...], "unstable": [...], "skipped": [...]}``.
    Each non-skipped entry carries:
      - ``cell_index``, ``row``, ``col``
      - ``burn_mean_lab`` — across-results consensus Lab
      - ``stability_de`` — max ΔE between any kept-run mean and the
        consensus (the gate value)
      - ``run_count`` — number of results contributing after outlier
        rejection
      - ``n_inputs`` — number of results that had a measurement for
        this cell
      - ``x_value`` / ``y_value`` — first run's swatch values, used by
        the route to project per-cell ``params``. Sweep results agree
        on (row, col) → (x, y), so the first-run's value is canonical.
    """
    cells_per_row = _resolve_cells_per_row(spec)
    n_results = len(swatches_per_result)
    stable: list[dict[str, Any]] = []
    unstable: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    # Index swatches per result by cell_index for O(1) lookup. Carry
    # x/y/hex alongside so the first-run's recipe is reachable without
    # a second walk through the swatches.
    indexed: list[
        dict[
            int,
            tuple[list[tuple[float, float, float]], dict[str, Any]],
        ]
    ] = []
    for swatches in swatches_per_result:
        m: dict[
            int,
            tuple[list[tuple[float, float, float]], dict[str, Any]],
        ] = {}
        for sw in swatches:
            try:
                row_n = int(sw.get("row", 0))
                col_n = int(sw.get("col", 0))
            except (TypeError, ValueError):
                continue
            lab = sw.get("lab")
            if not isinstance(lab, list) or len(lab) != 3:
                continue
            try:
                triple = (float(lab[0]), float(lab[1]), float(lab[2]))
            except (TypeError, ValueError):
                continue
            ci = row_n * cells_per_row + col_n
            existing = m.get(ci)
            if existing is None:
                m[ci] = (
                    [triple],
                    {
                        "row": row_n,
                        "col": col_n,
                        "x_value": sw.get("x_value"),
                        "y_value": sw.get("y_value"),
                    },
                )
            else:
                existing[0].append(triple)
        indexed.append(m)

    # Union the cell index space across all results. We never invent
    # cells the swatches didn't actually visit — that would just
    # produce no_measurements skips for every empty (row, col) the
    # spec lays out. ``meta`` carries the first-run's recipe for the
    # cell so the route can write per-cell params without a second
    # pass through swatches_per_result.
    meta_by_cell: dict[int, dict[str, Any]] = {}
    cell_indices: set[int] = set()
    for sw_map in indexed:
        for ci, (_labs, meta) in sw_map.items():
            cell_indices.add(ci)
            meta_by_cell.setdefault(ci, meta)

    for cell_index in sorted(cell_indices):
        # One Lab per result — the within-result mean of all swatches
        # that landed in this cell. Single-swatch grids reduce to that
        # swatch's lab; richer grids average them. Results that
        # didn't sample this cell are absent from ``per_result_labs``.
        per_result_labs: list[tuple[float, float, float]] = []
        for sw_map in indexed:
            entry = sw_map.get(cell_index)
            if entry is None:
                continue
            run_swatches, _meta = entry
            per_result_labs.append(_mean(run_swatches))

        meta = meta_by_cell[cell_index]

        if len(per_result_labs) == 0:
            # Defensive — shouldn't happen because ``cell_indices``
            # was built from at-least-one-measurement, but the guard
            # mirrors validate.compute_validation_buckets.
            skipped.append({
                "cell_index": cell_index,
                "reason": REASON_NO_MEASUREMENTS,
            })
            continue

        if len(per_result_labs) < MIN_RESULTS or n_results < MIN_RESULTS:
            skipped.append({
                "cell_index": cell_index,
                "reason": REASON_INSUFFICIENT_RUNS,
                "run_count": len(per_result_labs),
            })
            continue

        burn_mean, kept_count = _robust_mean(per_result_labs)
        kept_labs = _kept_labs(per_result_labs, burn_mean)
        stability_de = max(
            (_delta_e_76(lab, burn_mean) for lab in kept_labs), default=0.0
        )
        bucket = stable if stability_de <= max_sigma_de else unstable
        bucket.append({
            "cell_index": cell_index,
            "row": meta.get("row", 0),
            "col": meta.get("col", 0),
            "x_value": meta.get("x_value"),
            "y_value": meta.get("y_value"),
            "burn_mean_lab": list(burn_mean),
            "stability_de": stability_de,
            "run_count": kept_count,
            "n_inputs": len(per_result_labs),
        })

    return {
        "stable": stable,
        "unstable": unstable,
        "skipped": skipped,
    }


def _resolve_cells_per_row(spec: dict[str, Any]) -> int:
    """Pull ``cells_per_row`` from the spec, falling back to the
    documented ``ceil(x_steps / rows)`` derivation for older sweep
    tests created before that field existed.
    """
    direct = spec.get("cells_per_row")
    if isinstance(direct, int) and direct > 0:
        return direct
    rows = max(1, int(spec.get("rows") or 1))
    x_steps = max(1, int(spec.get("x_steps") or 1))
    return max(1, math.ceil(x_steps / rows))
