"""Validate-from-results — backend service for batch validation.

The Stability page's VALIDATE mode calls this to walk a validation
test's cells against its uploaded results and decide which palette
entries can be auto-validated (with the burn-mean stored as the new
``validated_lab``), which need user review (large drift), and which
have to be skipped (no measurements, no palette link, single result).

The math mirrors the frontend's ``robustMeanLab`` from
``web/src/components/stabilityStatsMath.ts`` so the backend's
auto-validate threshold lines up with the chart's BURN ΔE the user
reads on the Stability page.

Pure functions — no DB writes happen here. Callers (the route in
``app.py``) handle persistence so dry-run mode is a single
short-circuit.
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
# parallel enum file.
REASON_NO_PALETTE_LINK = "no_palette_link"
REASON_INSUFFICIENT_RUNS = "insufficient_runs"
REASON_NO_MEASUREMENTS = "no_measurements"


def compute_validation_buckets(
    *,
    cells: list[dict[str, Any]],
    swatches_per_result: list[list[dict[str, Any]]],
    spec: dict[str, Any],
    tolerance_de: float = DEFAULT_TOLERANCE_DE,
) -> dict[str, list[dict[str, Any]]]:
    """Bucket each validation cell into auto / flagged / skipped.

    ``cells`` is the test's validation_cells rows. Each carries
    ``cell_index``, ``palette_entry_id``, ``expected_lab_l/a/b``,
    plus the original entry's measured lab is needed at write time
    (the route fetches it).

    ``swatches_per_result`` is one swatches-list per non-excluded
    result, each containing ``{row, col, lab: [L,a,b]}`` entries.

    ``spec`` is the test's spec dict (for ``cells_per_row``, falling
    back to ``ceil(x_steps / rows)`` for older tests).

    Returns ``{"auto_validated": [...], "flagged": [...],
    "skipped": [...]}``. Each entry carries the cell + metadata for
    the UI to render.
    """
    cells_per_row = _resolve_cells_per_row(spec, len(cells))
    n_results = len(swatches_per_result)
    auto: list[dict[str, Any]] = []
    flagged: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    # Index swatches per result by cell_index for O(1) lookup.
    indexed: list[dict[int, dict[str, Any]]] = []
    for swatches in swatches_per_result:
        m: dict[int, dict[str, Any]] = {}
        for sw in swatches:
            try:
                row_n = int(sw.get("row", 0))
                col_n = int(sw.get("col", 0))
            except (TypeError, ValueError):
                continue
            m[row_n * cells_per_row + col_n] = sw
        indexed.append(m)

    for cell in cells:
        cell_index = int(cell["cell_index"])
        palette_entry_id = cell.get("palette_entry_id")
        if palette_entry_id is None:
            skipped.append({
                "cell_index": cell_index,
                "palette_entry_id": None,
                "reason": REASON_NO_PALETTE_LINK,
            })
            continue

        # Collect measurements for this cell across results.
        labs: list[tuple[float, float, float]] = []
        for sw_map in indexed:
            sw = sw_map.get(cell_index)
            if sw is None:
                continue
            lab = sw.get("lab")
            if not isinstance(lab, list) or len(lab) != 3:
                continue
            try:
                labs.append((float(lab[0]), float(lab[1]), float(lab[2])))
            except (TypeError, ValueError):
                continue

        if len(labs) == 0:
            skipped.append({
                "cell_index": cell_index,
                "palette_entry_id": palette_entry_id,
                "reason": REASON_NO_MEASUREMENTS,
            })
            continue

        if len(labs) < MIN_RESULTS or n_results < MIN_RESULTS:
            skipped.append({
                "cell_index": cell_index,
                "palette_entry_id": palette_entry_id,
                "reason": REASON_INSUFFICIENT_RUNS,
                "run_count": len(labs),
            })
            continue

        # Robust mean: drop measurements > 2× the median distance from
        # the centroid (with a 1.5 ΔE floor — see the frontend's
        # ``robustMeanLab`` for the same logic).
        burn_mean, kept_count = _robust_mean(labs)
        expected_lab = (
            float(cell["expected_lab_l"]),
            float(cell["expected_lab_a"]),
            float(cell["expected_lab_b"]),
        )
        # ΔE76 between the burn-mean and the cell's *expected* (which
        # is the entry's original lab the validation was claimed to
        # match). Inside-tolerance → confirm; outside → flag.
        de = _delta_e_76(burn_mean, expected_lab)
        bucket = auto if de <= tolerance_de else flagged
        bucket.append({
            "cell_index": cell_index,
            "palette_entry_id": palette_entry_id,
            "burn_mean_lab": list(burn_mean),
            "expected_lab": list(expected_lab),
            "de_burn_vs_expected": de,
            "run_count": kept_count,
            "n_inputs": len(labs),
        })

    return {
        "auto_validated": auto,
        "flagged": flagged,
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
    distances = [_delta_e_76(lab, centroid) for lab in labs]
    sorted_d = sorted(distances)
    median = sorted_d[len(sorted_d) // 2]
    threshold = max(median * 2, 1.5)
    kept = [lab for lab, d in zip(labs, distances) if d <= threshold]
    if len(kept) < 2:
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
