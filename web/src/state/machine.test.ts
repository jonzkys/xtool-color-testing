import { describe, expect, it } from "vitest";
import type { MachinesPayload } from "../types";
import { getValidationProfile } from "./machine";

const REGISTRY: MachinesPayload = {
  machines: [
    {
      id: "F1Ultra", display_name: "F1 Ultra", ext_id: "F1Ultra", ext_name: "F1 Ultra",
      image: "/machines/f1ultra.png",
      lasers: [
        { kind: "fiber", wattage: 20, spot_mm: [0.03, 0.03] },
        { kind: "blue",  wattage: 20, spot_mm: [0.08, 0.10] },
      ],
      modes: [
        { id: "engrave", profile: "STANDARD" },
        { id: "score",   profile: "STANDARD" },
        { id: "cut",     profile: "STANDARD" },
      ],
    },
    {
      id: "F2Ultra", display_name: "F2 Ultra", ext_id: "GS004-CLASS-4", ext_name: "F2 Ultra",
      image: "/machines/f2ultra.png",
      lasers: [
        { kind: "fiber", wattage: 60, spot_mm: [0.03, 0.03] },
        { kind: "blue",  wattage: 40, spot_mm: [0.08, 0.10] },
      ],
      modes: [
        { id: "engrave",       profile: "STANDARD" },
        { id: "score",         profile: "STANDARD" },
        { id: "cut",           profile: "STANDARD" },
        { id: "color_engrave", profile: "COLOR_ENGRAVE" },
      ],
    },
  ],
  profiles: {
    STANDARD: {
      power: { kind: "range", min: 1, max: 100, step: 1 },
      density: { kind: "stepped", values: [10, 20, 30] },
      pulse_width: { kind: "not_applicable" },
    },
    COLOR_ENGRAVE: {
      power: { kind: "range", min: 1, max: 100, step: 1 },
      density: { kind: "range", min: 1, max: 5000 },
      pulse_width: { kind: "stepped", values: [2, 4, 6] },
    },
  } as never,
};

describe("getValidationProfile", () => {
  it("returns STANDARD for F1Ultra engrave", () => {
    const p = getValidationProfile(REGISTRY, "F1Ultra", "engrave");
    expect(p?.pulse_width.kind).toBe("not_applicable");
  });
  it("returns COLOR_ENGRAVE for F2Ultra color_engrave", () => {
    const p = getValidationProfile(REGISTRY, "F2Ultra", "color_engrave");
    expect(p?.pulse_width.kind).toBe("stepped");
  });
  it("returns null for unsupported (machine, mode)", () => {
    expect(getValidationProfile(REGISTRY, "F1Ultra", "color_engrave")).toBeNull();
  });
  it("returns null when registry hasn't loaded yet", () => {
    expect(getValidationProfile(null, "F1Ultra", "engrave")).toBeNull();
  });
  it("resolves a per-machine intaglio profile id", () => {
    const reg = {
      machines: [{ id: "F2Ultra", display_name: "F2 Ultra", ext_id: "", ext_name: "", image: "",
        lasers: [], modes: [{ id: "intaglio", profile: "F2Ultra:intaglio" }] }],
      profiles: { "F2Ultra:intaglio": { power: { kind: "range", min: 1, max: 100 } } },
    } as unknown as MachinesPayload;
    const p = getValidationProfile(reg, "F2Ultra", "intaglio");
    expect(p?.power).toEqual({ kind: "range", min: 1, max: 100 });
  });
});
