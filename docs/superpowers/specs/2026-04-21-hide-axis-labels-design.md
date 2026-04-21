# Hide Axis Labels on Generated Test Patterns

**Date:** 2026-04-21
**Status:** Accepted (pending plan)

## Summary

Add an opt-in toggle that suppresses the per-row axis tick labels (the
numeric `600 636 672 …` rows between gradient strips) on generated test
patterns. When enabled, the inter-row annotation allowance collapses to
just the user-specified `row_gap`, reclaiming ~1.5–2 mm per row and
letting users fit more rows into the same vertical budget. The summary
header line (`speed 600-1500 / P10.0% …`) stays — this toggle is for the
axis labels only.

## Motivation

When a test's parameters are already known downstream (the XCS is imported
into xTool Creative Space which shows the parameters, or the QR payload
already encodes the sweep), the per-row tick labels are redundant visual
clutter. Today they're always drawn, and they structurally consume
vertical space: `effective_row_gap = max(row_gap, ann_space)` where
`ann_space ≈ tick_length + text_height + 0.1 ≈ 1.75 mm` at the 3 pt
default font. A 7-row wrapped test recovers ~10–12 mm of substrate when
labels are hidden.

## Non-goals

- **Hiding the summary header.** Deferred; out of scope until there's a
  concrete ask.
- **Hiding registration markers** (QR, corner fiducials). They serve a
  different purpose (camera capture / homography) and are not redundant
  on import.
- **Changing the default.** Labels stay visible by default.
- **Hiding tick marks but keeping text**, or vice versa. When the toggle
  is on, both the tick `Line` and the label `TEXT` element are skipped —
  they form one visual unit.

## Architecture overview

One new boolean field threads from the web UI / CLI through the
converter into `generate_gradient()`. The generator branches on the flag
in three places:

1. Skip `_add_tick_and_label` calls for wrapped single-axis rows.
2. Skip `_add_x_axis` + `_add_y_axis` calls for dual-axis grids.
3. Use `ann_space = 0` so `effective_row_gap = row_gap` and the QR
   payload's `row_stride_mm` reflects the tighter stride.

The converter's `_test_vertical_footprint` takes the same flag so
multi-test canvas packing uses the reduced footprint too.

## Components

### Schema (`src/xcs_gen_web/schemas.py`)

Add `hide_axis_labels: bool = False` to `ParamTest`. Default `False`
keeps existing tests unchanged.

### TypeScript types (`web/src/...`)

Add `hide_axis_labels?: boolean` to the `ParamTest` interface mirror.
Optional on the wire so old persisted tests hydrate without the field.

### Generator (`src/xcs_gen/generators.py`)

`generate_gradient()` gains `hide_axis_labels: bool = False`. Internally:

```
ann_space = 0 if hide_axis_labels else (tick_length + 0.05 + text_height(label_font_size) + 0.05)
effective_row_gap = max(row_gap, ann_space) if rows > 1 else 0
```

`_generate_wrapped` and `_generate_dual_axis` accept the flag and
skip their `_add_tick_and_label` / `_add_x_axis` / `_add_y_axis`
calls entirely when it's true. The helpers themselves are unchanged.

The `row_stride_mm` computation at generators.py:252–255 already uses
the same `ann_space` formula; that becomes 0 automatically via the
shared branch.

### Converter (`src/xcs_gen_web/converter.py`)

- `_annotation_space_below(hide_axis_labels: bool) -> float`: returns 0
  when hidden, else the existing value.
- `_test_vertical_footprint` reads `t.hide_axis_labels` and passes it
  to `_annotation_space_below`. Also uses `0` for the bottom-of-stack
  label strip when hidden.
- `project_to_xcs` forwards `hide_axis_labels=t.hide_axis_labels` to
  `generate_gradient()`.

### CLI (`src/xcs_gen/cli.py`)

Add `--hide-axis-labels` (store_true) to the `generate` subcommand and
plumb to `generate_gradient()`. Does not apply to `image` or `svg`
subcommands (they don't draw axis labels).

### Web UI (`web/src/components/TestEditor.tsx`)

A checkbox in the Layout section (near Gap / Rows / Wrapping) with
the label "Hide axis labels".

### Preview (`web/src/components/Preview.tsx`)

No changes required. The current preview draws each test as a single
filled rectangle (not the cell-level layout), so tick marks and axis
labels aren't modelled — the flag simply doesn't affect the preview.

## Data flow

```
TestEditor checkbox
  → ParamTest.hide_axis_labels in project state
  → persisted via whatever ParamTest persistence path is current
  → POST to converter
  → generate_gradient(..., hide_axis_labels=True)
    ├─ branches on flag to skip label emit
    └─ computes ann_space=0 → row_stride_mm stored in QR payload
  → capture pipeline reads row_stride_mm from QR → samples correct cells
```

## Registration impact

This was the primary concern in the brainstorm. Auditing `capture/layout.py`
and `capture_sampling.py`:

| Concern | Status |
| --- | --- |
| QR x/y position | Unchanged — computed from grid rect only. |
| QR size | Unchanged. |
| Corner marker positions | Unchanged — same source. |
| `grid_offset_x/y_mm` in QR payload | Unchanged — depends on QR margin. |
| `row_stride_mm` in QR payload | **Correctly shrinks** — shares `ann_space` branch. |
| Capture sampling | No change — already reads `row_stride_mm` from QR. |

The only invariant that must hold: the `ann_space` value used to compute
`effective_row_gap` (for laying out the rows) must match the one used to
compute `row_stride_mm` (for the QR payload). Both come from the same
local variable in `generate_gradient`, so they stay in sync by
construction.

## Testing

- **Generator:** add cases (co-located with existing gradient coverage
  in `tests/test_roundtrip.py` or a new `tests/test_generators.py`)
  verifying that with `hide_axis_labels=True`:
  - No `TEXT` displays with numeric axis labels are emitted
    (summary header still present).
  - No annotation-layer `LINE` tick marks are emitted.
- **QR payload (`tests/test_qr_payload.py`):** verify that
  `row_stride_mm` equals `row_height + row_gap` when labels are
  hidden and registration is enabled.
- **Converter (`tests/test_converter.py`):** verify that
  `_test_vertical_footprint` returns a smaller value when the flag
  is true, and that stacked tests don't overlap.
- **End-to-end:** generate a 7-row wrapped speed sweep with
  `hide_axis_labels=True`, confirm the generated XCS shows flush rows
  with no numeric labels and a single header line.
- **Backwards compat:** existing stored tests (without the field) must
  hydrate to `hide_axis_labels=False` and render identically to today.

## Open questions

None.

## Rollout

1. Backend schema + generator + converter changes (Python).
2. CLI flag + tests.
3. Web UI: type mirror, checkbox.
4. Ship. No migration — default is `False` so existing tests are
   unchanged.
