// web/src/lib/forge/spiralParams.ts
// Registry of the Spiral Test page's sweepable parameters. Single source of
// truth for each param's label/unit/precision, whether it shapes the spiral
// geometry or only the cut profile, how it clamps, and its default fixed value
// + default axis range. Pure data + helpers; no React, no geometry.

export type ParamKey =
  | "channelWidth" | "pitch" | "speed" | "passes" | "power"
  | "frequency" | "pulseWidth" | "focusStep" | "focusInterval";

/** A linearly-spaced sweep: `steps` values over [min, max]. */
export interface AxisSpec { min: number; max: number; steps: number; }

export interface ParamDef {
  key: ParamKey;
  label: string;       // full name, e.g. "Channel width"
  abbrev: string;      // title abbreviation, e.g. "CW"
  unit: string;        // "mm" | "mm/s" | "kHz" | "ns" | "%" | "×" | "passes"
  dp: number;          // decimal places for axis labels + title
  step: number;        // numeric-input increment (precision-appropriate, not 1)
  kind: "geometry" | "profile";
  clamp: (v: number) => number;
  defaultFixed: number;   // value used when the param is OFF-axis
  defaultAxis: AxisSpec;  // range applied when the param is moved ONTO an axis
}

const intMin1 = (v: number) => Math.max(1, Math.round(v));
const nonNeg = (v: number) => Math.max(0, v);
const positive = (v: number) => Math.max(1e-4, v);
const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export const PARAMS: Record<ParamKey, ParamDef> = {
  channelWidth:  { key: "channelWidth",  label: "Channel width", abbrev: "CW", unit: "mm",     dp: 2, step: 0.05,  kind: "geometry", clamp: positive, defaultFixed: 0.8,  defaultAxis: { min: 0.6,  max: 1.0,  steps: 4 } },
  pitch:         { key: "pitch",         label: "Pitch",         abbrev: "PT", unit: "mm",     dp: 3, step: 0.005, kind: "geometry", clamp: positive, defaultFixed: 0.04, defaultAxis: { min: 0.03, max: 0.05, steps: 4 } },
  speed:         { key: "speed",         label: "Speed",         abbrev: "S",  unit: "mm/s",   dp: 0, step: 50,    kind: "profile",  clamp: intMin1,  defaultFixed: 1500, defaultAxis: { min: 1000, max: 2000, steps: 4 } },
  passes:        { key: "passes",        label: "Passes",        abbrev: "PA", unit: "×",      dp: 0, step: 10,    kind: "profile",  clamp: intMin1,  defaultFixed: 250,  defaultAxis: { min: 150,  max: 300,  steps: 4 } },
  power:         { key: "power",         label: "Power",         abbrev: "P",  unit: "%",      dp: 0, step: 5,     kind: "profile",  clamp: pct,      defaultFixed: 100,  defaultAxis: { min: 60,   max: 100,  steps: 4 } },
  frequency:     { key: "frequency",     label: "Frequency",     abbrev: "F",  unit: "kHz",    dp: 0, step: 5,     kind: "profile",  clamp: intMin1,  defaultFixed: 65,   defaultAxis: { min: 30,   max: 80,   steps: 4 } },
  pulseWidth:    { key: "pulseWidth",    label: "Pulse width",   abbrev: "PW", unit: "ns",     dp: 0, step: 10,    kind: "profile",  clamp: nonNeg,   defaultFixed: 80,   defaultAxis: { min: 50,   max: 500,  steps: 4 } },
  focusStep:     { key: "focusStep",     label: "Focus / step",  abbrev: "FS", unit: "mm",     dp: 2, step: 0.01,  kind: "profile",  clamp: nonNeg,   defaultFixed: 0.06, defaultAxis: { min: 0.04, max: 0.10, steps: 4 } },
  focusInterval: { key: "focusInterval", label: "Focus interval", abbrev: "FI", unit: "passes", dp: 0, step: 1,     kind: "profile", clamp: intMin1,  defaultFixed: 20,   defaultAxis: { min: 10,   max: 30,   steps: 4 } },
};

/** Stable order for selects, the fixed-param grid, and the title summary. */
export const PARAM_ORDER: ParamKey[] = [
  "channelWidth", "pitch", "speed", "passes", "power",
  "frequency", "pulseWidth", "focusStep", "focusInterval",
];

export const PROFILE_KEYS: ParamKey[] = PARAM_ORDER.filter((k) => PARAMS[k].kind === "profile");

/** Format a value at its param's display precision. */
export function formatValue(key: ParamKey, v: number): string {
  return v.toFixed(PARAMS[key].dp);
}
