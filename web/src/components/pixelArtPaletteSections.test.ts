import { describe, it, expect } from "vitest";

import {
  rankByDeltaE,
  hueOf,
  hueSorted,
  matchesFilter,
} from "./pixelArtPaletteSections";
import type { PaletteEntry } from "../types";

// Minimal valid PaletteEntry. lab=[] forces the hex→Lab fallback path so
// fixtures only need a hex.
function pe(hex: string, over: Partial<PaletteEntry> = {}): PaletteEntry {
  return {
    id: Math.abs(hashStr(hex)),
    machine_id: "F2Ultra",
    test_id: null,
    material_id: 1,
    x_value: null,
    y_value: null,
    hex,
    lab: [],
    params: {},
    sigma: 0,
    source: "manual",
    source_result_id: null,
    notes: "",
    favorited: false,
    created_at: "2026-06-08T00:00:00Z",
    ...over,
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

describe("rankByDeltaE", () => {
  it("orders entries nearest-first; an exact match is ΔE≈0", () => {
    const entries = [pe("#ffffff", { id: 1 }), pe("#000000", { id: 2 }), pe("#c47a3e", { id: 3 })];
    const ranked = rankByDeltaE(entries, "#c47a3e");
    expect(ranked[0].entry.id).toBe(3);
    expect(ranked[0].dE).toBeCloseTo(0, 1);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].dE).toBeGreaterThanOrEqual(ranked[i - 1].dE);
    }
  });

  it("returns dE 0 for every entry when the target colour is malformed", () => {
    const ranked = rankByDeltaE(
      [pe("#ffffff", { id: 1 }), pe("#000000", { id: 2 })],
      "not-a-colour",
    );
    expect(ranked.every((r) => r.dE === 0)).toBe(true);
  });
});

describe("hueOf", () => {
  it("maps primaries to expected hue ranges", () => {
    expect(hueOf("#ff0000")).toBeCloseTo(0, 0);
    expect(hueOf("#00ff00")).toBeCloseTo(120, 0);
    expect(hueOf("#0000ff")).toBeCloseTo(240, 0);
  });

  it("sorts neutrals after all hues (>= 360)", () => {
    expect(hueOf("#808080")).toBeGreaterThanOrEqual(360);
    expect(hueOf("#000000")).toBeGreaterThanOrEqual(360);
    expect(hueOf("#ffffff")).toBeGreaterThanOrEqual(360);
  });
});

describe("hueSorted", () => {
  it("yields rainbow order then neutrals, without mutating the input", () => {
    const input = [pe("#0000ff", { id: 1 }), pe("#808080", { id: 2 }), pe("#ff0000", { id: 3 }), pe("#00ff00", { id: 4 })];
    const out = hueSorted(input);
    expect(out.map((e) => e.id)).toEqual([3, 4, 1, 2]);
    expect(input.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("matchesFilter", () => {
  it("matches label or hex, case-insensitive; empty query matches all", () => {
    expect(matchesFilter("", "SS Tag · gold", "#d4af37")).toBe(true);
    expect(matchesFilter("GOLD", "SS Tag · gold", "#d4af37")).toBe(true);
    expect(matchesFilter("d4af", "SS Tag · gold", "#d4af37")).toBe(true);
    expect(matchesFilter("steel", "SS Tag · gold", "#d4af37")).toBe(false);
  });
});
