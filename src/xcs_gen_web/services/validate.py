"""Validate-from-results — backend service for batch validation.

The Stability page's VALIDATE mode calls this to walk a validation
test's cells against its uploaded results and decide which cells'
burn-mean Lab is *stable enough across runs* to ingest as a fresh
palette entry.

The gate is intra-cell stability — i.e. ``max(ΔE(per-run mean,
consensus)) ≤ tolerance``. The cell's ΔE-versus-expected is included
on each row as informational only; it is never a gate. The original
palette entry might itself be wrong (bad lighting at first ingest),
so we trust the consensus across multiple shoots over the original.

On save, the route in ``app.py`` writes a brand-new palette entry
from the consensus — *not* an in-place update of any linked entry.
Cells without a ``palette_entry_id`` are first-class citizens: they
also create new entries, since "no link" doesn't change the math.

Pure functions — no DB writes happen here. Callers handle persistence
so dry-run is a single short-circuit.
"""

from __future__ import annotations

import json
import math
from typing import Any, Iterable

# Default tolerance — bumped from the original 5 ΔE because real
# materials run noisier than the just-perceptible boundary. The
# Validate UI exposes a slider; this is the seed value.
DEFAULT_TOLERANCE_DE = 8.0
MIN_RESULTS = 2

# Skip reasons surfaced to the UI. Kept as string codes (not enums)
# so the JSON payload is grep-friendly + the frontend doesn't need a
# parallel enum file. ``no_palette_link`` is *not* a skip reason —
# unlinked cells just create new entries.
REASON_INSUFFICIENT_RUNS = "insufficient_runs"
REASON_NO_MEASUREMENTS = "no_measurements"


def compute_validation_buckets(
    *,
    cells: list[dict[str, Any]],
    swatches_per_result: list[list[dict[str, Any]]],
    spec: dict[str, Any],
    tolerance_de: float = DEFAULT_TOLERANCE_DE,
) -> dict[str, list[dict[str, Any]]]:
    """Bucket each validation cell into stable / drifted / skipped.

    ``cells`` carries ``cell_index``, ``palette_entry_id`` (may be
    None — that's fine), and ``expected_lab_l/a/b``.

    ``swatches_per_result`` is one swatches-list per non-excluded
    result, each containing ``{row, col, lab: [L,a,b]}`` entries.

    ``spec`` is the test's spec dict (for ``cells_per_row``, falling
    back to ``ceil(x_steps / rows)`` for older tests).

    Returns ``{"stable": [...], "drifted": [...], "skipped": [...]}``.
    Each non-skipped entry carries:
      - ``cell_index``, ``palette_entry_id`` (may be None)
      - ``burn_mean_lab`` — the across-results consensus Lab
      - ``expected_lab`` — the cell's original expected Lab
      - ``stability_de`` — max ΔE between any single-run mean and the
        consensus (the gate value)
      - ``de_vs_expected`` — informational ΔE between consensus and
        the original expected Lab
      - ``run_count`` — number of results contributing after outlier
        rejection
      - ``n_inputs`` — number of results that had a measurement for
        this cell
    """
    cells_per_row = _resolve_cells_per_row(spec, len(cells))
    n_results = len(swatches_per_result)
    stable: list[dict[str, Any]] = []
    drifted: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    # Index swatches per result by cell_index for O(1) lookup.
    indexed: list[dict[int, list[tuple[float, float, float]]]] = []
    for swatches in swatches_per_result:
        m: dict[int, list[tuple[float, float, float]]] = {}
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
            m.setdefault(ci, []).append(triple)
        indexed.append(m)

    for cell in cells:
        cell_index = int(cell["cell_index"])
        palette_entry_id = cell.get("palette_entry_id")

        # One Lab per result — the within-result mean of all swatches
        # that landed in this cell. Single-swatch grids reduce to that
        # swatch's lab; richer grids average them. Results that
        # didn't sample this cell are absent from ``per_result_labs``.
        per_result_labs: list[tuple[float, float, float]] = []
        for sw_map in indexed:
            run_swatches = sw_map.get(cell_index)
            if not run_swatches:
                continue
            per_result_labs.append(_mean(run_swatches))

        if len(per_result_labs) == 0:
            skipped.append({
                "cell_index": cell_index,
                "palette_entry_id": palette_entry_id,
                "reason": REASON_NO_MEASUREMENTS,
            })
            continue

        if len(per_result_labs) < MIN_RESULTS or n_results < MIN_RESULTS:
            skipped.append({
                "cell_index": cell_index,
                "palette_entry_id": palette_entry_id,
                "reason": REASON_INSUFFICIENT_RUNS,
                "run_count": len(per_result_labs),
            })
            continue

        # Robust consensus across results — drop one outlier run when
        # its mean is more than 2× the median distance from the
        # centroid (with a 1.5 ΔE floor so tight clusters don't
        # trigger pathological exclusions). Mirrors the frontend's
        # ``robustMeanLab`` from stabilityStatsMath.ts.
        burn_mean, kept_count = _robust_mean(per_result_labs)
        # Stability gate: max ΔE between any *kept* run's mean and
        # the consensus. The full per-run distance set is computed
        # post-mean so dropped outliers don't penalise the gate.
        kept_labs = _kept_labs(per_result_labs, burn_mean)
        stability_de = max(
            (_delta_e_76(lab, burn_mean) for lab in kept_labs), default=0.0
        )
        expected_lab = (
            float(cell["expected_lab_l"]),
            float(cell["expected_lab_a"]),
            float(cell["expected_lab_b"]),
        )
        de_vs_expected = _delta_e_76(burn_mean, expected_lab)
        bucket = stable if stability_de <= tolerance_de else drifted
        bucket.append({
            "cell_index": cell_index,
            "palette_entry_id": palette_entry_id,
            "burn_mean_lab": list(burn_mean),
            "expected_lab": list(expected_lab),
            "stability_de": stability_de,
            "de_vs_expected": de_vs_expected,
            "run_count": kept_count,
            "n_inputs": len(per_result_labs),
        })

    return {
        "stable": stable,
        "drifted": drifted,
        "skipped": skipped,
    }


def _resolve_cells_per_row(spec: dict[str, Any], total_cells: int) -> int:
    """Pull ``cells_per_row`` from spec, falling back to the documented
    ``ceil(x_steps / rows)`` derivation for older tests."""
    direct = spec.get("cells_per_row")
    if isinstance(direct, int) and direct > 0:
        return direct
    rows = max(1, int(spec.get("rows") or 1))
    x_steps = max(1, int(spec.get("x_steps") or total_cells or 1))
    return max(1, math.ceil(x_steps / rows))


def _kept_labs(
    labs: list[tuple[float, float, float]],
    centroid: tuple[float, float, float],
) -> list[tuple[float, float, float]]:
    """Subset of ``labs`` that survived robust outlier rejection
    against ``centroid`` (same threshold rule as ``_robust_mean``).
    Mirrors the kept-set used to compute the consensus, so the
    stability gate measures spread among *contributors*."""
    if len(labs) < 3:
        return list(labs)
    distances = [_delta_e_76(lab, centroid) for lab in labs]
    sorted_d = sorted(distances)
    median = sorted_d[len(sorted_d) // 2]
    threshold = max(median * 2, 1.5)
    kept = [lab for lab, d in zip(labs, distances) if d <= threshold]
    return kept if len(kept) >= 2 else list(labs)


def _robust_mean(
    labs: list[tuple[float, float, float]],
) -> tuple[tuple[float, float, float], int]:
    """Cluster-robust mean — drops one outlier when its distance from
    the centroid is more than ``2 × median distance`` (with a 1.5 ΔE
    floor so tight clusters don't trigger pathological exclusions).

    Returns the inlier centroid + the number of inputs that survived.
    Falls back to the simple mean when N<3 or when removing outliers
    would leave fewer than 2 inliers.
    """
    if len(labs) == 0:
        return (0.0, 0.0, 0.0), 0
    centroid = _mean(labs)
    if len(labs) < 3:
        return centroid, len(labs)
    kept = _kept_labs(labs, centroid)
    if kept is labs or len(kept) == len(labs):
        return centroid, len(labs)
    return _mean(kept), len(kept)


def _mean(
    labs: Iterable[tuple[float, float, float]],
) -> tuple[float, float, float]:
    n = 0
    sL = sa = sb = 0.0
    for L, a, b in labs:
        sL += L
        sa += a
        sb += b
        n += 1
    if n == 0:
        return (0.0, 0.0, 0.0)
    return (sL / n, sa / n, sb / n)


def _delta_e_76(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
) -> float:
    """ΔE76 — Euclidean distance in CIE Lab. Cheap and the same
    convention the rest of the dashboard uses."""
    dL = a[0] - b[0]
    da = a[1] - b[1]
    db = a[2] - b[2]
    return math.sqrt(dL * dL + da * da + db * db)


def parse_swatches_json(raw: str) -> list[dict[str, Any]]:
    """Defensive swatches-json parser — tolerates non-list bodies by
    returning empty so a corrupt result row doesn't take down the
    whole batch."""
    try:
        out = json.loads(raw)
    except Exception:
        return []
    if not isinstance(out, list):
        return []
    return out
