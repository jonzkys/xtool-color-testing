# Gcode Viewer — large-file performance

**Status:** design approved (brainstorm 2026-06-21)
**Page:** `#/gcode` (`GcodeViewerPage`).

## Goal

Make the Gcode Viewer open and interact smoothly with large Studio `.gc`
exports. The reference debug file is **47 MB / 2.83 M lines → 2.8 M segments**
(1 job, 2 layers, 21 blocks); today it is effectively unusable (multi-second
open, ~0.9 GB peak memory, laggy interaction).

## Measured root causes (Node, real file)

- **Memory + worker→main copy (dominant):** the parsed `GcodeFile` is **~473 MB
  of heap** because each of 2.8 M segments is a JS object (`{x,y,s,rapid}`). The
  worker `postMessage`s the whole object graph with **no Transferable**, so it's
  structure-cloned — the main thread allocates a *second* ~473 MB copy (~0.9 GB
  peak) and the clone costs ~1–3 s.
- **Per-render full-segment rescan:** `layerPeakPower` (`GcodeViewerPage.tsx:117`,
  called inline in `layers.map`) walks all 2.8 M segments every render, though
  each block already has a precomputed `peakS`.
- **Undecimated render:** `GcodeCanvas` strokes up to ~2.7 M segments per layer
  (batched into ~18 `Path2D` + offscreen-cached — good) with no sub-pixel
  decimation; building/rasterizing millions of segments takes seconds and
  rebuilds on resize / "show travels" toggle.
- Parse itself is fine (~0.7 s Node; ~1.5–3 s browser).

## Decisions (brainstorm)

- **Render:** sub-pixel **decimation** (collapse moves shorter than ~0.5 device-px
  at the current zoom; visually identical, zoom-aware).
- **Target:** smooth to **~50 MB** (the debug file); larger files still load but
  may be slower (degrade gracefully). NOT solving 200 MB+ here (would need
  streaming parse + tiled/LOD render — a separate, bigger project).

## Part 1 — Typed-array geometry, parse, transfer

### Data model (`web/src/lib/gcode/types.ts`)
Replace the per-segment object list with columnar typed arrays:
```ts
export interface BlockGeometry {
  x: Float32Array;     // vertex X (mm)
  y: Float32Array;     // vertex Y (mm)
  s: Float32Array;     // laser power 0–1000
  rapid: Uint8Array;   // 1 = G0 rapid, 0 = G1 cut
  count: number;       // number of vertices
}
```
- `Block.segments: Segment[]` → `Block.geometry: BlockGeometry`.
- Retire the `Segment` interface (no longer used; parser tracks prev x/y/s as
  scalars).
- `Block.bbox`, `peakS`, `feedF`, `zMoves`, `zAtEnd`; `Layer.totalSegments`;
  `Job`; `GcodeFile` — all unchanged (per-block/per-layer, already computed in
  the single pass).
- Footprint: ~13 B/segment → **~36 MB for 2.8 M segments vs ~473 MB (~13×)**.

### Parser (`parser.ts`)
Same single-pass state machine. Per pending block, accumulate vertices into
small **growable typed-array builders** (capacity-doubling `Float32Array` /
`Uint8Array`), finalized to exact-size arrays at `# motion_end`. Keeps peak
memory low (no giant transient `number[]`), which matters for graceful
degradation on larger files.
- Add a tiny private builder (e.g. `F32Builder` with `push(v)` + `toArray()` and
  `U8Builder`), or one generic helper. Capacity doubles on overflow; `toArray()`
  returns `arr.subarray(0, len)` copied to an exact-size array (so the transferred
  buffer is tight).
- `PendingBlock` holds the builders + `count`; previous-vertex state becomes
  `prevX/prevY/prevS` scalars (replacing `segments[segments.length-1]` reads).
- `bbox`/`peakS`/`feedF`/`zMoves` updates stay inline as today (they already
  read `curX/curY/curS`, not the array).
- `finalizeBlock` builds `BlockGeometry` from the builders.

### Worker transfer (`parser.worker.ts`)
After parsing, walk every block and collect its four `ArrayBuffer`s
(`geometry.x.buffer`, `.y.buffer`, `.s.buffer`, `.rapid.buffer`) into a
`Transferable[]`, then `postMessage(resp, transferList)`. The geometry buffers
**move** to the main thread (zero-copy); the small structural objects clone
trivially. The worker is terminated right after, so losing the buffers is fine.

## Part 2 — Render decimation + cheap fixes

### `GcodeCanvas.tsx`
- **Typed iteration:** the three build passes (travels; power-buckets + cleanup;
  highlight) read `block.geometry` columns (`x[i]`, `y[i]`, `s[i]`, `rapid[i]`,
  `count`) instead of `Segment` objects.
- **Sub-pixel decimation:** extract a small pure helper that, given the geometry
  + the screen transform, yields the indices to draw — emitting a vertex only
  when it is ≥ ~0.5 device-px (screen space) from the last emitted vertex, so a
  dense run of tiny moves collapses to one drawn segment while the visible shape
  is preserved. The buckets/cleanup/travels passes draw segments between
  consecutive emitted vertices (power/rapid taken from the later vertex). The
  offscreen base-cache + 16-bucket batching + highlight overlay are unchanged.
  Decimation runs in the base render (deps already include `width/height/bbox`),
  so it re-decimates correctly when the view size changes.

### `GcodeViewerPage.tsx`
- `layerPeakPower(layer)` → `const m = Math.max(0, ...layer.blocks.map(b => b.peakS)); return m > 0 ? m : null;` — O(blocks), uses the precomputed value; removes the per-render full-segment rescan.
- The params "SEGS" row: `singleBlock.segments.length` → `singleBlock.geometry.count`.
- No other `.segments` reads remain (the params box already uses `block.peakS`/
  `feedF`/`zMoves` and `layer.totalSegments`).

### `LayerPanel.tsx`
Unchanged — it passes `blocks` to `GcodeCanvas` and reads only precomputed
`peakS`/`feedF`/`zMoves`.

## Testing

- **`parser.test.ts`:** update to the columnar model — assert `geometry.x/y/s`
  are `Float32Array`, `rapid` is `Uint8Array`, `count` matches, and values match
  a small hand-written mini-gcode fixture (round-trip). Keep the existing
  `peakS`/`feedF`/`zMoves`/`bbox`/layer-grouping assertions (those are
  unchanged).
- **Decimation unit test (new):** the extracted pure decimation helper — a dense
  sub-pixel polyline collapses to a few emitted indices at a coarse transform;
  a sparse polyline keeps all of them; endpoints are always retained.
- **Worker transfer:** assert the transfer list is assembled (the buffers are
  collected) — full detachment is verified in the browser.
- **Browser golden path:** open the real 47 MB file → fast open; layer list +
  block slider + resize + "show travels" toggle are smooth; the render is
  correct (warm power ramp, dashed travels, white cleanup highlight); a
  million-segment layer pans/zooms without multi-second stalls. Compare DevTools
  heap before/after (~0.9 GB → tens of MB).

## File structure

```
web/src/lib/gcode/types.ts            MOD  BlockGeometry; Block.geometry; retire Segment
web/src/lib/gcode/parser.ts           MOD  growable typed-array builders; scalar prev-state
web/src/lib/gcode/parser.test.ts      MOD  columnar-geometry assertions
web/src/lib/gcode/parser.worker.ts    MOD  collect block buffers → postMessage(resp, transfer)
web/src/lib/gcode/decimate.ts         NEW  pure sub-pixel decimation helper (+ decimate.test.ts)
web/src/lib/gcode/decimate.test.ts    NEW
web/src/components/gcode/GcodeCanvas.tsx   MOD  typed iteration + decimation in the 3 build passes
web/src/pages/GcodeViewerPage.tsx     MOD  layerPeakPower → block.peakS; SEGS → geometry.count
changelog/2026-06-21-gcode-viewer-perf.md  NEW  minor entry
```
(Exact dir is `web/src/lib/gcode/` — verify the path when implementing.)

## Notes / deviations

- Scope is the ~50 MB target; 200 MB+ files (e.g. the 214 MB `samples/xcode`
  ones) load but aren't optimized here (streaming/tiling is a future project).
- `LayerPanel.tsx` is intentionally untouched.
- The decimation helper is pure (geometry + transform → indices) so it's unit-
  testable without a canvas; `GcodeCanvas` consumes it in each pass.
- `s` is stored `Float32` (not `Uint16`) so any fractional/over-range S from
  `parseFloat` survives; the ~6 MB difference is negligible.
