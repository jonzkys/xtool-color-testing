# SVG Layers — layer-count reduction via color merge + param collapse

Status: Draft — 2026-04-23
Scope: `web/` only. No backend changes.

## Motivation

The SVG Layers page turns an uploaded SVG or raster into one `LayerSpec` per detected color. Real-world inputs often produce more layers than are operationally meaningful:

- Anti-aliased edges, JPEG noise, and vtracer quantization split visually-identical regions into near-duplicate hexes (`#ff0000`, `#fb0002`, `#f60404` all red).
- After palette-matching, multiple distinct source colors frequently end up with identical laser parameters — redundant work in the generated `.xcs`.

Both produce the same symptom (too many layers to tune) but sit at different pipeline stages. Two features, one shared primitive.

## Features

### Feature A — Color-similarity merge (post-detection, pre-editing)

After detection, the user can collapse layers whose colors are within a ΔE2000 threshold. Triggered manually via a modal preview so the user sees and approves the grouping before it applies. Reversible via a single reset-to-detected action.

### Feature B — Same-params collapse (pre-generation)

Immediately before generating the `.xcs`, layers with byte-identical laser parameters collapse into a single output layer. Toggleable. Strict equality only — no tolerances. Inline, no modal.

## Non-goals

- Fuzzy param-equality with tolerances (palette match is the place for that).
- Schema change to support multi-color `LayerSpec`.
- Backend-side collapse (all logic is browser-side).
- Undo history beyond single-level reset-to-detected.
- Merging into the raster-trace (vtracer) step — vtracer's own `layer_difference` knob covers that.
- Persisting merge state across page reloads.

## Architecture

One new module — `web/src/svg/mergeColors.ts` — exporting three pure helpers shared by both features:

```ts
type MergeGroup = { sourceColors: string[]; representativeColor: string };

mergeColorsInSvg(svgText: string, groups: MergeGroup[]): string;
computeColorMergeGroups(
  layers: LayerSpec[],
  shapeCountsByColor: Record<string, number>,
  thresholdDeltaE: number,
): MergeGroup[];
computeParamMergeGroups(layers: LayerSpec[]): LayerSpec[][];
```

`mergeColorsInSvg` parses the SVG with `DOMParser`, walks every element, and rewrites `fill`/`stroke`/inline-`style` colors that match any group's `sourceColors` to that group's `representativeColor`. Returns a new SVG string. No backend calls.

Feature A calls it when the merge modal is confirmed. Feature B calls it inside `handleGenerate` as a last-mile transform. After Feature A's rewrite, the existing `detectSvgLayers` endpoint re-runs to rebuild the layer list. After Feature B's rewrite, the generated request is posted and discarded — the editor state is never mutated by the collapse.

### State additions in `SvgLayersPage`

- `originalSvgContent: string | null` — as-uploaded SVG before any merges; enables reset.
- `colorMergeSimilarity: number` — 0–100% slider value; converted to ΔE under the hood.
- `collapseIdenticalLayers: boolean` — Feature B toggle, default **on**.
- `mergeDialogOpen: boolean` — merge-preview modal visibility.

### No backend change

The backend continues to see one color per layer. Pydantic request shape unchanged. No alembic migration. No `services/svg_layers.py` edits.

## UI

The existing left sidebar (300px column) stays dense and utilitarian. All additions reuse existing primitives — `Section`, `Button`, `Badge`, `Dialog`, `Card` — and existing design tokens (`--color-primary`, `--color-primary-tint`, JetBrains Mono for hex).

### Merge entry point (Layers section header)

The `Section` "Layers (N)" gets one action: a compact ghost `Button` labeled `[Combine icon] Merge similar colors…` (lucide `Combine` icon). Hidden when `request.layers.length < 2`. Clicking opens the modal.

Next to the layer count, when `request.svg_content !== originalSvgContent`, a ghost `Badge` appears with the text `merged · reset`. Using `--color-primary` text on `--color-primary-tint`. Click = reset to detected (sets `request.svg_content = originalSvgContent` and re-runs `detectSvgLayers`).

### Merge-preview modal (`MergeColorsDialog`)

Uses the existing `Dialog` primitive. Title: "Merge similar colors."

Body:

- Top row — similarity readout, mirroring `PaletteMatchSection`'s "{percent} match · ΔE {value}" cadence:
  ```
  Similarity threshold                    95% match · ΔE 2.5
  [●────────────────────────────]
  80%                                                    100%
  ```
  The slider track uses `--color-border-strong`; filled portion uses `--color-primary`. The mapping is the same `100 - dE * 2` conversion used by `deltaEToPercent()` in `SvgLayersPage.tsx`. Range: 80%–100%. Default: 95%.

- Groups list — one card per group with ≥2 colors. Singletons are not rendered.
  ```
  ┌──────────────────────────────────────────────────┐
  │ ██ ██ ██       →    ┃███┃  #FF0000               │
  │                                                   │
  │ 3 colors  ·  1,247 shapes  ·  ΔE ≤ 2.1           │
  └──────────────────────────────────────────────────┘
  ```
  Source swatches: 24×24 rounded tiles (`rounded-[4px]`), no text, clickable (click promotes that color to representative). Representative: 36×36 tile with a `--color-primary/30` ring plus the hex in JetBrains Mono `[11px]`. Meta line: `[11px]`, `--color-ink-subtle`, same treatment as `Section`'s description row.

- Footer — `Button[variant="ghost"]` Cancel and `Button[variant="primary"]` `Merge N colors → M`.

Live behavior: as the slider moves, the group list recomputes. `useDeferredValue(similarityPct)` wraps the clustering input to avoid input lag. O(N²) over ≤32 colors — microseconds.

On Confirm:
1. Compute final `MergeGroup[]` from the group state.
2. `newSvg = mergeColorsInSvg(request.svg_content, groups)`.
3. `setRequest({ ...request, svg_content: newSvg })`.
4. `detectSvgLayers(newSvg, request.width_mm)` runs via the existing `useEffect` path.

On Cancel: close, no state change.

### Feature B toggle (Project section)

Above the existing "Subtract overlaps" row:

```
☑ Collapse identical layers                     [3→1]
   Layers with the same params merge into one output.
```

- Checkbox, default on. Same visual treatment as "Subtract overlaps."
- Right-aligned `Badge[variant="primary"]` showing `{before}→{after}`. Only present when `computeParamMergeGroups` returns ≥1 group; otherwise the trailing region is empty (label width stays fixed so the row doesn't jitter).

## Algorithms

### Color clustering — `computeColorMergeGroups`

Greedy star clustering, dominant-first seeding:

1. Pre-compute `Lab` for each layer's color via existing `hexToLab` (`web/src/color/math.ts`).
2. Sort layers by `shapeCountsByColor[color]` descending. Dominant colors seed clusters first.
3. Walk in that order. For each not-yet-assigned layer:
   - Open a cluster with it as representative.
   - Scan remaining unassigned layers; absorb any with `deltaE2000(seedLab, candidateLab) ≤ threshold`.
4. Return only clusters with `sourceColors.length ≥ 2`.

Star (seed + satellites) rather than transitive single-linkage: predictable and matches user intuition. N ≤ 32 (vtracer cap) → O(N²) is trivial.

Threshold conversion: `dE = (100 - similarityPct) / 2` — the inverse of `deltaEToPercent`.

`shapeCountsByColor` is derived from `rawDetected` (kept in existing state). Gives the modal's meta line its "1,247 shapes" total (summed across each group).

### SVG rewriter — `mergeColorsInSvg`

- `DOMParser("image/svg+xml")`; fail-fast if `querySelector("parsererror")` matches.
- Build `Map<normalizedSourceHex, repHex>` once from `groups`.
- `doc.querySelectorAll("*")` — for each element:
  - Read candidate colors via the four-probe pattern the preview already uses (`fill` attr, `stroke` attr, inline style `fill:`/`stroke:`).
  - Normalize with `normalizeColor`.
  - If a normalized candidate matches the map, rewrite that attribute/style-declaration to the rep hex. Multiple matches on the same element all get rewritten.
- Serialize with `XMLSerializer`.
- Re-prepend the `<?xml ?>` prolog if the original had one (XMLSerializer strips it).

Colors that don't normalize to a hex (`currentColor`, `url(#gradient)`, `none`) pass through untouched.

### Param equality — `computeParamMergeGroups`

Canonical key per **enabled** layer:

```ts
{
  processing_type,
  power, speed, frequency, density, passes, pulse_width, laser,
  scan_angle, angle_mode,      // omitted when processing_type === "HATCHED_LINES"
  hatch_passes,                // included as-is (order matters) when HATCHED_LINES
}
```

Explicitly excluded: `color`, `name`, `enabled`, `material_id` (layer-origin provenance, not behavior).

Group via `Map<JSONString, LayerSpec[]>`. Drop singletons. Return in a stable order. Representative is the first occurrence in `request.layers`.

### Generate-time collapse flow

In `handleGenerate`:

1. If `!collapseIdenticalLayers` → send `request` unchanged.
2. `paramGroups = computeParamMergeGroups(request.layers.filter((l) => l.enabled))`. If empty → send unchanged.
3. Build `MergeGroup[]` — for each param group, `sourceColors` = all members' colors, `representativeColor` = first member's color.
4. `collapsedSvg = mergeColorsInSvg(request.svg_content, mergeGroups)`.
5. `collapsedLayers` = `request.layers` with non-representative group members removed (representatives retained in their original position).
6. POST `{ ...request, svg_content: collapsedSvg, layers: collapsedLayers }`.

Editor state never mutates. On network failure the user sees the same layer list they were editing.

## Shared extraction: `web/src/svg/color.ts`

`NAMED_COLORS` and `normalizeColor` currently live as file-private functions at the bottom of `SvgLayersPage.tsx`. Move them into `web/src/svg/color.ts` so `mergeColors.ts` can reuse the exact same normalization. `SvgLayersPage.tsx` re-imports. No behavior change.

## Edge cases

| Case | Behavior |
| --- | --- |
| `fill="currentColor"` / `url(#grad)` / `none` | Ignored by rewriter — doesn't normalize to a hex. |
| Nested `<g>` with inherited fill | Each element's own probes run; `<g>` with its own fill also rewritten. Parity with existing preview walk. |
| Re-trace after a merge | `retrace()` resets both `originalSvgContent` and `request.svg_content` to the new trace output. Previous merges discarded; slider value persists (user intent, not data). |
| Near-white filter | Merges operate on `request.layers` (visible). Near-white layers naturally excluded. Toggling "Include white" after a merge surfaces untouched whites as fresh un-merged entries. |
| Slider thrash | `useDeferredValue` around the threshold fed to clustering. No timers. |
| Disabled layers | Excluded from Feature B's canonical-key grouping. Still present in the request layer list with `enabled: false`. |
| Losing a user-named layer on collapse | Acceptable — user opted in via the toggle; the `[3→1]` badge advertises the effect. |
| Generate network failure | Transform is local to the closure. Editor state untouched. Retry works. |
| `< 2` layers | Merge button hidden; collapse badge absent. |
| SVG parse failure inside rewriter | `mergeColorsInSvg` throws; caller shows the error via the existing `detectError` / `errorMessage` banners. |

## File changes

**New (4):**
- `web/src/svg/color.ts` — extracts `NAMED_COLORS` + `normalizeColor`. ~30 LOC.
- `web/src/svg/mergeColors.ts` — three helpers + `MergeGroup` type. ~150 LOC.
- `web/src/svg/mergeColors.test.ts` — Vitest. ~200 LOC.
- `web/src/components/MergeColorsDialog.tsx` — modal. ~180 LOC.

**Modified (1):**
- `web/src/components/SvgLayersPage.tsx`:
  - Remove local `NAMED_COLORS` + `normalizeColor`; import from `svg/color.ts`.
  - Add `originalSvgContent`, `colorMergeSimilarity`, `collapseIdenticalLayers`, `mergeDialogOpen` state.
  - `applyDetectedSvg`: set `originalSvgContent` on first load / re-trace; preserve across merge-driven re-detections.
  - Layers section header: merge button + merged/reset badge.
  - Project section: collapse-identical toggle + count badge.
  - `handleGenerate`: add the collapse transform.
  - ~+80 LOC net.

**Unchanged:** everything else. No backend, no schema, no types, no Python, no docs.

## Testing

Vitest (matches existing `router.test.ts` / `TestPreview.test.ts`):

- `mergeColors.test.ts`:
  - SVG rewrite — attribute `fill`, attribute `stroke`, inline `style` fills, nested `<g>`, `fill="none"` passthrough, `currentColor` passthrough, `url(#gradient)` passthrough, `<defs>` preserved.
  - Color clustering — single cluster (all reds), multi cluster, all-singletons at threshold, shape-count dominance tie-breaking.
  - Param grouping — identical enabled layers collapse; differing `scan_angle` for non-hatched prevents collapse; identical `hatch_passes` arrays collapse; reordered `hatch_passes` does NOT collapse; disabled layers excluded.
- `SvgLayersPage.test.tsx` — render, click merge, confirm modal, assert `request.layers.length` shrinks and `request.svg_content !== originalSvgContent`. Inline fixture SVG with three near-reds.

No backend tests.

## Rollout

Ship behind no flag — both features are opt-in at the UI level (user has to click the merge button or leave the collapse toggle on; latter is safe by strict-equality guarantee). No migration concerns. `web/dist` rebuild required — `xcs-gen serve` mounts `web/dist/`, so `npm run build` before deployment.

## Open questions

None.
