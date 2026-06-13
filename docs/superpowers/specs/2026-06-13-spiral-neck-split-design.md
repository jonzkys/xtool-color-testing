# Spiral Cut — neck split for internal detail

Date: 2026-06-13
Status: design approved; implementation plan pending

## Problem

The Spiral Cut emits one long continuous perimeter spiral that laps the whole
part outline. Thin features on that outline (small flourishes, tight letter
details) are woven into that single arm: the outer laps retract away from a thin
feature once the venting band can no longer fit, so the feature is reached only by
the inner laps, and only once per very long lap. The result is **few passes with a
long cool-down between them** — empirically those features fail to cut through
while disjoint counters (already generated as their own short, rapid loops) cut
cleanly. The user's cut tests confirm: short disjoint loops retain heat and sever;
woven thin details do not.

Validated assumption (user, 2026-06-13): the failing details are part of the
single big perimeter arm; the already-separate counters cut fine.

## Goal

Let the generator split thin features off the perimeter spiral into their **own
arms**, so each is cut as a short heat-retaining loop with rapid consecutive
passes. Improve cut-through of internal detail without changing how the
well-behaved disjoint features are produced.

Success: on a holed/detailed shape (e.g. `samples` / `demo-files/spiral.svg`),
thin features that previously failed are emitted as separate arms; toggling the
feature off reproduces today's exact output; the user can A/B the two on brass.

## Approach

Chosen approach (#1): detect necks and split **inside the spiral generator**
(`web/src/lib/forge/spiral.ts`), reusing the offset-level geometry it already
computes, rather than a separate width-map pre-pass or a post-process on finished
polylines.

### Detection — the neck signal

A **neck** is a location on the part contour where the local feature width falls
below `neckThreshold × channelWidthMm`. For an outside spiral this is equivalent
to "the venting band can't fit its normal width here" (the channel-neck signal):
where the part pinches, the outward offsets collapse early and the band is thin.
Width is measured across the part (a local-thickness / contour-to-opposite-edge
measure); a neck that pinches off a lobe is a split point.

The exact neck geometry (locating the pinch on a ring and cutting cleanly) is the
main implementation risk and will be prototyped against `spiral.svg` during
implementation. The feature stays behind a default-off toggle so iteration cannot
regress existing cuts.

### Action — cut the rings, isolate the lobe

At each neck, cut the affected concentric rings across the pinch. The lobe beyond
the neck stitches into its **own arm**; the main perimeter arm continues, skipping
the lobe. Each detail-arm extends a short **overlap** past the neck (and the main
arm covers up to it) so the join is double-cut and fully severs — no uncut sliver
at the split.

### Cut semantics

Detail-arms export as separate displays, like every other arm, so the machine cuts
each one's passes consecutively → heat retention. The main perimeter arm and the
already-disjoint counters are unaffected in how they cut.

## Arm tagging for extensibility (forward-looking)

Per-stage laser/focus params are keyed by `groupName` in this codebase
(`STAGE_GROUPS`, `config.resolveStageParams`, `xcs.applyStageParams`), and each
distinct group becomes its own Studio layer/operation with its own colour and
parameters. To make "internal cuts can later carry different machine params" a
drop-in extension rather than a re-architecture:

- Detail-arms are tagged with a **distinct group**: `STAGE_GROUPS.spiralDetail =
  "CUT_09_SPIRAL_DETAIL"` (the main perimeter keeps `CUT_08_SPIRAL`).
- They keep `generatedClass: "spiral"` so the export's flat-mode VECTOR_CUTTING
  handling (`buildGeneratedXcs` filters/branches on `generatedClass === "spiral"`)
  applies to them unchanged.
- v1: `resolveStageParams` emits the detail group's params as a **copy** of the
  main spiral's, so the cut is identical to today aside from the split.
- Future (out of scope here): add a second laser/focus control block bound to the
  detail group; because it is already a separate group/layer, this needs only UI +
  a second `StageParams` entry, nothing structural.

## Controls

Added to `SpiralConfig` and surfaced in the Cut geometry / Focus area:

- `splitNecks: boolean` — enable neck splitting. **Default false** while the
  quality hypothesis is being validated.
- `neckThresholdPct: number` — width below which a location counts as a neck, as a
  percentage of channel width. **Default 50.**
- `neckOverlapMm: number` — overlap each detail-arm shares with the main arm at the
  split. **Default = `channelWidthMm`** (one full band of overlap from each side).

Old persisted configs (`spiral.config.v1`) lack these fields → read with
defaults (`?? false` / `?? 50` / `?? channelWidthMm`).

## Preview & estimate

- The estimate strip already sums per-arm time, so it updates automatically as
  arms split.
- The schematic caption reports how many detail-arms were split off.
- Stretch (not required for v1): tint split-off arms a distinct colour in the
  schematic so the user can see *where* it will split before cutting. Note the
  schematic re-derives its own arms (`SpiralCanvas`), so showing real split points
  there would require mirroring the neck logic; deferred unless wanted.

## Out of scope

- Independent machine params for detail-arms (architecture prepared above; UI
  deferred to a follow-up).
- The broader "cap continuous arm length everywhere to exploit heat retention"
  idea — revisit only if neck-splitting validates.

## Risks

- **Neck geometry** is the hard part — finding the pinch on a ring and cutting it
  without leaving slivers or spawning degenerate tiny arms. Mitigation: prototype
  on `spiral.svg`; guard against sub-noise splits (a minimum lobe size); default
  off so it can't regress shipped cuts.
- Over-splitting fragments the cut (more lift/re-entry travel). The threshold
  bounds this; the overlap keeps joins cut.

## Components / files

- `web/src/lib/forge/types.ts` — `SpiralConfig` gains `splitNecks`,
  `neckThresholdPct`, `neckOverlapMm`.
- `web/src/lib/forge/config.ts` — `STAGE_GROUPS.spiralDetail`;
  `resolveStageParams` emits the detail group (copy of spiral params for v1).
- `web/src/lib/forge/presets.ts` — defaults on the spiral presets.
- `web/src/lib/forge/spiral.ts` — neck detection + ring-cut + detail-arm emission
  (tagged with the detail group); the bulk of the work.
- `web/src/lib/forge/xcs.ts` — no structural change (detail group flows through the
  existing per-group layer/param machinery); verify the spiral-only export keeps
  both groups.
- UI (`SpiralControls` / `ForgeStageParams`) — the toggle + threshold + overlap
  controls.
- Tests — unit tests for neck detection, the ring-cut/overlap, and detail-arm
  group tagging; a regression test that `splitNecks: false` reproduces current
  arms exactly.

## Testing / validation

- Unit: a synthetic dumbbell/lollipop region splits into a main arm + a detail
  arm at the neck, with the configured overlap, and the detail arm carries
  `CUT_09_SPIRAL_DETAIL`.
- Regression: with the toggle off, generated arms are byte-identical to today.
- Browser: load `spiral.svg`, enable the toggle, confirm detail-arms appear and
  the estimate updates; export `.xs` and confirm two spiral groups/layers.
- Physical (user): A/B the toggle on brass to confirm the split details cut
  through where they previously failed.
