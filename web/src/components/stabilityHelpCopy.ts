import type { XAxis, YAxis } from "./stabilityChartMath";

/* ─── Stability help copy ────────────────────────────────────────────────
 *
 * Centralised explanation strings for the Stability page's axis pills,
 * row labels, and toolbar pills. Two fields per entry:
 *
 *   - ``definition``: what the metric IS, in plain English. One sentence.
 *   - ``guide``: how to read it / when to use it. Includes thresholds,
 *     gotchas, and what a sustained trend implies about the burn.
 *
 * The Stability help card renders both as labelled sections inside the
 * click-to-open modal. ``schematic`` keys a small SVG family — see
 * ``StabilityHelpSchematic`` for the renderer.
 *
 * Tone matches the Workshop Instrument register: active verbs, concrete
 * thresholds, an actionable interpretation pointer where it fits.
 */

export type SchematicId =
  | "rotation"   // hue rotation: arc with arrow
  | "magnitude"  // ΔE: two dots with formula
  | "residual"   // ΔL/Δa/Δb: signed axis with + / − labels
  | "spread"     // CAMERA σ: cluster of dots around centroid
  | "pair"       // BURN ΔE × CAMERA σ quadrants
  | "wheel"      // EXP h°: colour wheel
  | "cycle";     // CELL #: ordered grid

export interface AxisHelp {
  /** Heading for the help card. ~3-4 words. */
  heading: string;
  /** What the metric IS. One sentence, plain English. */
  definition: string;
  /** How to read it / when to use. 1-3 sentences with thresholds. */
  guide: string;
  schematic: SchematicId;
}

/* ─── Y axis ──────────────────────────────────────────────────────────── */

export const Y_AXIS_HELP: Record<YAxis, AxisHelp> = {
  delta_hue: {
    heading: "Hue rotation Δh°",
    definition:
      "Signed angular distance between the measured hue and the expected hue, in degrees. Positive means clockwise on the colour wheel; negative is counter-clockwise.",
    guide:
      "Wrapped to ±180°. Cells clustered above (or below) zero are systematically rotated one way — a single global hue offset would correct the whole palette. Near-neutral cells (low chroma) read as noise here, so don't over-trust isolated spikes on greys.",
    schematic: "rotation",
  },
  delta_e: {
    heading: "Total error ΔE",
    definition:
      "Total perceptual error: distance between measured and expected colour in CIE Lab, computed as ΔE76 = √(ΔL² + Δa² + Δb²).",
    guide:
      "Catches every kind of drift in one number, so it's the safest first axis to plot. Below ~3 is essentially imperceptible; above ~5 reads as clearly off. Spikes against EXP h° on X point at hues your burn struggles with.",
    schematic: "magnitude",
  },
  delta_l: {
    heading: "Lightness residual ΔL",
    definition:
      "Measured L* minus expected L*. Positive means brighter than the palette wanted; negative means darker.",
    guide:
      "If most cells sit below zero, the burn is consistently darker than expected — usually a power or speed adjustment. Sweep it against EXP L* to see whether shadows or highlights drift more (a curve correction vs. a global offset).",
    schematic: "residual",
  },
  delta_a: {
    heading: "Red–green residual Δa",
    definition:
      "Measured a* minus expected a*. Positive means the burn pulls warm/red; negative pulls cool/green.",
    guide:
      "Sustained positive Δa is a warm cast across the whole palette; negative is a cool cast. Pair it against EXP a* to see whether the shift is colour-dependent or a single global offset.",
    schematic: "residual",
  },
  delta_b: {
    heading: "Yellow–blue residual Δb",
    definition:
      "Measured b* minus expected b*. Positive means yellower than expected; negative means bluer.",
    guide:
      "Char and scorching usually push Δb positive across the board. A diagonal trend against EXP b* says blues drift differently than yellows — typical when the laser fades the warm end first.",
    schematic: "residual",
  },
  burn_delta_e: {
    heading: "Burn ΔE (run-mean)",
    definition:
      "ΔE between the per-cell burn-mean Lab (averaged across selected runs) and the expected Lab.",
    guide:
      "Camera noise averages out across runs, so this is your best estimate of the burn's true error. Needs ≥ 2 runs. Compare against CAMERA σ on the other axis to separate burn drift (high here, low σ) from photo noise (low here, high σ).",
    schematic: "magnitude",
  },
  burn_delta_hue: {
    heading: "Burn Δh° (run-mean)",
    definition:
      "Hue rotation of the per-cell burn-mean Lab versus expected, wrapped to ±180°.",
    guide:
      "Chroma-gated: near-neutral cells (chroma < 3) drop out so noisy hue values don't pollute the trend. Needs ≥ 2 runs. A consistent sign across cells says the whole burn rotates the wheel one way.",
    schematic: "rotation",
  },
  measured_hue: {
    heading: "Measured hue h°",
    definition:
      "Hue angle of the measured colour, 0–360°.",
    guide:
      "Plot against EXP h° on X to see rotation directly: dots on the y = x diagonal mean the burn matches expected hue cell-by-cell. Off-diagonal clusters mark hue bands the burn rotates.",
    schematic: "wheel",
  },
  measured_l: {
    heading: "Measured L*",
    definition:
      "Lightness of the measured colour. 0 = black, 100 = white.",
    guide:
      "Pair with EXP L* on X. A flatter-than-diagonal trend means the burn loses contrast — the laser is over- or under-powered. A diagonal y = x trace is what a perfect engraving looks like.",
    schematic: "residual",
  },
  measured_a: {
    heading: "Measured a*",
    definition:
      "Red–green axis of the measured colour. Positive = redder, negative = greener.",
    guide:
      "Plot against EXP a* on X to see whether warm and cool cells shift differently. The further the cloud drifts off-diagonal, the more colour-dependent your burn is — a global tweak won't fix it.",
    schematic: "residual",
  },
  measured_b: {
    heading: "Measured b*",
    definition:
      "Yellow–blue axis of the measured colour. Positive = yellower, negative = bluer.",
    guide:
      "Char tends to compress this axis. Compare against EXP b* — if yellows land at lower b* than expected but blues track fine, the laser is fading the warm end of the palette.",
    schematic: "residual",
  },
  measured_chroma: {
    heading: "Measured chroma C*",
    definition:
      "Colourfulness of the measured patch: how saturated, regardless of hue. C* = √(a² + b²).",
    guide:
      "Burns usually flatten chroma — saturation drops at high power. Pair with EXP C* on X to see how much saturation you're losing per band; dots below the diagonal mean the print is muted compared to the palette.",
    schematic: "magnitude",
  },
  per_cell_sigma: {
    heading: "Camera σ across runs",
    definition:
      "Run-to-run measurement spread per cell: RMS Lab distance from each cell's centroid across all selected runs.",
    guide:
      "Pure camera/lighting noise — tells you how much the photo conditions matter. Needs ≥ 2 runs. High σ on a cell means re-shooting that patch under the same conditions can still move it materially; low σ on a high-ΔE cell points the finger at the burn, not the camera.",
    schematic: "spread",
  },
};

/* ─── X axis ──────────────────────────────────────────────────────────── */

export const X_AXIS_HELP: Record<XAxis, AxisHelp> = {
  expected_hue: {
    heading: "Expected hue h°",
    definition:
      "Hue angle of the palette's target colour for each cell, 0–360°.",
    guide:
      "Pair with a residual on Y to see whether the shift is hue-dependent. A trend that rises in the warm end and falls in the cool end means your burn rotates differently in different hue bands — a single global correction won't be enough.",
    schematic: "wheel",
  },
  expected_l: {
    heading: "Expected L*",
    definition:
      "Lightness of the palette's target. Sweeps from dark (low L*) to light (high L*).",
    guide:
      "Pair with ΔL or measured L* on Y. If ΔL grows toward black or toward white, the burn is non-linear — a curve correction is the right move rather than a single global offset.",
    schematic: "residual",
  },
  expected_a: {
    heading: "Expected a*",
    definition:
      "Red–green coordinate of the palette's target. Negative for greens, positive for reds.",
    guide:
      "Pair with Δa to see colour-dependent warm/cool shifts. A diagonal trend means warm and cool cells drift in opposite directions — characteristic of a complementary-channel imbalance.",
    schematic: "residual",
  },
  expected_b: {
    heading: "Expected b*",
    definition:
      "Yellow–blue coordinate of the palette's target. Negative for blues, positive for yellows.",
    guide:
      "Pair with Δb to see colour-dependent yellow/blue shifts. Char usually flattens b* — yellows land lower than expected while blues track closer to true.",
    schematic: "residual",
  },
  expected_chroma: {
    heading: "Expected chroma C*",
    definition:
      "Saturation of the palette's target colour. Higher means more vivid targets.",
    guide:
      "Pair with measured chroma or ΔE on Y. ΔE that climbs with EXP C* is a sign the burn can't reach the palette's vivid end — usually a power ceiling.",
    schematic: "magnitude",
  },
  cell_index: {
    heading: "Cell #",
    definition:
      "Cell ordering by physical burn position: row × cells_per_row + col.",
    guide:
      "A trend along this axis means the burn drifts as it traverses the workpiece — laser warming up, optics drifting, head wobble. Switch to spatial mode to see exactly where the bias lives on the grid.",
    schematic: "cycle",
  },
  burn_delta_e: {
    heading: "Burn ΔE (run-mean)",
    definition:
      "ΔE between the per-cell burn-mean Lab (averaged across selected runs) and expected.",
    guide:
      "Same metric as the Y-axis variant but on X — pairs with CAMERA σ to fan cells into a 2-D quadrant: 'accurate + repeatable' (low Δ, low σ) vs 'drifted but stable' (high Δ, low σ) vs 'noisy' (any Δ, high σ). Needs ≥ 2 runs.",
    schematic: "pair",
  },
  burn_delta_hue: {
    heading: "Burn Δh° (run-mean)",
    definition:
      "Hue rotation of the per-cell burn-mean Lab versus expected, wrapped to ±180°.",
    guide:
      "Chroma-gated, so near-neutral cells drop out. Needs ≥ 2 runs. A sustained sign across cells says the burn rotates the wheel in one direction; pair with another residual on Y to spot rotation patterns.",
    schematic: "rotation",
  },
  camera_sigma: {
    heading: "Camera σ across runs",
    definition:
      "Run-to-run spread of each cell's measurement (Lab RMS from centroid) — pure photo noise.",
    guide:
      "Pair with BURN ΔE on Y to split your cells into 'true burn errors' (high BURN ΔE, low σ) vs 'measurement artefacts' (high σ). Needs ≥ 2 runs. High σ usually means lighting / angle is variable, not the burn.",
    schematic: "spread",
  },
};

/* ─── Toolbar / row labels ────────────────────────────────────────────── */

export type ToolbarHelpKey =
  | "mode"
  | "connectors"
  | "trend"
  | "yRow"
  | "xRow"
  | "metricRow"
  | "calibrate";

export const TOOLBAR_HELP: Record<ToolbarHelpKey, AxisHelp> = {
  mode: {
    heading: "Chart mode",
    definition:
      "Picks the visualisation: SCATTER (colour-space cloud), SPATIAL (workpiece-shaped heatmap), SPECTRUMS (per-cell min/max/mean bars), or CALIBRATE (affine-fit canvas).",
    guide:
      "Scatter answers 'how does this metric vary with that one?'. Spatial answers 'where on the workpiece is the bias?'. Spectrums shows per-cell run-to-run range across selected runs. All views share focus and selection — clicking a cell in one pins it across the others.",
    schematic: "cycle",
  },
  connectors: {
    heading: "Spread connectors",
    definition:
      "Vertical bars in the scatter that span each cell's min-Y to max-Y across the selected runs.",
    guide:
      "Tall bars flag noisy cells; short bars flag repeatable burns. Only appears with ≥ 2 runs. Hide them when the cloud gets dense — they're useful for spotting noise, not for daily reading.",
    schematic: "spread",
  },
  trend: {
    heading: "Hue-binned trend",
    definition:
      "Bins the X axis into hue bands and draws a smoothed mean-Y trace per run.",
    guide:
      "Most useful against EXP h° or another expected axis — the trend line shows where the burn drifts as you sweep the colour wheel. Sparse bins (< 2 cells) break the line rather than extrapolate, so gaps are honest, not bugs.",
    schematic: "rotation",
  },
  yRow: {
    heading: "Y axis",
    definition:
      "Picks what to plot on the vertical axis. The selected metric drives every dot's vertical position.",
    guide:
      "Δ-axes (Δh°, ΔE, ΔL/Δa/Δb) compare measured vs expected — pick one to spot bias. Measured-* axes plot raw values; pair with the matching EXP-* on X for an identity-diagonal view. BURN-* axes need ≥ 2 runs and are camera-noise-averaged.",
    schematic: "residual",
  },
  xRow: {
    heading: "X axis",
    definition:
      "Picks what to plot on the horizontal axis.",
    guide:
      "EXP-* axes sweep the palette and pair with a residual on Y to find colour-dependent drift. CELL # surfaces position-dependent biases. BURN ΔE × CAMERA σ is the quadrant split for separating burn errors from photo noise (≥ 2 runs).",
    schematic: "pair",
  },
  metricRow: {
    heading: "Heatmap metric",
    definition:
      "Picks the per-cell metric the workpiece grid is tinted by in SPATIAL mode.",
    guide:
      "Diverging metrics (Δ-axes) split at zero — blue for negative, red for positive. Magnitude metrics (ΔE, σ) ramp from low (cool) to high (hot). Only metrics that aggregate per-cell across runs appear here.",
    schematic: "spread",
  },
  calibrate: {
    heading: "Calibrate transform",
    definition:
      "Fits a 12-parameter Lab→Lab affine that maps one reference run's measurements back toward expected.",
    guide:
      "Least-squares fit of A·measured + b ≈ expected on the chosen reference run. Toggle APPLY TO CHART to preview SCATTER / SPATIAL / SPECTRUMS as if the same correction was applied to every selected run — useful for asking 'how much better would my prints be after one calibration pass?'.",
    schematic: "pair",
  },
};

/* ─── Per-mode help (chart-mode pills) ─────────────────────────────────
 *
 * Each mode pill (SCATTER / SPATIAL / SPECTRUMS / POLAR / CALIBRATE)
 * shows its own hover card so users can discover what a mode does
 * without switching into it blind. ``definition`` says what the view
 * is; ``guide`` says when you'd reach for it.
 */

export type ModeHelpKey =
  | "scatter"
  | "spatial"
  | "spectrums"
  | "polar"
  | "calibrate"
  | "validate";

export const MODE_HELP: Record<ModeHelpKey, AxisHelp> = {
  scatter: {
    heading: "Scatter",
    definition:
      "Per-cell dots in colour-space — each dot is one cell from one run, plotted against the X / Y metrics you pick.",
    guide:
      "The everyday view. Pair an EXP-* axis on X with a residual on Y for hue-dependent drift; pair BURN ΔE × CAMERA σ for the burn-vs-noise quadrant split. Optional spread connectors and a hue-binned trend line live in the toolbar.",
    schematic: "pair",
  },
  spatial: {
    heading: "Spatial",
    definition:
      "Cells laid out in their workpiece position (the burn grid), tinted by the selected per-cell metric.",
    guide:
      "Use when scatter shows drift but you want to know if it's positional — laser warming up, optics drifting, lighting fall-off across the photo. Hot patches map directly onto the print.",
    schematic: "cycle",
  },
  spectrums: {
    heading: "Spectrums",
    definition:
      "Per-cell vertical bars from min → max measured value across the selected runs, with a mean dot.",
    guide:
      "Read 'which cells move the most run-to-run' at a glance. Sortable by expected hue / lightness / chroma / cell index / range. Tall bars = unstable cells; short bars = repeatable.",
    schematic: "spread",
  },
  polar: {
    heading: "Polar",
    definition:
      "CIE Lab a×b colour wheel. Each cell renders at its expected (hue, chroma); an arrow stretches to where it actually landed.",
    guide:
      "One-frame answer to 'is the whole palette rotating one way, or smearing everywhere?'. Arrow colour is bucketed by ΔE76 (≤ 2 imperceptible / ≤ 5 noticeable / ≤ 10 clearly off / > 10 wrong) so the eye picks acceptable vs problem drift instantly.",
    schematic: "rotation",
  },
  calibrate: {
    heading: "Calibrate",
    definition:
      "Fits a 12-parameter Lab→Lab affine that maps one reference run's measurements back toward expected.",
    guide:
      "Pick a reference run, see the matrix + R² + before/after ΔE distribution, then toggle APPLY TO CHART to preview the other modes as if the correction was already applied. Useful for asking 'would one calibration pass help?'.",
    schematic: "pair",
  },
  validate: {
    heading: "Validate",
    definition:
      "Lock in burn-mean Lab as the authoritative colour for each cell's palette entry.",
    guide:
      "Per-cell preview of original / burn-mean / ΔE. Cells inside tolerance auto-validate; ones outside flag for review. Saves write the corrected Lab back to the palette + flip is_validated, so auto-match's 'Prefer validated' filter can use them.",
    schematic: "pair",
  },
};
