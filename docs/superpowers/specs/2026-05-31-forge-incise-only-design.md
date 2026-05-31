# Contour Forge — incise-only input support

**Status:** approved design (2026-05-31)
**Owner:** Jon
**Route:** `#/forge`
**Extends:** `2026-05-25-contour-forge-design.md` (v1 + sliver-band addendum)

## Problem

Forge refuses to export unless the uploaded `.xcs` contains an emboss
object. `ForgePage.tsx:203` pushes a hard validation error — *"No
emboss-mode (RELIEF) object found."* — whenever `embossIds.length === 0`,
and that error disables the Export button via `canExport`
(`ForgePage.tsx:215-219, :247`). The v1 spec listed *"no emboss object"* as
an intentional hard stop.

But the geometry pipeline never consumes the emboss layer: `runPipeline`
(`pipeline.ts:32`) operates **solely on one selected incise contour** and
`buildGeneratedXcs` (`xcs.ts:225`) preserves every other object untouched.
The fibre-brass workflow includes designs that are **incise-only** —
outlined text/shapes to cut, with no raised relief. Those should convert to
a "smart cut" too.

In the F2 Ultra Embossment workflow the only modes are **emboss / incise /
score** (per the v1 addendum) — there is no `VECTOR_CUTTING`. So a "smart
cut" *is* the existing staged **incise (INTAGLIO)** program (incise =
area-fill engrave, used to cut brass). **The output format does not
change.**

## Goals

- An incise-only `.xcs` (no `RELIEF`) parses, previews, and exports a smart
  cut with no emboss present.
- The canonical fixture `samples/xcs/test-text.xcs` flows cleanly: its
  single real contour is auto-selected, and **every black element — letters,
  counters, and both disjoint ring+dot decorations — is cut**.
- Scale (`mmPerUnit`) is correct even when the file carries no job
  `perimeter`.
- The left-panel object lists reflect reality: no phantom (no-geometry)
  objects, no mislabeling.
- `samples/xcs/incise_emboss.xcs` (emboss + incise) keeps working unchanged.

## Non-goals (this change)

- **Output-format change.** Stays INTAGLIO multi-stage sliver-bands;
  confirmed intentional (incise area-fill, not single-line cutting).
- **Multi-target simultaneous forging.** One selected target, per v1.
- **Perforation across disjoint islands.** `generatePerforationPaths` keeps
  placing pockets on the largest island only (`partOuterLoop`,
  `offset.ts:230`). Small inner circles get the cut bands but no tabs.
- **A full class-reassign dropdown.** v1 intended one ("misdetection never
  silent or fatal") but it was never built. Deferred — see Follow-ups.

## Verified findings (current behaviour, traced on `test-text.xcs`)

`parseXcsFile` (`xcs.ts:66-80`) iterates **device-map** entries and attaches
a `dPath` only when a matching `canvas[0].displays[]` entry exists
(`:62, :68, :76`). `test-text.xcs` has **7 device entries but only 1 real
canvas path** (`73b08ff7`, a 17-subpath compound). Consequences:

| # | Severity | Location | Finding |
|---|---|---|---|
| 1 | blocks (other files) | `ForgePage.tsx:203` | Hard emboss requirement. A *pure*-INTAGLIO file (no score either) hits this and cannot export. |
| 2 | wrong taxonomy | `xcs.ts:6` | `EMBOSS_TYPES` includes `VECTOR_ENGRAVING` (= **score**), so `test-text.xcs`'s 2 score strokes read as "emboss". It ironically *slips past* gate #1 — but the model is wrong. |
| 3 | confusing UI | `xcs.ts:66-80` → `forge.worker.ts:30-31` | One object is created per device entry with no `dPath` filter. `test-text.xcs` → **5 "incise" objects (4 with no geometry)** + 2 phantom "emboss". Selecting a phantom throws *"not a usable vector/path contour"* (`ForgePage.tsx:208`). |
| 4 | mislabel | `ForgePage.tsx:310, :328` | Lists hardcode `· RELIEF` / `· INTAGLIO` regardless of the real `processingType`. |
| 5 | silent scale risk | `xcs.ts:129-143` | Calibration needs a job `perimeter`; `test-text.xcs` has `perimeter: null` (`material: 0`), so it falls back to `mmPerUnit = 1.0`, **not confident** + a warning (`pipeline.ts:48-49`). |
| 6 | stale copy | `ForgePage.tsx:264` | Idle screen says the file "must contain one emboss (RELIEF) object". |

**Scale recovery.** The canvas is already in mm and `canvasX = unit·scale +
offset` (`xcs.ts:246-247`). The selected display's `scale.x` is therefore
the authoritative units→mm factor. `test-text.xcs` has `scale = (1.0, 1.0)`
(so `1.0` is in fact correct); the confident-calibration reference
`incise_emboss.xcs` has `scale.x = 0.848`, matching its perimeter-derived
value. This gives an always-available calibration fallback.

**Disjoint-island handling.** All 17 subpaths (incl. `sub#8 ⊃ sub#11` ring+dot
@ ~36,47 and `sub#9 ⊃ sub#12` @ ~80,47) belong to the one target.
`buildPartRegion` (`offset.ts:165`) runs a clipper boolean over **all** loops
and returns a multi-component region; `bandFromRegion` (`:199`) →
`offsetRegion` (`:63`) offsets the **whole region at once**. With the default
`sideMode: "outside"` (`defaults.ts:6`), `outer = offset(part, +w)`,
`inner = part` — both always non-empty for a non-empty region — so **each
island, including the small circles, gets a proper even-odd kerf band**. The
degenerate-drop guard (`offset.ts:221`) is whole-region, so a big design +
small circles never trips it. `sub#16` (0.02 mm sliver) is harmlessly
dropped (`<3` points after `simplifyLoop`).

## Design

### 1. Classification — `xcs.ts:5-12`

- `INCISE_TYPES = {INTAGLIO, VECTOR_CUTTING}` — unchanged (cut targets).
- Narrow emboss: **`EMBOSS_TYPES = {RELIEF}`** only.
- `VECTOR_ENGRAVING` / `FILL_VECTOR_ENGRAVING` / `COLOR_FILL_ENGRAVE` →
  classify as **`score`** (a new `modeClass`) rather than `emboss`. (`score`
  + any unknown remain "preserved, non-target" layers.)
- Add a derived `hasGeometry: boolean` (`= !!dPath`) to `XcsObject`
  (`types.ts`) so targets vs phantoms are explicit downstream.

`modeClass` becomes `"incise" | "emboss" | "score" | "other"`.

### 2. Phantom filtering — `forge.worker.ts:27-32` (+ a parse helper)

The worker's `parsed` response distinguishes:
- **target candidates** = incise-class objects **with geometry**
  (`hasGeometry`). `test-text.xcs`: 5 → **1** (`73b08ff7`).
- **preserved layers** (display only) = non-incise objects **with geometry**
  (emboss / score / other). Phantom no-geometry entries appear in **neither**
  list. They remain byte-intact in the exported `raw` (`buildGeneratedXcs`
  only removes the selected target's display + device entry), so nothing is
  corrupted.

Keep the full `parsed.objects` array for fidelity/debug; derive the two
display lists from it.

### 3. Validation / gate — `ForgePage.tsx:200-219`

- **Delete** the emboss requirement (`:203`).
- Require **≥1 geometry-bearing incise target**; if none →
  *"No incise contour with usable geometry found."*
- Keep *"Multiple incise objects — select a target contour."* when >1
  candidate and none selected (`:205`).
- Keep the selected-target-has-geometry safety net (`:208`); phantoms are no
  longer selectable, so it becomes belt-and-braces.
- `canExport` (`:215-219`) is unchanged and clears automatically.

### 4. Calibration fallback — `xcs.ts:129-143`

Resolve `mmPerUnit` via the first source that yields a positive value, all
marked **confident** except the last:

1. job `perimeter / flattened-path-perimeter` (current behaviour);
2. **selected display's `scale.x`** (when uniform and positive);
3. **display `width` / flattened-bbox width** (curve-aware bbox from the
   already-flattened contour);
4. `1.0`, **not confident** + existing warning.

`calibrateMmPerUnit` gains access to the selected canvas display (look up by
`incise.id` in `raw.canvas[0].displays`). A unit test asserts (2) reproduces
(1) on `incise_emboss.xcs` before we rely on it.

### 5. UI panels + labels — `ForgePage.tsx:303-332`

- "Emboss objects" → **"Preserved layers"**: read-only list of the preserved
  (geometry-bearing, non-target) layers, each with its **real**
  `processingType` (RELIEF / VECTOR_ENGRAVING / …) and a one-line note that
  they pass through untouched. Friendly empty-state when there are none.
- "Incise objects" → **"Cut target"**: radio list of geometry-bearing incise
  candidates, labelled with the real `processingType`. Auto-select when
  exactly one (existing `:118` logic, now fed the filtered list).
- Replace the hardcoded `· RELIEF` / `· INTAGLIO` strings with
  `obj.processingType`.

### 6. Copy — `ForgePage.tsx:261-265`

Idle `EmptyState`: requires only an incise (INTAGLIO) contour; emboss/score
layers are preserved if present. Match the Workshop-Instrument register.

### 7. Output — `buildGeneratedXcs` (`xcs.ts:225`)

Unchanged behaviour. Update the stale comments only: the `#00befe`
emboss-layer preservation note (`:220`) and the calibration/alignment
comments (`xcs.ts:124, :291`, `stages.ts:14-18`, `offset.ts:195-197`) — drop
the "so the emboss is never engraved" rationale (the even-odd hole is correct
regardless of emboss; for an incise-only cut it keeps the part body unburned).

## Success criteria

- **`test-text.xcs`:** parses to 1 incise target (auto-selected), 0 emboss,
  0 phantom entries in either list; calibration **confident**
  (`mmPerUnit ≈ 1.0` via fallback 2); `runPipeline` emits seed/deepen/clean
  bands whose geometry includes loops near **both** circle centroids
  (~36,47 and ~80,47); Export is enabled; round-trip preserves the
  non-target device entries.
- **`incise_emboss.xcs`:** behaviour unchanged — still exports, emboss
  BITMAP + model preserved, calibration still confident from `perimeter`.

## Testing (vitest, colocated)

- `xcs.test.ts`: parse `test-text.xcs` → assert 1 geometry-bearing incise
  target, 0 emboss, score layers classified `score`, phantom entries absent
  from target/preserved lists. Calibration: fallback 2 (`scale.x`) reproduces
  the `perimeter`-based value on `incise_emboss.xcs`; `test-text.xcs`
  calibrates **confident**.
- `pipeline.test.ts`: run on `test-text.xcs`'s target → assert non-empty
  seed/deepen/clean and that generated ring sets contain loops near each
  circle centroid (the disjoint-island guard). No `mmPerUnit=1.0/not-confident`
  warning.
- Round-trip: `parse → buildGeneratedXcs → exportXcs` on `test-text.xcs`
  asserts the target display/entry removed, generated INTAGLIO stage layers
  present, and the score device entries preserved.
- Update the v1 tests/copy that assumed a mandatory emboss.
- **Browser check (Chrome MCP, per project convention):** upload
  `test-text.xcs`, confirm the preview cuts every black element incl. both
  circles; confirm `incise_emboss.xcs` still renders/export-enables.

## Risks

- **Nesting-level heuristic on a 17-loop design.** `buildPartRegion`'s
  odd/even level classification (`offset.ts:136-184`) was tuned on simpler
  samples; a disjoint circle could be mis-assigned as a hole and not cut as a
  band. **Mitigation:** the pipeline test asserts bands near the circle
  centroids + the browser preview review. If it fails, fixing region
  reconstruction is **in scope** ("cuts every black element" is the success
  criterion).
- **`scale.x` ≠ `mmPerUnit` assumption.** Guarded by the cross-check test on
  `incise_emboss.xcs` before fallback 2 is trusted; if it diverges, prefer
  fallback 3 (width/bbox).

## Changelog

Minor entry `changelog/2026-05-31-forge-incise-only.md`: "Forge accepts
incise-only files" — short summary, no body (visible enhancement to an
existing page).

## Follow-ups (deferred, not this change)

- Class-reassign / pick-any-geometry-object-as-target (v1's "never silent or
  fatal" intent).
- Perforation tabs across disjoint islands.
