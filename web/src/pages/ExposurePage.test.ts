import { describe, it, expect } from "vitest";
import { mergeFillCellWithBase } from "./ExposurePage";
import type { FillCell } from "../components/exposure/proposeTestMath";

describe("mergeFillCellWithBase", () => {
  it("base values pass through when cell has no overrides", () => {
    const base = {
      power: 12,
      speed: 1000,
      frequency: 200,
      density: 3000,
      passes: 2,
      pulse_width: 80,
    };
    const cell: FillCell = { paramValues: {}, x: 0, y: 0 };
    expect(mergeFillCellWithBase(base, cell)).toEqual(base);
  });

  it("cell.paramValues override base", () => {
    const base = { power: 12, speed: 1000 };
    const cell: FillCell = { paramValues: { power: 14.6 }, x: 0, y: 0 };
    expect(mergeFillCellWithBase(base, cell).power).toBe(14.6);
  });

  it("attaches passes + crosshatch when set on the cell", () => {
    const base = { power: 12, passes: 2 };
    const cell: FillCell = {
      paramValues: {},
      passes: 3,
      crosshatch: true,
      x: 0,
      y: 0,
    };
    const out = mergeFillCellWithBase(base, cell);
    expect(out.passes).toBe(3);
    expect(out.crosshatch).toBe(true);
  });

  it("does not attach passes/crosshatch when undefined on the cell", () => {
    const base = { power: 12, passes: 2 };
    const cell: FillCell = { paramValues: {}, x: 0, y: 0 };
    const out = mergeFillCellWithBase(base, cell);
    expect(out.crosshatch).toBeUndefined();
    expect(out.passes).toBe(2);
  });
});
