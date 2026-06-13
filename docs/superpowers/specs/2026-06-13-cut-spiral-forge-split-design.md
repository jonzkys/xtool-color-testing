# Cut menu — split Forge into Spiral + Forge (deprecated)

**Date:** 2026-06-13
**Status:** design approved; spec awaiting user review before implementation
**Builds on:** the cockpit redesign (`proto/forge-ui-cockpit` in `/tmp/forge-redesign`, currently merged onto GitHub `main` `6cc4f0d`). See `2026-06-12-forge-ui-cockpit-redesign-design.md`.
**Prototype/serve:** `http://127.0.0.1:8031/#/forge` (vite preview, API proxied to the live backend on 8017).

## Goal

Spiral Cut is becoming the primary severing workflow; standard Forge (seed /
perforate / deepen / clean) is being phased out but kept usable. Split the
single Forge page into two purpose-built pages under a new top-nav `Cut` menu,
and remove the standalone FORGE button.

## Decisions (locked with user 2026-06-13)

- **Spiral page is a purpose-built tool**, not a Forge clone: no strategy
  presets, no stage-param tabs, none of the seed/perforate/deepen/clean
  surface. Spiral is always on.
- **Deprecated Forge gets a banner + a "(deprecated)" menu label**; kept
  **indefinitely** (no removal date in the banner).
- **Nav order:** `Testing · Materials · Engraving · Cut · Experimental`. The
  `Cut` dropdown lists **Spiral** first, then **Forge (deprecated)**.
- **FORGE button removed** from the top-bar right cluster.

## Approach

**Shared engine, two purpose-built page shells.** Both pages reuse the existing
Web Worker, all of `lib/forge/*` (types, defaults, presets, config, estimate,
spiral, contour, depth), `ForgeCanvas`, and `ForgeEstimateStrip`. No engine
changes — the `SPIRAL_CUT` preset already disables every incise stage, empties
`deepen.groups`, enables spiral, and pre-seeds the spiral laser recipe in
`stageParams.CUT_08_SPIRAL`, and the worker/export already handle a
spiral-only config (flat-mode, emboss/incise dropped with the existing
warning).

Two small shared pieces are extracted:
- **`useForgeEngine` hook** — worker lifecycle, the `idle → loading → ready →
  error` state machine, `parse` on file, 150 ms-debounced `generate` on config
  change, and `export` + download. `SpiralPage` consumes it. `ForgePage` keeps
  its current inline plumbing (minimal churn to a file being retired); the hook
  outlives Forge.
- **`ForgeSourcePanel`** — the Validation / Cut target / Preserved layers cards
  (identical on both pages), taking `{ validation, targetIds, selectedIncise,
  onSelectIncise, preservedIds, objects }`.

Rejected alternatives: a single page parameterized by `mode='spiral'|'forge'`
(couples the future to the deprecated path); a full copy-paste of `ForgePage`
into `SpiralPage` (duplicates the machine-profile laser-widget logic the engine
already owns).

## 1. Navigation & routing

- Add a `Cut` group to the TopBar nav menu array (same `{ label, children:
  [{ label, route }] }` shape as the other four roots), positioned after
  `Engraving`:
  - `{ label: "Spiral", route: "spiral" }`
  - `{ label: "Forge (deprecated)", route: "forge" }`
- Remove the standalone FORGE `<button>` and its `route.name === "forge"`
  active styling from the right cluster.
- Router: add `{ name: "spiral" }` → `#/spiral` to the `Route` union,
  `parseRoute`, and `formatRoute`. **Keep** `{ name: "forge" }` → `#/forge` so
  existing links/bookmarks land on the deprecated page.
- The nav-highlight helper (`collapseRouteToNavName`, TopBar.tsx ~323) maps
  both `spiral` and `forge` to the `Cut` group so the menu highlights correctly.

## 2. Spiral page (`#/spiral`, `SpiralPage.tsx`, new)

Cockpit layout (`calc(100dvh - 56px)` pinned root, warp backdrop, header row,
estimate strip, 3-column body) trimmed to one operation.

- **Header row:** "CONTOUR FORGE" → kicker **"SPIRAL CUT"**; file name; Upload /
  format toggle / Export (same controls as Forge).
- **Estimate strip:** unchanged component; naturally renders a single SPIRAL
  segment.
- **Left rail:** `ForgeSourcePanel`. The flat-cut warning surfaces in
  Validation exactly as today.
- **Center:** `ForgeCanvas` (legend shows only the pink **Spiral** swatch over a
  faint source contour), then the docked params tray below it.
- **Right rail — "Cut geometry":** channel width, pitch, min channel, side.
  A collapsed **Setup** disclosure (beam width — feeds the
  `channelWidth / beamWidth` ratio in `spiral.ts:320`; mm/unit override) and a
  collapsed **Debug**. No enable checkbox, no presets, no other stages.
- **Docked tray — "Laser & focus":** `ForgeStageParams` in a new **`lockToGroup`
  (single-stage, no tab strip)** mode locked to `CUT_08_SPIRAL` — the
  machine-profile widgets (power / density / frequency / speed / passes /
  pulse width / laser), focus-descent (per-step / every-N-passes), and
  Z-descent.
- **Dedupe:** passes and focus-descent render **only** in the tray, never in the
  geometry rail (resolves the double-render the cockpit spec flagged as a
  follow-up). Geometry rail = the *shape* of the cut; tray = how the laser runs
  it.
- **Config:** seeded from `SPIRAL_CUT`, locked spiral-only (the page never
  enables other stages); persisted under its own key **`spiral.config.v1`**.

## 3. Forge page (`#/forge`, `ForgePage.tsx`, deprecated)

The redesigned cockpit with spiral surgically removed and a signpost added.

- **Deprecation banner** above the estimate strip: *"Forge is being phased out —
  use [Spiral Cut](#/spiral) for severing cuts."* Persistent (not dismissible),
  no removal date. House error/notice banner styling.
- Remove from this page's UI: the **Spiral Cut** rail section and the **"Spiral
  Cut"** preset `<option>` (Strategy drops to Lean / Aggressive), and the spiral
  **legend/visibility** entry.
- The spiral **stage-param tab** disappears for free: `ForgeStageParams` only
  shows it when `config.spiral.enabled`. Forge's `loadConfig` **coerces any
  stale `spiral.enabled:true` to `false`** (and a stale `activePreset:"spiral"`
  to `"custom"`) so an old `forge.config.v7` can't resurrect it — no
  `ForgeStageParams` prop needed for Forge.
- `ForgePage`'s `visible` map and `CLASSES` list omit `spiral`; everything else
  (seed/perforate/deepen/clean/setup, the `forge.config.v7` key) unchanged. The
  `spiral` `GeneratedClass` stays in the shared types — only this page's UI
  omits it.

## 4. Shared component changes

| File | Change |
|---|---|
| `web/src/pages/SpiralPage.tsx` | **new** — purpose-built spiral cockpit |
| `web/src/components/forge/SpiralControls.tsx` | **new** — "Cut geometry" rail (channel/pitch/min-channel/side) + Setup + Debug |
| `web/src/hooks/useForgeEngine.ts` | **new** — worker plumbing + state machine + parse/generate/export |
| `web/src/components/forge/ForgeSourcePanel.tsx` | **new** — Validation / Cut target / Preserved layers, used by both pages |
| `web/src/components/forge/ForgeStageParams.tsx` | add `lockToGroup` (single-stage, no tabs) mode for the Spiral page |
| `web/src/components/forge/ForgeControls.tsx` | drop Spiral Cut section + "Spiral Cut" preset option |
| `web/src/pages/ForgePage.tsx` | deprecation banner; coerce stale spiral on load; drop spiral from `visible`/`CLASSES`/legend |
| `web/src/components/TopBar.tsx` | add `Cut` nav group; remove FORGE button; highlight helper |
| `web/src/router.ts` | add `spiral` route; keep `forge` |

`ForgeCanvas` and `ForgeEstimateStrip` are reused unchanged.

## 5. State & persistence

- Two independent localStorage keys so the pages never clobber each other:
  `spiral.config.v1` (new, spiral-locked `ForgeConfig`) and `forge.config.v7`
  (unchanged). Both use the existing merge-on-load-onto-defaults pattern.
- Per-page, not persisted (same as today): preview-layer visibility, export
  format toggle, selected cut target, active stage tab.

## 6. Testing & changelog

- `ForgeControls.test.tsx` — drop assertions for the removed Spiral section /
  preset option.
- `ForgeStageParams.test.tsx` — cover the new `lockToGroup` single-stage mode
  and the Forge "no spiral tab" path.
- New `SpiralPage` smoke test: upload `samples/xcs/incise_emboss.xs` → ready →
  single-segment estimate renders → export enabled.
- **Major** changelog entry (`changelog/2026-06-13-cut-spiral-forge.md`):
  "Cut → Spiral & Forge", screenshot of the Spiral page; note the FORGE-button
  removal and the deprecation.
- Browser-verify both pages at 1440×900 against the live backend: `#/spiral`
  (upload → ready, estimate single-segment, tray no-scroll, export round-trips)
  and `#/forge` (banner present, no spiral anywhere, presets Lean/Aggressive).

## Deferred / out of scope

- The remaining cockpit-spec follow-ups (Forge's duplicated layer-count widgets,
  warnings rendered in both Validation and Debug, left-rail card header style)
  are **not** addressed here except where the Spiral page naturally fixes them
  (passes/focus-descent dedupe).
- No engine/worker/lib changes. No new `.xs`/`.xcs` format behavior.
- Eventual deletion of `ForgePage` is out of scope — kept indefinitely.

## Implementation note

Build on `proto/forge-ui-cockpit` in `/tmp/forge-redesign`. When the cockpit
redesign and this split are both ready, they land together (or the cockpit
first, then this) as `feat/forge-ui-cockpit` → `feat/cut-spiral-forge-split`.
