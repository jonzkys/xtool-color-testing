// Assemble src/xcs_gen/data/machine_profiles.json from the extraction findings.
//
// This encodes the per-(machine, mode) constraint matrix derived from:
//   - base field-def ranges (parse-bundle.mjs): power 1-100, frequency 40-150,
//     density 1-300, pulseWidth bounds 2-500, repeat 1-10, identical across all
//     six bundles (shared common module).
//   - per-mode overrides: color_engrave density -> 5000 (widget config max:5e3);
//     cut passes -> 300 (observed repeat up to 250-300).
//   - MOPA frequency -> 4000: the static frequency field-def (40-150) is a
//     generic fallback. The real F2-class control is `mopaFrequency`, max computed
//     per pulse width from the PWMapFrequency (C7) table, ceiling 4000 kHz (bundle
//     default `a=t||4e3`). parse-bundle.mjs can't see it (computed, not a literal),
//     same blind spot as `speed`. Applies to MOPA machines (pulse:true) only.
//   - applicability + sources from the IndexedDB dump + material-device-basic-info:
//       * pulse_width (MOPA) only on F2Ultra & F2UltraSingle  -> elsewhere not_applicable
//       * color_engrave only on F2Ultra & F2UltraSingle (need MOPA pulse control)
//       * frequency not_applicable on diode-only machines (F1Lite, F1)
//       * laser enum from sourcePowerAssoc
//   - speed: bundle uses runtime vars (no literal); keep generous current bounds
//     (2-10000, color_engrave 2-15000) — back-compat safe, never wrongly rejects.
//
// Re-run: node tools/xtool-extract/build-profiles.mjs > src/xcs_gen/data/machine_profiles.json
// See tools/xtool-extract/README.md for the full procedure + migration diff.

const PULSE = [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500];

// machine -> { laser: [...sources], pulse: bool, freq: bool, modes: [...] }
const MACHINES = {
  F2Ultra:       { laser: ["red", "blue"], pulse: true,  freq: true,
    modes: ["engrave", "score", "cut", "color_engrave", "intaglio", "relief"] },
  F2UltraSingle: { laser: ["red"],         pulse: true,  freq: true,
    modes: ["engrave", "score", "cut", "color_engrave", "intaglio", "relief"] },
  F2UltraUV:     { laser: ["uv"],          pulse: false, freq: true,
    modes: ["engrave", "score", "cut", "intaglio", "relief"] },
  F1Ultra:       { laser: ["red", "blue"], pulse: false, freq: true,
    modes: ["engrave", "score", "cut", "intaglio", "relief"] },
  F1Lite:        { laser: ["blue"],        pulse: false, freq: false,
    modes: ["engrave", "score", "cut"] },
  F1:            { laser: ["blue", "red"], pulse: false, freq: false,
    modes: ["engrave", "score", "cut"] },
};

const range = (min, max) => ({ kind: "range", min, max, step: 1 });
const NA = { kind: "not_applicable" };

function profileFor(m, mode) {
  const isColor = mode === "color_engrave";
  const isCut = mode === "cut";
  return {
    power: range(1, 100),
    density: isColor ? range(1, 5000) : range(1, 300),
    // Frequency upper bound is MOPA-dependent and NOT a literal in the bundle.
    // The static `frequency:{min:40,max:150}` field-def parse-bundle.mjs catches
    // is a generic fallback; the real MOPA control is `mopaFrequency`, whose max
    // is computed per pulse width via the PWMapFrequency (C7) table and tops out
    // at 4000 kHz (pw 2-9 ns) — the bundle default is literally `a=t||4e3`. So on
    // MOPA machines (F2Ultra/F2UltraSingle) the honest envelope is 1-4000. Other
    // freq machines (F2UltraUV, F1Ultra) have no MOPA pulse control; keep the
    // static 40-150 base (min relaxed to 1). NA on diode-only (F1Lite, F1).
    frequency: m.freq ? (m.pulse ? range(1, 4000) : range(1, 150)) : NA,
    speed: isColor ? range(2, 15000) : range(2, 10000),
    passes: isCut ? range(1, 300) : range(1, 99),
    pulse_width: m.pulse ? { kind: "stepped", values: PULSE } : NA,
    laser: { kind: "enum", values: m.laser },
  };
}

const profiles = {};
for (const [id, m] of Object.entries(MACHINES)) {
  for (const mode of m.modes) profiles[`${id}:${mode}`] = profileFor(m, mode);
}

const out = {
  meta: {
    source: "xTool Studio 1.7.24",
    extracted: "2026-06-01",
    tool: "tools/xtool-extract (parse-bundle + read-pulse-enums + build-profiles)",
    note: "Per-(machine,mode) constraints. See tools/xtool-extract/README.md.",
  },
  profiles,
};
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
