import type { ChannelCol, IndexRow, RawParamRow } from "./exposureCorrelations";
import type { SchematicId as StabilitySchematicId } from "../stabilityHelpCopy";

/* ─── Exposure help copy ──────────────────────────────────────────────────
 *
 * Three card variants live here:
 *   - IndexHelp     — full card: heading + unit + definition + formula
 *                     + inputs + guide + schematic
 *   - ChannelHelp   — definition + guide + schematic only (CIELab basics)
 *   - RawParamHelp  — heading + unit + one-line definition only
 *
 * Plain words throughout — no Greek, no single-letter abbreviations. */

export type ExposureSchematicId =
  | "dot_pitch"
  | "line_pitch"
  | "pulse_shape"
  | "accumulation"
  | "combination";

export interface ExposureIndexHelp {
  heading: string;
  unit: string;
  definition: string;
  formula: string;
  inputs: ReadonlyArray<{ name: string; unit: string }>;
  guide: string;
  schematic: ExposureSchematicId;
}

export interface ExposureChannelHelp {
  heading: string;
  definition: string;
  guide: string;
  schematic: StabilitySchematicId;
}

export interface ExposureRawParamHelp {
  heading: string;
  unit: string;
  definition: string;
}

export const EXPOSURE_INDEX_HELP: Record<IndexRow, ExposureIndexHelp> = {
  pulse_spacing_mm: {
    heading: "Pulse spacing",
    unit: "mm",
    definition:
      "Physical distance between successive laser pulses along a scan line.",
    formula: "speed ÷ (frequency × 1000)",
    inputs: [
      { name: "speed", unit: "mm/s" },
      { name: "frequency", unit: "kHz" },
    ],
    guide:
      "Smaller is denser coverage along the scan direction. Once spacing falls below the spot diameter, pulses start to overlap and the burn behaves as a continuous mark — bigger gains in colour from there usually mean more passes, not denser pulses.",
    schematic: "dot_pitch",
  },
  line_spacing_mm: {
    heading: "Line spacing",
    unit: "mm",
    definition:
      "Physical distance between adjacent scan lines, derived from the controller's density setting.",
    formula: "10 ÷ density",
    inputs: [
      { name: "density", unit: "lines/cm" },
    ],
    guide:
      "Smaller is denser hatching. Below the spot diameter, lines start to overlap and the burn behaves as a continuous fill — additional density gains then translate into more pulse overlap, not finer hatching.",
    schematic: "line_pitch",
  },
  pulse_energy_index: {
    heading: "Pulse energy",
    unit: "dimensionless",
    definition:
      "Energy delivered per pulse — controller power divided by repetition rate.",
    formula: "power ÷ frequency",
    inputs: [
      { name: "power", unit: "% slider (linear)" },
      { name: "frequency", unit: "kHz" },
    ],
    guide:
      "Higher means more energy in each individual pulse. Pair it against L* to see how a single pulse's energy maps to lightness; sustained increase here at fixed total exposure usually means deeper, more thermally-affected marks.",
    schematic: "pulse_shape",
  },
  pulse_intensity_index: {
    heading: "Pulse intensity",
    unit: "dimensionless",
    definition:
      "Peak intensity of a pulse — energy concentrated by the pulse-width compression.",
    formula: "power ÷ (frequency × pulse_width)",
    inputs: [
      { name: "power", unit: "% slider (linear)" },
      { name: "frequency", unit: "kHz" },
      { name: "pulse_width", unit: "ns" },
    ],
    guide:
      "Higher intensity ablates rather than heats. The same energy delivered in a shorter pulse hits harder. Plotting against ΔE often separates ablation-driven colours (high here) from thermal-driven ones (low here).",
    schematic: "pulse_shape",
  },
  total_exposure_index: {
    heading: "Total exposure",
    unit: "dimensionless",
    definition:
      "Cumulative energy delivered per unit area across the burn.",
    formula: "power × density × passes ÷ speed",
    inputs: [
      { name: "power", unit: "% slider (linear)" },
      { name: "density", unit: "lines/cm" },
      { name: "passes", unit: "count" },
      { name: "speed", unit: "mm/s" },
    ],
    guide:
      "The dose dial. Plotted against L*, this is usually the cleanest axis — burns get darker as exposure climbs. Plateaus or kinks mark the regime where colour stops responding to more dose and you need to vary something else.",
    schematic: "accumulation",
  },
  ablation_aggression_index: {
    heading: "Ablation aggression",
    unit: "dimensionless",
    definition:
      "Total exposure scaled by pulse intensity — high when both lots of energy AND sharp peaks are delivered.",
    formula:
      "(power × density × passes ÷ speed) × (power ÷ (frequency × pulse_width))",
    inputs: [
      { name: "power", unit: "% slider (linear)" },
      { name: "density", unit: "lines/cm" },
      { name: "passes", unit: "count" },
      { name: "speed", unit: "mm/s" },
      { name: "frequency", unit: "kHz" },
      { name: "pulse_width", unit: "ns" },
    ],
    guide:
      "A combined indicator of how aggressive the burn is. Two recipes can share the same total exposure but differ wildly here — high aggression means the same dose is delivered as fewer, harder hits. Pair it against ΔE or chroma to spot regimes where aggression buys colour.",
    schematic: "combination",
  },
  delivery_smoothness_index: {
    heading: "Delivery smoothness",
    unit: "dimensionless",
    definition:
      "Total exposure divided by pulse intensity — high when energy is spread across many gentle pulses rather than few sharp ones.",
    formula:
      "(power × density × passes ÷ speed) ÷ (power ÷ (frequency × pulse_width))",
    inputs: [
      { name: "power", unit: "% slider (linear)" },
      { name: "density", unit: "lines/cm" },
      { name: "passes", unit: "count" },
      { name: "speed", unit: "mm/s" },
      { name: "frequency", unit: "kHz" },
      { name: "pulse_width", unit: "ns" },
    ],
    guide:
      "Power cancels out, so this captures delivery pattern alone — same dose, smoother or spikier. High smoothness tends toward thermal/diffusion-driven colours; low smoothness toward ablation-driven ones.",
    schematic: "combination",
  },
  duty_cycle_index: {
    heading: "Duty cycle",
    unit: "%",
    definition:
      "Fraction of each pulse period the laser is actually on. A physical ratio that depends only on frequency and pulse width — not on the power slider.",
    formula: "frequency × pulse_width ÷ 10000",
    inputs: [
      { name: "frequency", unit: "kHz" },
      { name: "pulse_width", unit: "ns" },
    ],
    guide:
      "The lever that converts average power to peak power. Two recipes at the same slider-% can deliver wildly different peak intensities if their duty cycles differ — low duty (sparse, sharp pulses) ablates; high duty (dense, gentle pulses) heats. Plot against ΔE to spot regimes where shrinking the duty cycle, not the slider, is what's actually buying the colour change.",
    schematic: "pulse_shape",
  },
};

export const EXPOSURE_CHANNEL_HELP: Record<ChannelCol, ExposureChannelHelp> = {
  L: {
    heading: "Lightness L*",
    definition: "CIE Lab lightness — 0 black, 100 white.",
    guide:
      "The cleanest axis to plot against total exposure. A monotonic descent says dose translates straight into darkness; a knee or plateau marks the regime where the burn stops responding.",
    schematic: "residual",
  },
  a: {
    heading: "Red–green a*",
    definition:
      "CIE Lab red–green axis — positive is red, negative is green.",
    guide:
      "On stainless burns, sustained positive a* across a sweep often means a warm cast. Pair it against pulse intensity to see whether the warmth is energy-driven or delivery-driven.",
    schematic: "residual",
  },
  b: {
    heading: "Yellow–blue b*",
    definition:
      "CIE Lab yellow–blue axis — positive is yellow, negative is blue.",
    guide:
      "Char and scorching usually push b* positive. A diagonal trend against pulse energy often points at the regime where blues drop off the palette.",
    schematic: "residual",
  },
  hue: {
    heading: "Hue h°",
    definition: "Hue angle of the measured colour, 0–360°.",
    guide:
      "Plot hue against an exposure index to see how dose rotates the palette. Stable bands across the sweep mark hues your burn delivers reliably.",
    schematic: "wheel",
  },
  chroma: {
    heading: "Chroma C*",
    definition: "Distance from the neutral axis in CIE Lab — saturation.",
    guide:
      "High chroma with low total exposure flags efficient colour-per-dose; low chroma at high exposure usually means the burn has saturated to grey.",
    schematic: "magnitude",
  },
};

export const EXPOSURE_RAW_PARAM_HELP: Record<RawParamRow, ExposureRawParamHelp> = {
  power: {
    heading: "Power",
    unit: "% slider",
    definition:
      "Verified linear with the slider — written verbatim into G-code as the per-move S value on a 0–1000 scale (S = power × 10). The slider-to-watts conversion is still machine-specific and depends on head model, optics, and material — so use this as a relative axis, not an absolute one.",
  },
  speed: {
    heading: "Speed",
    unit: "mm/s",
    definition: "Linear speed of the laser head along a scan line.",
  },
  frequency: {
    heading: "Frequency",
    unit: "kHz",
    definition: "MOPA pulse repetition rate.",
  },
  density: {
    heading: "Density",
    unit: "lines/cm",
    definition:
      "Number of laser scan lines per centimetre. Stepped controller value (e.g. 10–200 for the STANDARD profile). Matches the xTool app's \"Lines per cm\" slider 1:1.",
  },
  passes: {
    heading: "Passes",
    unit: "count",
    definition:
      "Number of times the burn pattern is repeated over the same area.",
  },
  pulse_width: {
    heading: "Pulse width",
    unit: "ns",
    definition: "Duration of each laser pulse, in nanoseconds.",
  },
};
