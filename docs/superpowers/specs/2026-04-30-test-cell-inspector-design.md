# Test Cell Inspector — design

**Date:** 2026-04-30
**Status:** approved, ready for plan

## Problem

Dense tests (e.g. 10×10) with `hide_axis_labels = true` produce a grid of swatches that is impossible to scan back to params. The information is on the page — every swatch carries `x_value` / `y_value` — but it's not laid out spatially against the warped image, so a user cannot quickly answer "what params produced this cell" or "where in this range is the interesting band". The result feels like a wall of colour with no map.

The fix needs to support two distinct usage modes:

1. **Scan in seconds.** Glance at the result and form a rough idea of which range slices to explore further.
2. **Drill into a specific cell.** Identify the exact params for one cell and inspect the sample.

## Solution

A new "Inspect" mode in `ResultDetailDialog` that overlays an axis grid on top of the cached warped image and lets the user hover (or tap) a cell to surface its params, captured colour, and uniformity (σ). Clicking a cell hands off to the existing `InspectMatchDialog` for the per-pixel sample view.

The toggle becomes a 3-state `Warped / Original / Inspect`. No new dialog component is added — Inspect is an overlay rendered on top of the existing warped image hero.

## Architecture

### Surface

```
ResultDetailDialog
├─ <ModeToggle>  — Warped / Original / Inspect  (3-state, replaces existing 2-state)
└─ <ImageHero>
   └─ when mode === "inspect":
      <TestCellInspector image=warped layout=gridLayout swatches=...>
      ├─ <img class="warped">                  — the cached PNG, scaled-to-fit
      ├─ <AxisOverlay>                         — SVG, absolute over the image
      │  ├─ X-axis ticks + labels              — per-row strip for 1D-wrapped tests,
      │  │                                       single bottom strip for 2D
      │  └─ Y-axis ticks + labels              — left side, one per physical_row
      ├─ <CellHighlight>                       — single SVG rect tracking the cursor
      └─ <CellTooltip>                         — floats near cursor, edge-aware
         ├─ "row × col"
         ├─ "<x_param> = <value>   <y_param> = <value>"
         ├─ swatch chip + hex
         └─ σ and Lab readout
```

### Data flow

1. `ResultDetailDialog` opens with a result + swatches already loaded (existing flow).
2. When the user switches to Inspect mode for the first time, the dialog fetches `GET /api/results/{rid}/grid-layout` once. Result is held in state for the dialog's lifetime.
3. `TestCellInspector` builds a `Map<row|col, ResultSwatch>` once for fast lookup.
4. Mouse/touch event → translate viewport coords to image-pixel coords (using the rendered `<img>`'s `getBoundingClientRect()` and the layout's `image_width_px`/`image_height_px`) → reverse-map to `(row, col)` → look up swatch → render highlight + tooltip.

### Backend

A new endpoint and a small refactor:

- `GET /api/results/{rid}/grid-layout` returns a `GridLayout` payload (see Schema below). Computed lazily from the result's `TestSpec` — pure function, no I/O. Cached against the `result_id` in process memory for trivial reuse; not persisted (cheap to recompute).
- `services/capture.py` factor: extract the public-facing payload from the existing `_grid_layout_for_warped(spec)` into a new `grid_layout_payload(spec) -> GridLayout` helper. The existing capture pipeline keeps using the internal helper unchanged; the new helper composes the same numbers into the public schema.

The endpoint is **lazy by design**: every historical result gains the inspector for free, with no migration story. If the spec contains fields that wouldn't fit (e.g. a future test type without a regular grid), the endpoint returns 422 with a clear `detail` and the frontend falls back to a "Inspect not available for this test" empty state.

## Schema

```python
# src/xcs_gen_web/schemas.py
class GridLayout(BaseModel):
    image_width_px: int
    image_height_px: int
    grid_origin_x_px: float
    grid_origin_y_px: float
    cell_width_px: float
    cell_height_px: float
    row_stride_px: float          # cell_height_px + axis-label gap (or minimal gap if labels hidden)
    cells_per_physical_row: int | None  # None for 2D tests
    physical_rows: int
    px_per_mm: float              # 10.0 today; exposed for forward-compat
```

```ts
// web/src/types.ts
export interface GridLayout {
  image_width_px: number;
  image_height_px: number;
  grid_origin_x_px: number;
  grid_origin_y_px: number;
  cell_width_px: number;
  cell_height_px: number;
  row_stride_px: number;
  cells_per_physical_row: number | null;
  physical_rows: number;
  px_per_mm: number;
}
```

## Geometry

### Forward (cell → image-pixel rect)

```
physical_row = (test is 2D) ? row : floor(col / cells_per_physical_row)
displayed_col = (test is 2D) ? col : col % cells_per_physical_row

cell_left_px = grid_origin_x_px + displayed_col * cell_width_px
cell_top_px  = grid_origin_y_px + physical_row * row_stride_px
cell_right_px  = cell_left_px + cell_width_px
cell_bottom_px = cell_top_px + cell_height_px
```

Used for axis labels (one tick per `displayed_col`, one Y-row per `physical_row`) and for drawing the highlight rect.

### Reverse (mouse → cell)

```
# 1. Viewport → image pixel
rect = imgEl.getBoundingClientRect()
scale_x = image_width_px  / rect.width
scale_y = image_height_px / rect.height
img_x = (mouse_x - rect.left) * scale_x
img_y = (mouse_y - rect.top)  * scale_y

# 2. Image pixel → cell index
col_f = (img_x - grid_origin_x_px) / cell_width_px
row_f = (img_y - grid_origin_y_px) / row_stride_px
displayed_col = floor(col_f)
physical_row  = floor(row_f)

# 3. Reject out-of-bounds and gutter hits
if displayed_col < 0 or displayed_col >= effective_cols: return null
if physical_row < 0 or physical_row >= physical_rows: return null
fractional_x_in_cell = col_f - displayed_col
fractional_y_in_cell = row_f - physical_row
cell_height_fraction = cell_height_px / row_stride_px  # < 1 when there's an axis-label gap
if fractional_y_in_cell > cell_height_fraction: return null  # mouse is in the gutter

# 4. Reconstruct swatch index
if 2D test:
  return (physical_row, displayed_col)
else:
  return (0, physical_row * cells_per_physical_row + displayed_col)
```

Snap rule is **strict in-cell-or-nothing** — if the mouse is in the gutter or outside the grid, the tooltip hides. This keeps the affordance honest (no "I'm hovering this cell" lie when the cursor is on a label or gap).

## UI behaviour

### Hover / move (desktop)

- Tooltip and highlight track the cursor with no debounce. The math is cheap (3 multiplies + 2 floors) so a fresh render per `mousemove` is fine.
- Tooltip positions itself relative to the cell, with edge-aware flipping (right of cursor by default; flips to left if it would clip the dialog edge; flips above if it would clip the bottom).
- When the mouse leaves the image or hits the gutter, both highlight and tooltip vanish.

### Click (desktop)

- Click on a cell → opens `<InspectMatchDialog>` for that `(row, col)`. The inspect dialog renders on top of `ResultDetailDialog`.
- Click in the gutter or outside the grid → no-op.

### Touch (mobile/tablet)

- Tap a cell → tooltip appears anchored to that cell. Tooltip carries an explicit "Inspect →" button that triggers the same dialog hand-off.
- Tap outside the grid → tooltip hides.
- This mirrors the existing tap-then-confirm pattern in the rest of the app and avoids the "what does long-press mean here" ambiguity.

### Loading / fallback states

- Layout fetch in flight: warped image rendered as-is, with a "Building inspector…" badge in the corner. Should be sub-100ms after first hit.
- Layout fetch 422 (test type without a regular grid): inspect mode renders the image untouched, with a footer note "Inspect is only available for grid tests." Toggle stays selectable so the user understands what would have happened.
- Layout fetch 5xx: error toast + revert toggle to Warped.

### Axis label rendering

- **2D tests**: single bottom strip with `x_steps` ticks + `x_value` labels at each `displayed_col`; left strip with `y_steps` ticks + `y_value` labels at each `physical_row`.
- **1D tests, single physical row** (e.g. `x_steps=8, rows=1`): single bottom strip with all `x_value` labels; left strip shows only the row index `0`.
- **1D tests wrapped across physical rows** (e.g. `x_steps=10, rows=3` → physical layout `[4, 4, 2]`): every physical row gets its own X-axis strip directly underneath that row, labelled with the slice of `x_value`s for that row. Left strip shows the physical row index. This is more honest than pretending the wrapped grid has a single continuous axis.

Tick label formatting: `value.toFixed(1)` for floats, integer for integer params. Truncated with ellipsis if labels collide (more than `cell_width_px / 24` characters wide).

## Files

| Layer | Path | Change |
|---|---|---|
| Backend | `src/xcs_gen_web/schemas.py` | Add `GridLayout` model |
| Backend | `src/xcs_gen_web/services/capture.py` | Extract `grid_layout_payload(spec)` helper from `_grid_layout_for_warped` |
| Backend | `src/xcs_gen_web/app.py` | New endpoint `GET /api/results/{rid}/grid-layout` |
| Backend | `tests/web/test_grid_layout_endpoint.py` (new) | Endpoint tests covering 1D / 1D-wrapped / 2D / hidden-axis / non-existent rid |
| Backend | `tests/test_grid_layout_payload.py` (new) | Pure-function tests for the payload helper |
| Frontend | `web/src/types.ts` | Add `GridLayout` type |
| Frontend | `web/src/api/results.ts` | Add `getGridLayout(rid)` helper |
| Frontend | `web/src/components/TestCellInspector.tsx` (new) | The overlay component |
| Frontend | `web/src/components/TestCellInspector.test.tsx` (new) | Reverse-mapping unit tests + component render tests |
| Frontend | `web/src/components/ResultDetailDialog.tsx` | 3-state mode toggle, mounts inspector |

## Testing

### Backend

- `grid_layout_payload(spec)` is pure — exhaustive cases for 1D / 1D-wrapped / 2D / `hide_axis_labels` true and false. Cross-check against `_cell_bounds_px` for a few sample cells in each variant — the public payload's forward math must match the internal sampler exactly, otherwise hover would land on a different cell than what was sampled.
- Endpoint integration test: 200 happy paths, 404 for missing result, 422 for hypothetical non-grid test type (gated on whether the test-type system already supports that — if not, just the happy paths).

### Frontend

- Reverse mapping helper extracted from `TestCellInspector` — pure function, vitest-able without DOM. Cases:
  - 2D in-cell hit, 2D gutter hit, 2D out-of-bounds.
  - 1D-wrapped: hit on physical row 1, col 2 in a 4-per-row layout → returns swatch index 6.
  - 1D-wrapped: hit on the last partial row (physical row 2, only 2 cells) — the unused cell positions return null.
- Component render: mount with a fixture layout + swatches, fire `mousemove` / `mouseleave`, assert tooltip + highlight visibility transitions.
- Visual sanity in browser via the playwright MCP on a 10×10 fixture: confirm axis labels align with cells, hover lands on the right cell, click opens InspectMatchDialog.

## Open questions

None at the time of writing — the design has been walked through and approved section-by-section.

## Out of scope (v2 candidates)

- **Cell pinning / multi-select** — hold a key + click to "pin" a tooltip in place so multiple cells can be compared side by side. Genuinely useful but pushes the UI from "scan + drill" into a stateful comparison mode; defer until we know it's needed.
- **Heatmap colouring of σ** — overlay the variance values as a colour scale so unstable cells visually pop. Useful for capture diagnostics but orthogonal to the params-discovery problem.
- **Keyboard navigation** — arrow keys to step between cells. Lower priority than the hover/tap path.
