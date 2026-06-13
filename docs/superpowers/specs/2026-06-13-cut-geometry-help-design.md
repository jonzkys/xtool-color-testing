# Cut geometry help modal

**Date:** 2026-06-13
**Status:** design approved; implementing on `feat/cut-geometry-help` (stacked on `feat/spiral-redesign`)
**Verify on:** http://127.0.0.1:8017/#/spiral

## Goal
Explain the spiral cut-geometry params in place: a **?** icon by the "Cut geometry"
heading opens a modal with an annotated diagram + plain definitions.

## Design

**`SpiralGeometryHelp.tsx` (new, self-contained)** — renders its own `?` trigger
button and the `Dialog`, manages its own open state, no props. `SpiralControls`
drops `<SpiralGeometryHelp />` into the Cut geometry card header next to the ↺
reset.

- **Trigger:** a small `?` button matching the reset button's styling (≈20px,
  bordered, muted → primary on hover), `aria-label="What do these settings do?"`.
- **Modal:** existing `Dialog` / `DialogContent width="md"` + `DialogHeader` /
  `DialogTitle` ("Cut geometry") / `DialogDescription` ("How the spiral channel
  is built").
  - **Annotated SVG diagram** (inline, ~520×220, theme tokens): a slate part
    edge with ~5 brand-pink concentric arms on the scrap (outside) side, with
    mono leader-line labels — **channel width** (edge → outer arm), **pitch**
    (between two adjacent arms, zoomed callout), **min channel** (a pinched thin
    neck), **side** (arrow showing outside; note inside = holes). aria-hidden;
    the definition list carries the accessible text.
  - **Definition list** (`dl`, house mono register) — one row per param, drawn
    from the engine's own field semantics (`SpiralConfig` in
    `web/src/lib/forge/types.ts`):
    - Channel width (mm) — total venting channel swept on the scrap side; wider
      severs cleaner (0.8 = brass default).
    - Pitch (mm) — spacing between spiral arms; ~a beam width so arms overlap
      and the channel fully ablates.
    - Min channel (mm) — floor the channel shrinks toward in a thin neck before
      Forge falls back to a warning.
    - Side — which side of the contour the channel runs: outside (into scrap
      around the part) or inside (into holes).

## Files
| File | Change |
|---|---|
| `web/src/components/forge/SpiralGeometryHelp.tsx` | **new** — `?` trigger + Dialog + diagram + definitions |
| `web/src/components/forge/SpiralControls.tsx` | render `<SpiralGeometryHelp />` in the Cut geometry header |

No engine/worker/lib changes.

## Testing & changelog
- `tsc` clean; existing suite unaffected.
- Browser-verify on 8017: `?` opens the modal, diagram + definitions render,
  Esc/close/overlay dismiss work, focus trap OK (Radix).
- **Minor** changelog entry.
