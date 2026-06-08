# Pixel Art — Expanded palette picker (Similar / Favourites / All)

**Date:** 2026-06-08
**Status:** Approved (brainstorm); awaiting implementation plan
**Builds on:** `docs/superpowers/specs/2026-05-03-pixel-art-design.md`

## Summary

When a Pixel Art layer is selected, the picker (`ExpandedLayerPanel` in
`PixelArtLayerPanel.tsx`) currently lists only the **8 nearest palette
entries by ΔE2000**. There is no way to reach a non-nearest entry — you
can't pick a favourite that happens to be perceptually far, and you can't
scroll the full palette to choose manually.

This change reworks that one panel into **three stacked sections** —
**Similar**, **★ Favourites**, **All** — so the user can reach *any*
existing palette entry for the active material. It is a pure
frontend/presentation change: no backend, no schema, no new persistence,
and the selection contract (`onChooseMatch(color, entry)`) is unchanged.

## Goals

- Reach **any** existing palette entry for the active material, not just
  the 8 nearest.
- Surface **favourites** explicitly, each with its similarity (ΔE) to the
  layer colour.
- Make the **full palette** browsable in a **hue-sorted**, filterable list.
- Use the panel's available height: Similar + Favourites visible at once;
  All expands in place.
- Keep the existing selection wiring, Clear action, and empty-state intact.

## Non-goals

- **No custom-hex / brand-new-colour input.** A layer needs validated burn
  params; an arbitrary colour has none. Out of scope (decided in brainstorm).
- **No persistence changes.** Everything derives from the `paletteEntries`
  already loaded for the active material. *(Originally "no backend/schema
  changes" too — superseded by the Addendum below, which adds one optional
  `display_color` field so the matched colour reaches the preview + export.)*
- **No change to the other pickers.** SVG-layers / Loom have their own
  match UIs; bringing them in line is a possible follow-up, not this change.
- **No change to quantisation, matching defaults, or `onChooseMatch`/`onRematchAll`.**

## Decisions taken

| # | Question | Decision | Why |
|---|---|---|---|
| Q1 | "Manually select a custom one" = ? | **Pick any *existing* entry** (browse Favourites + All). No custom hex. | A custom colour has no validated params; defaulting them is a guess. Browsing existing entries meets the need. |
| Q2 | Layout | **Three stacked sections** in one panel (Similar / Favourites / All). | Uses the tall panel; several lenses visible at once (vs. a tab switch showing one at a time). |
| Q3 | "All" sort order | **By hue** (HSL hue; neutrals last by lightness). | Perceptually-near colours sit together — scannable like a colour wheel. Raw RGB-integer sort scatters similar colours. |
| Q4 | Default expansion | Similar + Favourites **open**; All **collapsed** by default. | Similar is the common case; All is the escape hatch — keep the panel short until needed. |
| Q5 | Big palettes | A **filter box** (name or hex substring) at the top of All. | 100+ entries need a way to jump to one without scrolling. |
| Q6 | Favourites with no entries | **Hide the section** entirely. | No dead/empty section taking vertical space. |
| Q7 | Scope of pages | **Pixel Art picker only.** | Keep the change focused; other pickers are a separate follow-up. |

## Architecture

The panel stays a single component fed by the same props
(`row`, `paletteEntries`, `library`, `onChooseMatch`, `onClose`). The only
new logic is **pure derivation** of three ordered lists from
`paletteEntries` + the layer colour, plus local UI state for
"how many Similar shown", "All expanded?", and the All filter text.

```
paletteEntries (active material)  +  row.color
        │
        ├── nearestByDeltaE(entries, color)         → Similar  (slice to `shownCount`, default 8)
        ├── favourites(entries) sorted by ΔE        → Favourites (hidden if empty)
        └── hueSorted(entries) ∩ filter(text)       → All  (collapsed by default)
        ▼
  ExpandedLayerPanel renders three <section>s; every row is a button
  → onChooseMatch(row.color, entry)   (unchanged contract)
```

Pure helpers live next to the component (or in a small sibling module) so
they're unit-testable in isolation:

- `rankByDeltaE(entries, color): { entry, dE }[]` — existing ΔE2000 ranking,
  extracted so Similar and the per-row ΔE readouts share one source.
- `hueOf(hex): number` — HSL hue 0–360; saturation ≈ 0 → sentinel that sorts
  neutrals to the end (by lightness).
- `hueSorted(entries): PaletteEntry[]`.
- `matchesFilter(entry, query, library): boolean` — case-insensitive match on
  the entry's display label (`paletteEntryLabel`) and its hex.

## Components & state

`ExpandedLayerPanel` gains local state (all `useState`, reset when `row.color`
or palette identity changes):

- `similarShown: number` — starts at `SIMILAR_PAGE = 8`; "Load more" adds
  `SIMILAR_PAGE` until `>= ranked.length`.
- `allOpen: boolean` — starts `false`.
- `allFilter: string` — the All filter box text; `""` by default.

Section rendering:

1. **Similar** — `ranked.slice(0, similarShown)`. Footer shows
   `Load more (shown of total)` when more remain; clicking grows
   `similarShown`. Always rendered (unless palette empty).
2. **★ Favourites** — `ranked.filter(r => r.entry.favorited)` (already ΔE
   sorted), each row shows ΔE. Rendered only when ≥ 1 favourite.
3. **All** — header is a toggle (`All · N · sorted by hue`); when `allOpen`,
   render a filter input + `hueSorted(entries)` filtered by `allFilter`,
   each row swatch + label + ΔE, in a scroll area.

A shared `EntryRow` sub-component renders one selectable row (swatch, label,
ΔE, ✓ when `row.matchedEntry?.id === entry.id`) so the three sections stay
visually identical and an entry appearing in two sections looks the same.
**Clear match** stays as the bottom action (unchanged).

## Data flow

No network. `paletteEntries` is already fetched per active material by the
page. Selecting calls `onChooseMatch(row.color, entry)` exactly as today;
the page stores it in `matchByColor` and the export/preview pick it up. An
entry may appear in more than one section (e.g. a near favourite) — sections
are filtered *views*, not exclusive buckets.

## Error / edge handling

- **Empty palette** → existing "No palette entries… add some on the Palette
  tab" hint (unchanged); no sections.
- **No favourites** → Favourites section omitted.
- **Filter matches nothing** in All → a quiet "no matches" line.
- **Malformed hex** on the layer colour → ΔE ranking falls back to 0 (today's
  behaviour); hue sort still works off each entry's own hex/lab.
- Large palette (100+) → All is collapsed by default and filterable; render
  is O(entries) like today's ranking, well within budget.

## Tests

| Layer | File | Coverage |
|---|---|---|
| Pure helpers | `PixelArtLayerPanel` sibling test (or `pixelArtHelpers.test.ts`) | `rankByDeltaE` orders nearest-first; `hueOf` maps primaries to expected ranges and flags neutrals; `hueSorted` yields rainbow-then-neutrals; `matchesFilter` matches label + hex, case-insensitive. |
| Component | `PixelArtLayerPanel.test.tsx` | three sections render; **Favourites hidden when no favourites**; **Load more** grows the Similar list and disappears when exhausted; **All collapsed by default**, expands on toggle; **filter** narrows All and shows "no matches" when empty; selecting any row calls `onChooseMatch` with that entry; Clear calls `onChooseMatch(color, null)`. |
| Manual (CLAUDE.md) | Chrome | Load Pixel Art, select a layer, screenshot the three sections; confirm Load more, favourites ΔE, hue order, and filter behave; pick from All and confirm the layer + preview update. |

## File / module map

```
web/src/components/
  PixelArtLayerPanel.tsx        EDIT  ExpandedLayerPanel → 3 sections + state; extract EntryRow
  PixelArtLayerPanel.test.tsx   EDIT  section/Load-more/filter/favourites coverage
  (helpers)                     NEW   hueOf / hueSorted / rankByDeltaE / matchesFilter
                                      (co-located or in pixelArtHelpers.ts) + unit tests

changelog/
  2026-06-08-pixel-art-palette-picker.md   NEW  minor (visible picker enhancement)

backend / schemas / alembic            NO CHANGE
```

After `web/src/**` edits: `cd web && npm run build` (the backend serves
`web/dist/`, not the Vite dev server).

## Followups (out of scope)

- Apply the same three-section picker to the **SVG-layers / Loom** match UIs.
- **"Validated only"** filter chip in All (mirrors the svg-layers toggle).
- Remember the user's last All-expanded / sort preference across sessions.

---

## Addendum (2026-06-08): matched colour in preview + export

Folded into the same PR after review surfaced that picking a palette colour
didn't change what you *see*. The Representative canvas painted the raw
k-means centroid, and the exported `.xcs`/`.svg` layer swatch used the
centroid hex too — so a matched layer looked like the source colour, not the
validated palette colour the burn produces.

**Change:** a layer carries its matched palette entry's hex, and that hex (not
the centroid) drives the preview paint, the `.xcs` `layer_color`, and the SVG
`fill`. Unmatched layers still use the centroid.

- **Frontend** — `previewState` paints `row.matchedEntry?.hex ?? row.color`
  (disabled-dimming preserved); `buildRequest` sends `display_color` per layer.
- **Backend (the one schema change)** — `PixelArtLayerSpec.display_color:
  str | None` (hex pattern, default `None`); `build_pixel_art_project` emits
  `layer_color = layer.display_color or shape.color`, and `pixel_art_to_svg`
  fills with the same. The shape↔layer match key stays the centroid hex.
- **Tests** — converter test asserts `display_color` overrides both
  `layer_color` and the SVG fill, and that `None` falls back to the centroid.

Burn parameters are unaffected — they always came from the matched entry. This
only aligns the *colour you see* (preview + exported swatch) with the *colour
the burn produces*.
