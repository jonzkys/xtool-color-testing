# Hide Axis Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `hide_axis_labels` flag that suppresses per-row tick labels on generated test patterns, reclaiming the ~1.75 mm of vertical space each row gap otherwise reserves for annotation.

**Architecture:** Thread one boolean from the Web UI → Pydantic schema → `converter.project_to_xcs` → `generate_gradient()`. Inside the generator, branch once: compute `ann_space = 0` when the flag is set (which cascades into `effective_row_gap` and the QR payload's `row_stride_mm`), and skip the `_add_tick_and_label` / `_add_x_axis` / `_add_y_axis` calls. Registration (QR position, corner fiducials, offsets) is untouched. Spec: `docs/superpowers/specs/2026-04-21-hide-axis-labels-design.md`.

**Tech Stack:** Python 3.10+ (FastAPI, Pydantic), pytest, React + TypeScript + Vitest.

---

## File Structure

**Modify:**
- `src/xcs_gen/generators.py` — add `hide_axis_labels` param to `generate_gradient`, branch on `ann_space`, guard label-emitting calls.
- `src/xcs_gen/cli.py` — add `--hide-axis-labels` flag to the `generate` subcommand.
- `src/xcs_gen_web/schemas.py` — add `hide_axis_labels: bool = False` to `ParamTest`.
- `src/xcs_gen_web/converter.py` — thread flag through `_annotation_space_below`, `_test_vertical_footprint`, and the `generate_gradient` call in `project_to_xcs`.
- `web/src/types.ts` — add `hide_axis_labels: boolean` to `ParamTest` interface.
- `web/src/defaults.ts` — default `hide_axis_labels: false` in `defaultTest()`.
- `web/src/components/TestEditor.tsx` — add checkbox in the Layout section.

**Create tests:**
- Add three cases to `tests/test_roundtrip.py` covering the generator behaviour.
- Add one case to `tests/test_converter.py` covering the footprint.

No new production files — everything fits in existing modules.

---

## Task 1: Generator — wrapped path hides labels and shrinks row stride

**Files:**
- Modify: `src/xcs_gen/generators.py`
- Test: `tests/test_roundtrip.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_roundtrip.py`:

```python
def test_hide_axis_labels_wrapped_suppresses_ticks_and_labels():
    """With hide_axis_labels=True, only the summary TEXT is emitted; no tick LINEs."""
    project = generate_gradient(
        x_param="speed",
        x_min=100,
        x_max=1000,
        x_steps=20,
        rows=2,
        total_width=100.0,
        total_height=10.0,
        row_gap=0.5,
        hide_axis_labels=True,
    )
    result = build_xcs(project)
    types = [d["type"] for d in result["canvas"][0]["displays"]]
    # 20 cells + 1 summary TEXT, no tick LINEs, no axis-label TEXTs.
    assert types.count("RECT") == 20
    assert types.count("LINE") == 0
    assert types.count("TEXT") == 1


def test_hide_axis_labels_default_false_keeps_existing_behaviour():
    """Existing call sites keep rendering ticks + labels."""
    project = generate_gradient(
        x_param="speed", x_min=100, x_max=1000, x_steps=10,
    )
    result = build_xcs(project)
    types = [d["type"] for d in result["canvas"][0]["displays"]]
    assert "LINE" in types
    assert types.count("TEXT") >= 2  # summary + at least one axis label
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_roundtrip.py::test_hide_axis_labels_wrapped_suppresses_ticks_and_labels tests/test_roundtrip.py::test_hide_axis_labels_default_false_keeps_existing_behaviour -v`
Expected: first test FAIL with `TypeError: generate_gradient() got an unexpected keyword argument 'hide_axis_labels'`; second test PASS.

- [ ] **Step 3: Add the parameter and branch on it**

In `src/xcs_gen/generators.py`, update the `generate_gradient` signature. Find the line near generators.py:119 (`test_id: str | None = None,`) and add a new parameter just before the closing `)`:

```python
    test_id: str | None = None,
    material_id: str | None = None,
    hide_axis_labels: bool = False,
) -> XCSProject:
```

Then inside `generate_gradient`, locate the block at generators.py:249–255 that computes `row_stride_mm`:

```python
        row_stride_mm: float | None = None
        if rows > 1 and not is_dual:
            ann_space = tick_length + 0.05 + text_height(label_font_size) + 0.05
            effective_row_gap = max(row_gap, ann_space)
            row_stride_mm = total_height + effective_row_gap
```

Replace it with:

```python
        row_stride_mm: float | None = None
        if rows > 1 and not is_dual:
            ann_space = 0.0 if hide_axis_labels else (
                tick_length + 0.05 + text_height(label_font_size) + 0.05
            )
            effective_row_gap = max(row_gap, ann_space)
            row_stride_mm = total_height + effective_row_gap
```

Now pass the flag into `_generate_wrapped` and `_generate_dual_axis`. Update both call sites (generators.py:203–215 and 217–227):

```python
    if is_dual:
        _generate_dual_axis(
            project,
            x_param=x_param, x_values=_linspace(x_min, x_max, x_steps),
            y_param=y_param, y_values=_linspace(y_min, y_max, y_steps),
            x_steps=x_steps, y_steps=y_steps,
            total_width=total_width, total_height=total_height,
            gap=gap, start_x=start_x, start_y=gradient_start_y,
            base_params=base_params, processing_type=processing_type,
            label_font_size=label_font_size, tick_length=tick_length,
            annotation_params=annotation_params,
            cell_shape=cell_shape,
            hide_axis_labels=hide_axis_labels,
        )
    else:
        _generate_wrapped(
            project,
            x_param=x_param, x_values=_linspace(x_min, x_max, x_steps),
            x_steps=x_steps, rows=rows, row_gap=row_gap,
            total_width=total_width, row_height=total_height,
            gap=gap, start_x=start_x, start_y=gradient_start_y,
            base_params=base_params, processing_type=processing_type,
            label_font_size=label_font_size, tick_length=tick_length,
            annotation_params=annotation_params,
            cell_shape=cell_shape,
            hide_axis_labels=hide_axis_labels,
        )
```

- [ ] **Step 4: Accept the flag in `_generate_wrapped` and guard the label calls**

Still in `src/xcs_gen/generators.py`, edit `_generate_wrapped` (starts at generators.py:349). Add `hide_axis_labels: bool = False,` to its signature (just before the closing `) -> None:`).

Then replace the `ann_space` computation at generators.py:377:

```python
    ann_space = tick_length + 0.05 + text_height(label_font_size) + 0.05
    effective_row_gap = max(row_gap, ann_space) if rows > 1 else 0
```

with:

```python
    ann_space = 0.0 if hide_axis_labels else (
        tick_length + 0.05 + text_height(label_font_size) + 0.05
    )
    effective_row_gap = max(row_gap, ann_space) if rows > 1 else 0
```

Then wrap the label-emitting code block inside the row loop (the whole section from `# Labels below each row` through the end of the middle-labels for-loop, generators.py:404–461) in an `if not hide_axis_labels:` guard:

```python
        if not hide_axis_labels:
            # Labels below each row
            bottom_y = row_y + row_height
            label_y = bottom_y + tick_length + 0.05

            # Row spans from start_x to row_right (the actual edges of the gradient)
            row_right = start_x + (row_count - 1) * (elem_w + gap) + elem_w

            # Start tick + label (aligned to left edge of gradient)
            _add_tick_and_label(
                project,
                param=x_param,
                value=x_values[row_start],
                cx=start_x,
                bottom_y=bottom_y,
                label_y=label_y,
                tick_length=tick_length,
                font_size=label_font_size,
                layer_color=ann_layer,
                annotation_params=annotation_params,
                align="start",
            )

            # End tick + label (aligned to right edge of gradient)
            _add_tick_and_label(
                project,
                param=x_param,
                value=x_values[row_end - 1],
                cx=row_right,
                bottom_y=bottom_y,
                label_y=label_y,
                tick_length=tick_length,
                font_size=label_font_size,
                layer_color=ann_layer,
                annotation_params=annotation_params,
                align="end",
            )

            # Middle labels: evenly spaced along the row width between start and end
            n_middle = 3  # 3 middle ticks = 5 total labels per row (start + 3 + end)
            if row_count > 2:
                for m in range(1, n_middle + 1):
                    frac = m / (n_middle + 1)
                    cx = start_x + frac * (row_right - start_x)
                    idx = min(row_count - 1, int(round(frac * (row_count - 1))))
                    _add_tick_and_label(
                        project,
                        param=x_param,
                        value=x_values[row_start + idx],
                        cx=cx,
                        bottom_y=bottom_y,
                        label_y=label_y,
                        tick_length=tick_length,
                        font_size=label_font_size,
                        layer_color=ann_layer,
                        annotation_params=annotation_params,
                    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/test_roundtrip.py::test_hide_axis_labels_wrapped_suppresses_ticks_and_labels tests/test_roundtrip.py::test_hide_axis_labels_default_false_keeps_existing_behaviour -v`
Expected: both PASS.

Then run the full existing suite to catch regressions: `pytest tests/test_roundtrip.py -v`
Expected: all PASS (including `test_annotations_present`, which asserts label counts with the default `hide_axis_labels=False`).

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen/generators.py tests/test_roundtrip.py
git commit -m "generators: hide_axis_labels toggle for single-axis path"
```

---

## Task 2: Generator — dual-axis path honours the flag

**Files:**
- Modify: `src/xcs_gen/generators.py`
- Test: `tests/test_roundtrip.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_roundtrip.py`:

```python
def test_hide_axis_labels_dual_axis_suppresses_all_ticks():
    """Dual-axis grid with hide_axis_labels=True emits only cells + summary."""
    project = generate_gradient(
        x_param="speed", x_min=100, x_max=500, x_steps=5,
        y_param="power", y_min=10, y_max=50, y_steps=4,
        total_width=50.0, total_height=40.0,
        hide_axis_labels=True,
    )
    result = build_xcs(project)
    types = [d["type"] for d in result["canvas"][0]["displays"]]
    assert types.count("RECT") == 20
    assert types.count("LINE") == 0
    assert types.count("TEXT") == 1  # summary only
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_roundtrip.py::test_hide_axis_labels_dual_axis_suppresses_all_ticks -v`
Expected: FAIL — labels are still emitted because `_generate_dual_axis` ignores the flag.

- [ ] **Step 3: Thread the flag through `_generate_dual_axis` and guard the axis calls**

In `src/xcs_gen/generators.py`, edit `_generate_dual_axis` (starts at generators.py:464). Add `hide_axis_labels: bool = False,` just before the closing `) -> None:`.

Then wrap the `_add_x_axis` and `_add_y_axis` calls (generators.py:507–535) in a single guard:

```python
    if not hide_axis_labels:
        _add_x_axis(
            project,
            x_param=x_param,
            x_values=x_values,
            x_steps=x_steps,
            elem_w=elem_w,
            gap=gap,
            start_x=start_x,
            bottom_y=start_y + total_height,
            tick_length=tick_length,
            font_size=label_font_size,
            layer_color=ann_layer,
            annotation_params=annotation_params,
        )

        _add_y_axis(
            project,
            y_param=y_param,
            y_values=y_values,
            y_steps=y_steps,
            elem_h=elem_h,
            gap=gap,
            start_y=start_y,
            left_x=start_x,
            tick_length=tick_length,
            font_size=label_font_size,
            layer_color=ann_layer,
            annotation_params=annotation_params,
        )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_roundtrip.py::test_hide_axis_labels_dual_axis_suppresses_all_ticks -v`
Expected: PASS.

Then re-run the full suite: `pytest tests/test_roundtrip.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/generators.py tests/test_roundtrip.py
git commit -m "generators: hide_axis_labels toggle for dual-axis path"
```

---

## Task 3: Generator — QR payload records shrunk row_stride_mm

**Files:**
- Test: `tests/test_roundtrip.py`

- [ ] **Step 1: Write the failing test**

This verifies the invariant that makes capture sampling still work. Add to `tests/test_roundtrip.py`:

```python
def test_hide_axis_labels_shrinks_row_stride_between_cells():
    """With hide_axis_labels=True, wrapped row origins are row_height + row_gap
    apart — no extra annotation allowance. This is the invariant that keeps
    the capture sampler's row_stride_mm consistent with actual cell spacing."""
    row_height = 8.0
    row_gap = 0.5

    project = generate_gradient(
        x_param="speed", x_min=100, x_max=1000, x_steps=30,
        rows=3,
        total_width=60.0, total_height=row_height, row_gap=row_gap,
        hide_axis_labels=True,
    )

    rect_ys = sorted({round(e.y, 3) for e in project.elements})
    assert len(rect_ys) == 3
    assert abs((rect_ys[1] - rect_ys[0]) - (row_height + row_gap)) < 0.01
    assert abs((rect_ys[2] - rect_ys[1]) - (row_height + row_gap)) < 0.01


def test_default_row_stride_includes_ann_space():
    """Sanity: the pre-existing behaviour (labels visible) keeps the
    annotation allowance in the row stride. Without it this test
    degrades silently — the user would only notice on actual captures."""
    from xcs_gen.text import text_height

    row_height = 8.0
    row_gap = 0.5
    ann_space = 0.5 + 0.05 + text_height(3.0) + 0.05  # matches generator math

    project = generate_gradient(
        x_param="speed", x_min=100, x_max=1000, x_steps=30,
        rows=3,
        total_width=60.0, total_height=row_height, row_gap=row_gap,
        # hide_axis_labels left at default False
    )
    rect_ys = sorted({round(e.y, 3) for e in project.elements})
    expected_stride = row_height + max(row_gap, ann_space)
    assert abs((rect_ys[1] - rect_ys[0]) - expected_stride) < 0.01
```

- [ ] **Step 2: Run the test to verify it passes**

Task 1 already shipped the `ann_space = 0` branch that drives `row_stride_mm`, so this test should pass now. Run: `pytest tests/test_roundtrip.py::test_hide_axis_labels_shrinks_row_stride_in_qr_payload -v`
Expected: PASS.

If it FAILS, the bug is in Task 1's edit of the `row_stride_mm` block in `generate_gradient` — re-check that the `ann_space` branch there also uses `hide_axis_labels`.

- [ ] **Step 3: Commit**

```bash
git add tests/test_roundtrip.py
git commit -m "generators: test QR row_stride_mm shrinks when labels hidden"
```

---

## Task 4: Schema — `hide_axis_labels` field on `ParamTest`

**Files:**
- Modify: `src/xcs_gen_web/schemas.py:90` (end of `ParamTest` fields)
- Test: `tests/test_schemas.py` (if it exists) — otherwise add to `tests/test_converter.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_converter.py` (the converter imports `ParamTest` and already has a fixture `_test()`):

```python
def test_param_test_hide_axis_labels_defaults_false():
    """Omitting hide_axis_labels gives False (backwards compat for stored tests)."""
    t = _test("t1")
    assert t.hide_axis_labels is False


def test_param_test_hide_axis_labels_round_trips():
    """Explicitly-set True survives model_validate (JSON → object)."""
    payload = {
        "id": "t1", "name": "t", "x_param": "speed",
        "x_min": 500, "x_max": 2000, "x_steps": 10,
        "rows": 1, "width_mm": 30, "height_mm": 5, "gap_mm": 0,
        "base_params": _base().model_dump(),
        "material_id": "mat-test",
        "hide_axis_labels": True,
    }
    t = ParamTest.model_validate(payload)
    assert t.hide_axis_labels is True
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_converter.py::test_param_test_hide_axis_labels_defaults_false tests/test_converter.py::test_param_test_hide_axis_labels_round_trips -v`
Expected: FAIL — the field doesn't exist yet.

- [ ] **Step 3: Add the field to `ParamTest`**

In `src/xcs_gen_web/schemas.py`, directly after the `unidirectional: bool = False` line (schemas.py:90), add:

```python
    # When true, suppresses per-row tick + axis-label elements on generated
    # test patterns. Reclaims ~1.75 mm per row gap (at the 3 pt default font).
    # QR payload's row_stride_mm is recomputed accordingly so capture
    # sampling still hits the right cells.
    hide_axis_labels: bool = False
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_converter.py::test_param_test_hide_axis_labels_defaults_false tests/test_converter.py::test_param_test_hide_axis_labels_round_trips -v`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/schemas.py tests/test_converter.py
git commit -m "schemas: add hide_axis_labels field to ParamTest"
```

---

## Task 5: Converter — shrink vertical footprint and forward the flag

**Files:**
- Modify: `src/xcs_gen_web/converter.py`
- Test: `tests/test_converter.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_converter.py`:

```python
def test_hide_axis_labels_shrinks_vertical_footprint():
    """Stacked tests with hide_axis_labels=True should pack tighter than the
    default (the inter-test gap shrinks because the bottom-strip annotation
    allowance disappears)."""
    def _stacked(hide: bool):
        return Project(
            name="Test", grid_gap_mm=0.0,
            tests=[
                TestPlacement(
                    test=_test("t1").model_copy(update={"hide_axis_labels": hide}),
                    row=0, col=0, col_span=1,
                ),
                TestPlacement(
                    test=_test("t2").model_copy(update={"hide_axis_labels": hide}),
                    row=1, col=0, col_span=1,
                ),
            ],
        )

    default_xcs = project_to_xcs(_stacked(hide=False))
    hidden_xcs = project_to_xcs(_stacked(hide=True))

    def _distinct_y(xcs):
        return sorted({round(e.y, 3) for e in xcs.elements})

    d_ys = _distinct_y(default_xcs)
    h_ys = _distinct_y(hidden_xcs)
    # Two tests → two distinct cell y-origins in each.
    assert len(d_ys) == 2 and len(h_ys) == 2
    # Hidden case packs the second test closer to the first.
    assert (h_ys[1] - h_ys[0]) < (d_ys[1] - d_ys[0])


def test_hide_axis_labels_generator_sees_no_labels():
    """project_to_xcs must forward hide_axis_labels to generate_gradient."""
    project = Project(
        name="Test", grid_gap_mm=0.0,
        tests=[
            TestPlacement(
                test=_test("t1").model_copy(update={"hide_axis_labels": True}),
                row=0, col=0, col_span=1,
            ),
        ],
    )
    xcs = project_to_xcs(project)
    display_types = [d.__class__.__name__ for d in xcs.extra_displays]
    # With hidden labels: the only extra_display is the summary TextDisplay.
    # If the converter didn't forward the flag, we'd also see tick LINE
    # displays and numeric-label TEXT displays.
    from xcs_gen.model import Line
    assert not any(isinstance(e, Line) for e in xcs.extra_displays)
```

Note: `_test()` in `test_converter.py` already exists (line 16). The test uses `model_copy(update={...})` to set the new field without rewriting the fixture.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_converter.py::test_hide_axis_labels_shrinks_vertical_footprint tests/test_converter.py::test_hide_axis_labels_generator_sees_no_labels -v`
Expected: both FAIL — `_test_vertical_footprint` still uses the full `ann_below` and `project_to_xcs` doesn't forward the flag.

- [ ] **Step 3: Teach `_annotation_space_below` about the flag**

In `src/xcs_gen_web/converter.py`, replace `_annotation_space_below` (converter.py:29–34):

```python
def _annotation_space_below(hide_axis_labels: bool = False) -> float:
    """Vertical space below a gradient for the X axis tick marks + labels.

    Returns 0 when labels are hidden so stacked tests pack tighter.
    Mirrors _add_tick_and_label: tick + 0.05 gap + text + 0.05 padding.
    """
    if hide_axis_labels:
        return 0.0
    return _TICK_LENGTH + 0.05 + text_height(_LABEL_FONT_SIZE) + 0.05
```

- [ ] **Step 4: Update `_test_vertical_footprint` to use the flag**

Still in `src/xcs_gen_web/converter.py`, edit `_test_vertical_footprint` (converter.py:42–70). Replace the body:

```python
def _test_vertical_footprint(t: ParamTest) -> float:
    """Total vertical space a test occupies, including summary and axis labels.

    For multi-row tests (rows > 1), the generator auto-expands row_gap to fit
    inter-row annotations (unless hide_axis_labels is set, in which case the
    user's row_gap is used verbatim).

    When registration markers are enabled, the generator shifts the entire
    test content down by the registration reservation so markers don't end up
    at negative coordinates; add that shift to the footprint so stacked tests
    don't overlap.
    """
    summary = _summary_space_above()
    ann_below = _annotation_space_below(t.hide_axis_labels)

    if t.rows > 1:
        # generate_gradient uses effective_row_gap = max(row_gap, ann_space).
        # When hide_axis_labels is true, ann_space is 0 so this collapses to
        # the user's own row_gap.
        effective_row_gap = max(t.gap_mm, ann_below)
        gradient_h = t.rows * t.height_mm + (t.rows - 1) * effective_row_gap
    else:
        gradient_h = t.height_mm

    _, reg_shift_y = registration_reservation_mm(
        t.registration.mode, t.registration.qr_mode,
        position=t.registration.qr_position,
        qr_size_mm=t.registration.qr_size_mm,
        grid_h_mm=gradient_h,
    )

    return reg_shift_y + summary + gradient_h + ann_below
```

Note the second change: the old code used a hard-coded `max(1.0, ann_below)` as the inter-row gap which ignored the test's actual `gap_mm`. This was already slightly wrong for the default case (it assumed row_gap=1), but it only mattered when `ann_below > 1` — which is always true at the 3 pt default. The new code uses `t.gap_mm`, which matches what `generate_gradient` actually does (generators.py:378). **If the existing `test_vertical_placement_offsets` test fails after this change, update it.**

- [ ] **Step 5: Forward the flag from `project_to_xcs`**

Still in `src/xcs_gen_web/converter.py`, find the `generate_gradient(...)` call (converter.py:223–249) and add the flag as the last keyword argument before the closing `)`:

```python
        generated = generate_gradient(
            x_param=t.x_param,
            x_min=t.x_min,
            x_max=t.x_max,
            x_steps=t.x_steps,
            y_param=t.y_param,
            y_min=t.y_min if t.y_min is not None else 0,
            y_max=t.y_max if t.y_max is not None else 0,
            y_steps=t.y_steps if t.y_steps is not None else 1,
            rows=t.rows,
            total_width=t.width_mm,
            total_height=t.height_mm,
            gap=t.gap_mm,
            start_x=CANVAS_ORIGIN_X + x_off,
            start_y=CANVAS_ORIGIN_Y + y_off,
            base_params=_to_processing_params(t.base_params, angle_mode=t.angle_mode),
            summary_suffix=summary_suffix,
            registration_mode=t.registration.mode,
            registration_qr_mode=t.registration.qr_mode,
            registration_qr_position=t.registration.qr_position,
            registration_qr_size_mm=t.registration.qr_size_mm,
            unidirectional=t.unidirectional,
            cell_shape=t.cell_shape,
            test_id=t.id,
            material_id=t.material_id,
            hide_axis_labels=t.hide_axis_labels,
        )
```

- [ ] **Step 6: Run all converter tests**

Run: `pytest tests/test_converter.py -v`
Expected: all tests PASS, including the two new ones and the pre-existing `test_vertical_placement_offsets`.

If `test_vertical_placement_offsets` fails, it's because the test uses `_test()` which has `gap_mm=0.0` and the old footprint math was floored at 1.0. The fix is to assert the actual (now correct) separation — update the test to `assert separation >= 5.0` remains valid (5 mm cell height is still the minimum). Re-read the existing assertion at `tests/test_converter.py:105` before editing; only change it if it truly breaks.

- [ ] **Step 7: Full test suite sanity**

Run: `pytest -v`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/xcs_gen_web/converter.py tests/test_converter.py
git commit -m "converter: plumb hide_axis_labels + shrink stacked footprint"
```

---

## Task 6: CLI — `--hide-axis-labels` flag on `generate` subcommand

**Files:**
- Modify: `src/xcs_gen/cli.py`

- [ ] **Step 1: Add the argparse flag**

In `src/xcs_gen/cli.py`, find the `gen_p.add_argument("--font-size", ...)` line (cli.py:59) and add below it:

```python
    gen_p.add_argument("--hide-axis-labels", action="store_true",
                       help="Suppress per-row tick marks and axis labels (summary header is kept)")
```

- [ ] **Step 2: Forward the flag into `generate_gradient`**

Still in `src/xcs_gen/cli.py`, find the `generate_gradient(...)` call (cli.py:303–319). Add `hide_axis_labels=args.hide_axis_labels,` as the last kwarg before the closing `)`:

```python
        project = generate_gradient(
            ...,
            label_font_size=args.font_size,
            hide_axis_labels=args.hide_axis_labels,
        )
```

(Preserve the surrounding kwargs exactly as they are — only add the new line.)

- [ ] **Step 3: Smoke-test the CLI**

Run:
```bash
xcs-gen generate \
    --x-param speed --x-min 100 --x-max 1000 --x-steps 20 \
    --rows 2 --width 60 --height 8 \
    --hide-axis-labels \
    -o /tmp/hide-labels.xcs
```
Expected: exits 0, file written.

Then inspect: `python -c "import json; d=json.load(open('/tmp/hide-labels.xcs')); print(sum(1 for x in d['canvas'][0]['displays'] if x['type']=='TEXT'))"`
Expected: `1` (summary only).

Without the flag:
```bash
xcs-gen generate \
    --x-param speed --x-min 100 --x-max 1000 --x-steps 20 \
    --rows 2 --width 60 --height 8 \
    -o /tmp/labels.xcs
```
Then: `python -c "import json; d=json.load(open('/tmp/labels.xcs')); print(sum(1 for x in d['canvas'][0]['displays'] if x['type']=='TEXT'))"`
Expected: `>1` (summary + labels).

- [ ] **Step 4: Commit**

```bash
git add src/xcs_gen/cli.py
git commit -m "cli: add --hide-axis-labels flag to generate command"
```

---

## Task 7: Web types and default

**Files:**
- Modify: `web/src/types.ts`, `web/src/defaults.ts`

- [ ] **Step 1: Add the field to the TypeScript `ParamTest` interface**

In `web/src/types.ts`, locate the `ParamTest` interface (types.ts:31–62). Just before the closing `}`, add:

```typescript
  /** When true, per-row tick + numeric axis labels are suppressed on the
   *  generated test. The summary header line is still drawn. */
  hide_axis_labels: boolean;
```

- [ ] **Step 2: Set the default**

In `web/src/defaults.ts`, inside `defaultTest()` (defaults.ts:21–51), add just before the closing `};`:

```typescript
    hide_axis_labels: false,
```

- [ ] **Step 3: Type-check the web tree**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

If any existing TS code creates `ParamTest` objects via `Partial<ParamTest>` / manual literals, the added required field may flag them. Search: `grep -rn "ParamTest" web/src` — if anything other than `defaults.ts` constructs a full ParamTest literal, add `hide_axis_labels: false` there. The types.ts file itself and read-only sites (`placement.test.hide_axis_labels`) are fine as-is.

- [ ] **Step 4: Run the web tests**

Run: `cd web && npm test`
Expected: existing tests still pass (they use `defaultTest()`, which now supplies the field).

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/defaults.ts
git commit -m "web: add hide_axis_labels field to ParamTest type + default"
```

---

## Task 8: Web UI — checkbox in `TestEditor`

**Files:**
- Modify: `web/src/components/TestEditor.tsx`

- [ ] **Step 1: Add the checkbox to the Layout section**

In `web/src/components/TestEditor.tsx`, find the line that renders the "Rows (wrapping)" NumberField (TestEditor.tsx:171). Just after it (before the `</Section>` at line 172), insert:

```tsx
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <input
            type="checkbox"
            checked={t.hide_axis_labels}
            onChange={(e) => updateTest({ hide_axis_labels: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#555" }}>
            Hide axis labels (saves ~1.75 mm per row gap; header is kept)
          </span>
        </label>
```

This matches the existing `square_cells` / `unidirectional` checkbox styling (TestEditor.tsx:146–153, 212–221) so the editor stays visually consistent.

- [ ] **Step 2: Manual UI check**

Run: `cd web && npm run dev` (starts Vite). Open the app, create or select a test, toggle "Hide axis labels".

Expected:
- Checkbox toggles cleanly.
- Clicking "Generate" produces an XCS where the test has no tick marks or numeric labels between rows.
- Multi-row tests pack visibly tighter.

Stop the dev server (Ctrl-C) when done.

- [ ] **Step 3: Type-check + tests**

Run:
```bash
cd web && npx tsc --noEmit
cd web && npm test
```
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/TestEditor.tsx
git commit -m "TestEditor: add hide-axis-labels checkbox"
```

---

## Task 9: Full-suite verification

**Files:** none — verification only.

- [ ] **Step 1: Run the complete Python suite**

Run: `pytest -v`
Expected: all PASS.

- [ ] **Step 2: Run the web suite**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 3: End-to-end sanity via CLI**

Generate a multi-row test with and without the flag, visually inspect the XCS:

```bash
xcs-gen generate \
    --x-param speed --x-min 600 --x-max 1500 --x-steps 140 --rows 7 \
    --width 80 --height 3 --gap 0.1 \
    -o /tmp/with-labels.xcs
xcs-gen generate \
    --x-param speed --x-min 600 --x-max 1500 --x-steps 140 --rows 7 \
    --width 80 --height 3 --gap 0.1 \
    --hide-axis-labels \
    -o /tmp/hidden-labels.xcs
```

Compare total canvas heights:
```bash
python - <<'EOF'
import json
for path in ["/tmp/with-labels.xcs", "/tmp/hidden-labels.xcs"]:
    d = json.load(open(path))
    ys = []
    for disp in d["canvas"][0]["displays"]:
        if disp["type"] == "RECT":
            ys.append(disp["y"] + disp["height"])
    print(f"{path}: bottom y = {max(ys):.2f}")
EOF
```

Expected: the `/tmp/hidden-labels.xcs` bottom-y is ~10 mm smaller than `/tmp/with-labels.xcs`.

- [ ] **Step 4: Import one file into xTool Creative Space (optional user-side check)**

Open each file in xTool Creative Space and confirm:
- With labels: header row + 7 gradient rows + numeric ticks between rows.
- Without labels: header row + 7 gradient rows flush with each other.

- [ ] **Step 5: No commit** — verification only. If anything failed, go back to the relevant task and fix.

---

## Summary of commits produced

1. `generators: hide_axis_labels toggle for single-axis path`
2. `generators: hide_axis_labels toggle for dual-axis path`
3. `generators: test QR row_stride_mm shrinks when labels hidden`
4. `schemas: add hide_axis_labels field to ParamTest`
5. `converter: plumb hide_axis_labels + shrink stacked footprint`
6. `cli: add --hide-axis-labels flag to generate command`
7. `web: add hide_axis_labels field to ParamTest type + default`
8. `TestEditor: add hide-axis-labels checkbox`

Each is independently reviewable and reverts cleanly.
