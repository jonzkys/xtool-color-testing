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
- `samples/xcs/incise_emboss.xcs` (emboss + incise) keeps working — emboss
  preserved, source incise removed — with **corrected kerf calibration**
  (`mmPerUnit ≈ 0.848` via `scale.x`, not the buggy `0.2375`).

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

**Scale recovery (and a calibration bug found during planning).** The canvas
is in mm and `canvasX = unit·scale + offset` (`xcs.ts:246-247`), so the
selected display's `scale.x` IS the units→mm factor — confirmed by
`width / flattened-bbox-width` (`incise_emboss.xcs`: both `= 0.848`, agreeing
to 4 sig figs). The **current perimeter-based calibration is geometrically
wrong**: on `incise_emboss.xcs` it yields `0.2375` (3.57× off), because
`RELIEF_PROCESS.perimeter` (59.69 mm) measures the *emboss*, not the incise
contour — 59.69 mm is too short to even be a 27×33 mm outline's perimeter.
Since an exported offset lands physically as `(beamWidth / mmPerUnit)·scale.x`
mm, the correct `mmPerUnit` is `scale.x`; the perimeter method makes
emboss-file kerf bands **~3.57× too wide**. `test-text.xcs` is unaffected
(`scale.x = 1.0`, no perimeter → `1.0` is correct under any method).

**Decision (2026-05-31, during planning): fix calibration globally.**
`scale.x` (with a `width/bbox` cross-check fallback) becomes the **primary**
source; the perimeter method is **removed**. This corrects emboss-file band
widths and requires re-verification in xTool Creative Space before cutting
brass.

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

### 4. Calibration — `xcs.ts:129-143` (rewritten; global fix)

`calibrateMmPerUnit` looks up the selected canvas display by `incise.id` in
`raw.canvas[0].displays` and resolves `mmPerUnit` from the first usable
source (all **confident** except the last). The **perimeter method is
removed** — it conflated the emboss perimeter with the incise contour:

1. **selected display's `scale.x`** — path-units → bed-mm; used when positive
   and uniform (`scale.y` absent or `≈ scale.x`);
2. **display `width` / flattened-bbox width** — curve-aware bbox from the
   already-flattened contour subpaths; handles a missing/anisotropic scale;
3. `1.0`, **not confident** + existing warning + manual override.

A unit test asserts (1) and (2) agree on `incise_emboss.xcs` (`≈ 0.848`,
within 1%) and that `incise_emboss` calibrates to `≈ 0.848` (not the old
`0.2375`). The `mmPerUnitOverride` path (`pipeline.ts:46-47`) is unchanged.

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
- **`incise_emboss.xcs`:** still exports, emboss BITMAP + model preserved,
  source incise removed; calibration now confident at `mmPerUnit ≈ 0.848`
  (`scale.x`), **not** the old `0.2375` — kerf bands resize accordingly
  (re-verify in xTool).

## Testing (vitest, colocated)

- `xcs.test.ts`: parse `test-text.xcs` → assert 1 geometry-bearing incise
  target, 0 emboss, score layers classified `score`, phantom entries absent
  from target/preserved lists. Calibration: `incise_emboss.xcs` calibrates
  **confident at `≈ 0.848`** (replacing the old perimeter assertion), and the
  `width/bbox` value agrees within 1%; `test-text.xcs` calibrates **confident
  at `≈ 1.0`** with no not-confident warning.
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
- **Global calibration change resizes existing output.** Switching to
  `scale.x` makes emboss-file kerf bands ~3.57× narrower than the shipped
  (buggy) behaviour. The `width/bbox` cross-check test guards that `scale.x`
  is right (both `≈ 0.848`), but the *physical* result must be re-verified in
  xTool Creative Space on brass before relying on it. Flagged in the
  changelog so the change isn't silent.

## Changelog

Minor entry `changelog/2026-05-31-forge-incise-only.md` covering **both**
visible changes: (1) Forge now accepts incise-only files (no emboss
required); (2) kerf calibration corrected to the object's true scale — bands
on emboss files are no longer ~3.57× too wide (re-verify cuts). A short body
is warranted here because the calibration fix changes existing output.

## Follow-ups (deferred, not this change)

- Class-reassign / pick-any-geometry-object-as-target (v1's "never silent or
  fatal" intent).
- Perforation tabs across disjoint islands.
