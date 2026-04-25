import { describe, it, expect } from "vitest";
import { defaultBaseParams, defaultSpec, DEFAULT_SPEC } from "./defaults";
import type { ValidationProfile } from "./types";

// ── Profile fixtures (mirrors DynamicParamForm.test.tsx) ─────────────────────

const STANDARD_PROFILE: ValidationProfile = {
  power:       { kind: "range",   min: 1, max: 100, step: 1 },
  density:     { kind: "stepped", values: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200] },
  frequency:   { kind: "range",   min: 30_000, max: 60_000 },
  speed:       { kind: "range",   min: 2, max: 10000 },
  passes:      { kind: "range",   min: 1, max: 99 },
  pulse_width: { kind: "not_applicable" },
  laser:       { kind: "enum",    values: ["red", "blue"] },
};

const COLOR_ENGRAVE_PROFILE: ValidationProfile = {
  power:       { kind: "range",   min: 1, max: 100, step: 1 },
  density:     { kind: "range",   min: 1, max: 5000 },
  frequency:   { kind: "range",   min: 60_000, max: 500_000 },
  speed:       { kind: "range",   min: 2, max: 15000 },
  passes:      { kind: "range",   min: 1, max: 99 },
  pulse_width: { kind: "stepped", values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500] },
  laser:       { kind: "enum",    values: ["red", "blue"] },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("defaultBaseParams", () => {
  it("without a profile returns legacy defaults (regression check)", () => {
    const p = defaultBaseParams();
    expect(p.frequency).toBe(125);
    expect(p.density).toBe(5000);
    expect(p.speed).toBe(1000);
    expect(p.passes).toBe(1);
  });

  it("with STANDARD profile produces frequency within [30000, 60000]", () => {
    const p = defaultBaseParams(STANDARD_PROFILE);
    expect(p.frequency).toBeGreaterThanOrEqual(30_000);
    expect(p.frequency).toBeLessThanOrEqual(60_000);
  });

  it("with COLOR_ENGRAVE profile produces frequency within [60000, 500000]", () => {
    const p = defaultBaseParams(COLOR_ENGRAVE_PROFILE);
    expect(p.frequency).toBeGreaterThanOrEqual(60_000);
    expect(p.frequency).toBeLessThanOrEqual(500_000);
  });

  it("with STANDARD profile produces speed within [2, 10000]", () => {
    const p = defaultBaseParams(STANDARD_PROFILE);
    expect(p.speed).toBeGreaterThanOrEqual(2);
    expect(p.speed).toBeLessThanOrEqual(10_000);
  });

  it("with STANDARD profile keeps laser as 'red' (already a valid enum value)", () => {
    const p = defaultBaseParams(STANDARD_PROFILE);
    expect(p.laser).toBe("red");
  });

  it("with COLOR_ENGRAVE profile picks a valid pulse_width from the stepped list", () => {
    const p = defaultBaseParams(COLOR_ENGRAVE_PROFILE);
    const validValues = [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500];
    expect(validValues).toContain(p.pulse_width);
  });
});

describe("defaultSpec", () => {
  it("without a profile preserves the legacy DEFAULT_SPEC shape", () => {
    const s = defaultSpec();
    expect(s.base_params.frequency).toBe(DEFAULT_SPEC.base_params.frequency);
    expect(s.x_param).toBe("speed");
    expect(s.rows).toBe(1);
  });

  it("with STANDARD profile returns a spec whose frequency is in-range", () => {
    const s = defaultSpec(STANDARD_PROFILE);
    expect(s.base_params.frequency).toBeGreaterThanOrEqual(30_000);
    expect(s.base_params.frequency).toBeLessThanOrEqual(60_000);
  });

  it("with COLOR_ENGRAVE profile returns a spec whose frequency is in-range", () => {
    const s = defaultSpec(COLOR_ENGRAVE_PROFILE);
    expect(s.base_params.frequency).toBeGreaterThanOrEqual(60_000);
    expect(s.base_params.frequency).toBeLessThanOrEqual(500_000);
  });
});

describe("DEFAULT_SPEC (legacy export)", () => {
  it("is defined and has expected shape", () => {
    expect(DEFAULT_SPEC.x_param).toBe("speed");
    expect(DEFAULT_SPEC.base_params.frequency).toBe(125);
  });
});
