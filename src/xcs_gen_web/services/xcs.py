"""Build XCS bytes from a Test row."""

from __future__ import annotations

import json
import re
from typing import Any

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._\- ]")


def _safe_project_name(name: str, *, fallback: str) -> str:
    """Map arbitrary test names to something Project.name accepts."""
    cleaned = _SAFE_NAME_RE.sub("_", name).strip() or fallback
    return cleaned


def _spec_from_test(test: dict[str, Any]) -> dict[str, Any]:
    """Return the parsed spec dict from a test row.

    The tests repository surfaces ``spec`` (parsed) on read; ``spec_json``
    is only the on-disk form. Callers in older code paths might pass either
    shape, so accept both."""
    if "spec" in test and isinstance(test["spec"], dict):
        return test["spec"]
    raw = test.get("spec_json")
    if isinstance(raw, str):
        return json.loads(raw)
    if isinstance(raw, dict):
        return raw
    raise ValueError("test row has no spec / spec_json")


def _cell_list_for_test(*, test: dict[str, Any]) -> list[dict[str, Any]]:
    """Pure: spec + kind → list of {x_value, y_value, params} dicts in
    burn order. No I/O, no DOM, no SVG. Used by the builder and by
    pytest to verify the kind branch without serialising .xcs."""
    spec = _spec_from_test(test)
    kind = test.get("kind") or "sweep"
    base_params = spec.get("base_params", {}) or {}

    if kind == "validation":
        cells = test.get("validation_cells") or []
        if not cells:
            raise ValueError(
                "validation test has no cells — pick at least one "
                "palette swatch first"
            )
        return [
            {
                "x_value": vc["cell_index"],
                "y_value": None,
                "params": {**base_params, **(vc.get("params") or {})},
            }
            for vc in cells
        ]

    # Sweep branch — mirror the iteration order used by
    # ``xcs_gen.generators._generate_wrapped`` (1D, row-major) and
    # ``_generate_dual_axis`` (2D, y-outer / x-inner). Pulse-width axes
    # collapse to the machine's allowed preset list — defer to the same
    # helpers the converter uses so the cell list stays in lockstep with
    # what the renderer actually emits.
    from xcs_gen.generators import _axis_values, effective_step_count

    x_param = spec["x_param"]
    x_min = float(spec["x_min"])
    x_max = float(spec["x_max"])
    x_steps = int(spec["x_steps"])
    x_steps = effective_step_count(x_param, x_min, x_max, x_steps)
    x_values = _axis_values(x_param, x_min, x_max, x_steps)

    y_param = spec.get("y_param")
    if y_param and spec.get("y_steps"):
        y_min = float(spec["y_min"])
        y_max = float(spec["y_max"])
        y_steps = int(spec["y_steps"])
        y_steps = effective_step_count(y_param, y_min, y_max, y_steps)
        y_values = _axis_values(y_param, y_min, y_max, y_steps)
        out: list[dict[str, Any]] = []
        for y_val in y_values:
            for x_val in x_values:
                out.append({
                    "x_value": x_val,
                    "y_value": y_val,
                    "params": {**base_params, x_param: x_val, y_param: y_val},
                })
        return out

    return [
        {
            "x_value": x_val,
            "y_value": None,
            "params": {**base_params, x_param: x_val},
        }
        for x_val in x_values
    ]


def effective_spec_for_layout(
    *,
    spec: dict[str, Any],
    kind: str = "sweep",
    validation_cells: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a spec where wrapped-1D layout fields reflect the test's
    *true* burn-time geometry.

    For ``kind="validation"`` the stored spec carries the original
    sweep's ``rows=1`` / ``x_steps``, but the burn renders one cell per
    validation entry, wrapped onto ``ceil(cell_count / cells_per_row)``
    physical rows. Capture, inspect, and the renderer all need to see
    those derived values; otherwise the sampling grid hits one row even
    though the photo has three. Mirrors the override block inside
    :func:`bytes_for_test` so both the .xcs builder and the analysis
    pipeline use identical layout numbers.

    For ``kind="sweep"`` the spec is returned unchanged (apart from
    ``dict(spec)`` so callers don't accidentally mutate the caller's
    copy).
    """
    if kind != "validation":
        return spec
    import math
    cells = validation_cells or []
    cell_count = max(2, len(cells))
    cells_per_row = spec.get("cells_per_row")
    if cells_per_row and cells_per_row > 0:
        row_count = max(1, math.ceil(cell_count / cells_per_row))
    else:
        row_count = max(1, spec.get("rows") or 1)
    return {
        **spec,
        "hide_axis_labels": True,
        "x_min": 0,
        "x_max": cell_count - 1,
        "x_steps": cell_count,
        "rows": row_count,
        "y_param": None,
        "y_min": None,
        "y_max": None,
        "y_steps": None,
    }


def bytes_for_test(*, test_id: int, name: str, material_id: int,
                   spec: dict[str, Any], retest_index: int = 0,
                   machine_id: str = "F2Ultra",
                   kind: str = "sweep",
                   validation_cells: list[dict[str, Any]] | None = None,
                   owner_id: int | None = None) -> bytes:
    # Build a throwaway Project with exactly one placement so the existing
    # converter machinery keeps working. When the frontend project wrapper
    # is removed we'll fold this into a cleaner single-test path.
    #
    # ``retest_index`` is stamped into the generated QR payload so each
    # subsequent burn of the same test is photo-traceable back to the
    # retest it came from. The value lives on the test row; the
    # endpoint passes it through at generate time.
    #
    # ``kind`` selects the cell-list construction strategy. ``"sweep"``
    # (the default) keeps the legacy axis-sweep math. ``"validation"``
    # iterates ``validation_cells`` instead — each cell has its own
    # frozen params overlay — and forces ``hide_axis_labels=True`` since
    # there is no continuous axis to label.
    from .. import converter
    from ..schemas import Project

    if kind == "validation":
        # Validate eagerly via the helper so empty validation_cells raise
        # the user-facing ValueError before any heavy converter work.
        _cell_list_for_test(test={
            "kind": "validation",
            "spec": spec,
            "validation_cells": validation_cells or [],
        })
        # Pin sweep-only fields to values that keep the wrapped-1D layout
        # math honest. The same override is applied at capture/inspect
        # time via ``effective_spec_for_layout`` so the .xcs builder and
        # the analysis pipeline see identical numbers — the validation
        # photo's sampling grid must land on the same cells the burn
        # rendered.
        spec = effective_spec_for_layout(
            spec=spec, kind="validation", validation_cells=validation_cells,
        )

    project_name = _safe_project_name(name, fallback=f"test-{test_id}")
    placement_test: dict[str, Any] = {
        "id": str(test_id), "name": project_name, "material_id": str(material_id),
        "retest_index": retest_index,
        **spec,
    }
    if kind == "validation":
        placement_test["kind"] = "validation"
        placement_test["validation_cells"] = validation_cells or []
    placement = {
        "row": 0, "col": 0, "col_span": 1,
        "test": placement_test,
    }
    project = {
        "name": project_name,
        "grid_gap_mm": 0,
        "focus_mm": 1.5,
        "tests": [placement],
    }
    # Resolve per-material/machine annotation params; the converter
    # falls back to the renderer's hardcoded constants when this is
    # ``None`` (i.e. no defaults configured yet for this owner).
    annotation_params = None
    if owner_id is not None:
        from ..repositories import text_reg_defaults as treg_repo
        annotation_params = treg_repo.resolve_params(
            owner_id=owner_id,
            machine_id=machine_id,
            material_id=material_id,
        )

    # When the material has a calibration recipe, plumb it through so
    # ``generate_gradient`` emits the calibration strip alongside the
    # registration markers — every test plate then carries the anchors
    # the ingest pipeline needs for anchored WB correction.
    calibration_by_material_id: dict[str, dict] = {}
    if material_id and owner_id is not None:
        from ..repositories import materials as m_repo
        try:
            mat = m_repo.get(int(material_id), owner_id=owner_id)
        except (TypeError, ValueError):
            mat = None
        if mat:
            cp = mat.get("clean_pass_params")
            patches = mat.get("calibration_patches")
            if cp and patches:
                calibration_by_material_id[str(material_id)] = {
                    "clean_pass_params": cp,
                    "calibration_patches": patches,
                }

    return converter.project_to_xcs_bytes(
        Project.model_validate(project), machine_id=machine_id,
        annotation_params=annotation_params,
        calibration_by_material_id=calibration_by_material_id or None,
    )
