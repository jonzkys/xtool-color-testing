import type { XAxis, YAxis } from "./stabilityChartMath";

/* ─── Stability help copy ────────────────────────────────────────────────
 *
 * Centralised explanation strings for the Stability page's axis pills,
 * row labels, and toolbar pills. Two tiers of copy per entry: ``short``
 * shows on quick hover, ``long`` expands into a sustained-hover info
 * card. ``schematic`` keys a small SVG family — see
 * ``StabilityHelpSchematic`` for the renderer.
 *
 * Tone matches the Workshop Instrument register: active verbs, concrete
 * thresholds, an optional one-liner of user-actionable interpretation
 * inside the long form.
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
  /** Tier-1 tooltip body. 1-2 sentences, ≤ ~140 chars. */
  short: string;
  /** Heading for the tier-2 info card. ~3-4 words. */
  heading: string;
  /** Tier-2 paragraph; 1-2 sentences with optional actionable hint. */
  long: string;
  schematic: SchematicId;
}

/* ─── Y axis ──────────────────────────────────────────────────────────── */

export const Y_AXIS_HELP: Record<YAxis, AxisHelp> = {
  delta_hue: {
    heading: "Hue rotation",
    short:
      "How far the measured hue is from expected, in degrees. + = clockwise on the colour wheel; − = counter-clockwise.",
    long: "Wrapped to ±180°. Cells clustered above the zero line are systematically rotated one way — a global hue offset would correct it. Near-neutral cells (low chroma) read as noise here.",
    schematic: "rotation",
  },
  delta_e: {
    heading: "Total error ΔE",
    short:
      "Total perceptual error: distance between measured and expected colour in CIE Lab. ≤ 3 is essentially imperceptible; > 5 reads as clearly off.",
    long: "ΔE76 = √(ΔL² + Δa² + Δb²). Catches every kind of drift in one number, so it's the safest first axis to plot. Spikes against EXP h° point at hues your burn struggles with.",
    schematic: "magnitude",
  },
  delta_l: {
    heading: "Lightness residual",
    short:
      "Measured L* minus expected. + = brighter than the palette wanted; − = darker.",
    long: "If most cells sit below zero, the burn is consistently darker than expected — usually a power or speed adjustment fix. A sweep across EXP L* shows whether shadows or highlights drift more.",
    schematic: "residual",
  },
  delta_a: {
    heading: "Red–green residual",
    short:
      "Measured a* minus expected. + = redder than expected; − = greener.",
    long: "Sustained positive Δa means the burn pulls warm; negative pulls cool. Useful paired against EXP a* to see whether the shift is colour-dependent or global.",
    schematic: "residual",
  },
  delta_b: {
    heading: "Yellow–blue residual",
    short:
      "Measured b* minus expected. + = yellower than expected; − = bluer.",
    long: "Char and scorching usually push Δb positive across the board. A diagonal trend against EXP b* says blues drift differently than yellows.",
    schematic: "residual",
  },
  burn_delta_e: {
    heading: "Burn ΔE (run-mean)",
    short:
      "Run-averaged ΔE between the burn-mean Lab and expected. Camera noise is averaged out — your best estimate of the burn's true error.",
    long: "Computed by averaging Lab across all selected runs at each cell, then taking ΔE against expected. Needs ≥ 2 runs. Compare against CAMERA σ to separate burn drift from photo noise.",
    schematic: "magnitude",
  },
  burn_delta_hue: {
    heading: "Burn Δh° (run-mean)",
    short:
      "Run-averaged hue rotation, with chroma-gated cells where hue is undefined.",
    long: "Hue of the burn-mean Lab against expected, wrapped to ±180°. Near-neutral cells (chroma < 3) drop out as gaps so noisy hue values don't pollute the trend.",
    schematic: "rotation",
  },
  measured_hue: {
    heading: "Measured hue",
    short:
      "Hue angle of the measured colour, in degrees. Plot against EXP h° to see rotation directly on the identity diagonal.",
    long: "Range 0–360°. When the dot cloud lies on the y = x diagonal, your burn matches expected hue cell-by-cell. Off-diagonal clusters mean a rotation in that hue band.",
    schematic: "wheel",
  },
  measured_l: {
    heading: "Measured L*",
    short:
      "Lightness of the measured colour. Pair with EXP L* to see whether the burn compresses or stretches the lightness range.",
    long: "0 = black, 100 = white. A flatter-than-diagonal trend against EXP L* means the burn loses contrast — common when the laser is over- or under-powered.",
    schematic: "residual",
  },
  measured_a: {
    heading: "Measured a*",
    short:
      "Red–green axis of the measured colour. + redder, − greener.",
    long: "Plot against EXP a* to see whether warm and cool cells shift differently. The further the cloud drifts off-diagonal, the more colour-dependent your burn is.",
    schematic: "residual",
  },
  measured_b: {
    heading: "Measured b*",
    short:
      "Yellow–blue axis of the measured colour. + yellower, − bluer.",
    long: "Char tends to compress this axis. Compare against EXP b* — if yellows land at lower b* than expected but blues track fine, the laser is fading the warm end.",
    schematic: "residual",
  },
  measured_chroma: {
    heading: "Measured chroma",
    short:
      "Colourfulness: how saturated the measured patch is, regardless of hue.",
    long: "C* = √(a² + b²). Burns usually flatten chroma — saturation drops at high power. Pair with EXP C* to see how much saturation you're losing per band.",
    schematic: "magnitude",
  },
  per_cell_sigma: {
    heading: "Camera σ across runs",
    short:
      "Run-to-run measurement variance per cell. Pure camera/lighting noise — tells you how much the photo conditions matter.",
    long: "RMS Lab distance from each cell's centroid across all selected runs. Needs ≥ 2 runs. High σ on a cell means re-shooting that patch under the same conditions can move it materially.",
    schematic: "spread",
  },
};

/* ─── X axis ──────────────────────────────────────────────────────────── */

export const X_AXIS_HELP: Record<XAxis, AxisHelp> = {
  expected_hue: {
    heading: "Expected hue",
    short:
      "Expected hue from the palette. Pair with a residual axis to see whether the shift is hue-dependent.",
    long: "Range 0–360°. A trend that rises on the warm end and falls on the cool end means your burn rotates differently in different hue bands — a single global correction won't be enough.",
    schematic: "wheel",
  },
  expected_l: {
    heading: "Expected L*",
    short:
      "Expected lightness from the palette. Pair with ΔL or measured L* to see lightness drift.",
    long: "Sweeps from dark (low L*) to light (high L*). If ΔL grows toward black or toward white, the burn is non-linear and a curve correction is the right move.",
    schematic: "residual",
  },
  expected_a: {
    heading: "Expected a*",
    short:
      "Expected red–green coordinate. Pair with Δa to see colour-dependent warm/cool shifts.",
    long: "Negative for greens, positive for reds. A diagonal trend in Δa against EXP a* means your warm and cool cells drift in opposite directions.",
    schematic: "residual",
  },
  expected_b: {
    heading: "Expected b*",
    short:
      "Expected yellow–blue coordinate. Pair with Δb to see colour-dependent yellow/blue shifts.",
    long: "Negative for blues, positive for yellows. Char usually flattens b* — yellows land lower than expected while blues track closer to true.",
    schematic: "residual",
  },
  expected_chroma: {
    heading: "Expected chroma",
    short:
      "Expected saturation from the palette. Pair with measured chroma or ΔE to see saturation loss.",
    long: "Higher chroma means more saturated targets. ΔE that climbs with EXP C* is a sign the burn can't reach the palette's vivid end — usually a power ceiling.",
    schematic: "magnitude",
  },
  cell_index: {
    heading: "Cell #",
    short:
      "Cell ordering by physical burn position (row × cells_per_row + col). Useful for spotting position-dependent biases.",
    long: "A trend along this axis means the burn drifts as it traverses the workpiece — laser warming up, optics drifting, head wobble. Switch to spatial mode to see where the bias is.",
    schematic: "cycle",
  },
  burn_delta_e: {
    heading: "Burn ΔE (run-mean)",
    short:
      "Run-averaged ΔE per cell. Use as X to fan cells from accurate (left) to drifted (right).",
    long: "Same metric as the Y axis but on X — pairs with CAMERA σ to split cells into a 2-D quadrant: 'accurate + repeatable' vs 'drifted but stable' vs 'noisy'. Needs ≥ 2 runs.",
    schematic: "pair",
  },
  burn_delta_hue: {
    heading: "Burn Δh° (run-mean)",
    short:
      "Run-averaged hue rotation per cell. Pair with another residual to spot rotation patterns.",
    long: "Wrapped to ±180°. Chroma-gated, so near-neutral cells drop out. Needs ≥ 2 runs. A sustained sign across cells says the burn rotates the wheel in one direction.",
    schematic: "rotation",
  },
  camera_sigma: {
    heading: "Camera σ across runs",
    short:
      "Run-to-run variance of each cell's measurement. Pure photo noise — high σ means the lighting matters.",
    long: "Pair with BURN ΔE on Y to split your cells into 'true burn errors' (high BURN ΔE, low σ) vs 'measurement artefacts' (high σ). Needs ≥ 2 runs.",
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
    heading: "Scatter ⇄ Spatial",
    short:
      "Switch between the colour-space scatter and a workpiece-shaped heatmap. Both views share focus and selection.",
    long: "Scatter answers 'how does this metric vary with that one?'. Spatial answers 'where on the workpiece is the bias?' — the same metric tinted onto each cell's physical row × column.",
    schematic: "cycle",
  },
  connectors: {
    heading: "Spread connectors",
    short:
      "Vertical bars from each cell's min-Y to max-Y across runs. Tall bars flag noisy cells; short bars flag repeatable burns.",
    long: "Only appears when ≥ 2 runs are selected. The bar covers the per-cell measurement range; if dots are tightly clustered the bar is invisible. Hide them when the cloud gets dense.",
    schematic: "spread",
  },
  trend: {
    heading: "Hue-binned trend",
    short:
      "Bins the X axis and draws a smoothed mean-Y trace per run. Surfaces systematic shifts under the noise.",
    long: "Most useful against EXP h° or another expected axis — the trend line shows where the burn drifts as you sweep the colour wheel. Sparse bins break the line rather than extrapolate.",
    schematic: "rotation",
  },
  yRow: {
    heading: "Y axis",
    short:
      "Pick what to plot on the vertical axis. The selected metric drives every dot's vertical position.",
    long: "Δ-axes (Δh°, ΔE, ΔL/Δa/Δb) compare measured vs expected. Measured-* axes plot raw values; pair with the matching EXP-* on X for an identity-diagonal view. BURN-* axes need ≥ 2 runs.",
    schematic: "residual",
  },
  xRow: {
    heading: "X axis",
    short:
      "Pick what to plot on the horizontal axis. EXP-* axes sweep the palette; computed-per-cell axes need ≥ 2 runs.",
    long: "Pair an EXP-* axis with a residual to find colour-dependent drift. Pair BURN ΔE with CAMERA σ for a quadrant view that splits true burn errors from photo noise.",
    schematic: "pair",
  },
  metricRow: {
    heading: "Heatmap metric",
    short:
      "Pick the per-cell metric the workpiece grid is tinted by. Diverging metrics (Δ-axes) split at zero; magnitude metrics (ΔE, σ) ramp from low to high.",
    long: "Only metrics that aggregate per-cell across runs appear here. ΔE and σ catch overall trouble; Δh° / ΔL / Δa / Δb localise the kind of trouble.",
    schematic: "spread",
  },
  calibrate: {
    heading: "Calibrate transform",
    short:
      "Fit a 12-parameter Lab→Lab affine that maps one reference run's measurements back toward expected, then preview the post-correction ΔE.",
    long: "Least-squares fit of A·measured + b ≈ expected on the chosen reference run. Toggle APPLY TO CHART to see SCATTER / SPATIAL / SPECTRUMS as if the same correction was applied to every selected run — useful for asking 'how much better would my prints be after one calibration pass?'.",
    schematic: "pair",
  },
};
