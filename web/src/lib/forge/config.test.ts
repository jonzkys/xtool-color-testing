import { describe, it, expect } from "vitest";
import { renameDeepenGroup, resolveStageParams, effectiveScanAngle, STAGE_GROUPS } from "./config";
import { DEFAULT_CONFIG } from "./defaults";

describe("renameDeepenGroup", () => {
  it("renames the group and migrates its per-stage params to the new key", () => {
    const oldName = DEFAULT_CONFIG.deepen.groups[0].name;
    const cfg = { ...DEFAULT_CONFIG, stageParams: { [oldName]: { power: 42 } } };

    const out = renameDeepenGroup(cfg, 0, "CUT_03_RENAMED");

    expect(out.deepen.groups[0].name).toBe("CUT_03_RENAMED");
    expect(out.stageParams["CUT_03_RENAMED"]).toEqual({ power: 42 });
    expect(out.stageParams[oldName]).toBeUndefined();
  });

  it("leaves other groups and their params untouched", () => {
    const otherName = DEFAULT_CONFIG.deepen.groups[1].name;
    const cfg = { ...DEFAULT_CONFIG, stageParams: { [otherName]: { speed: 100 } } };

    const out = renameDeepenGroup(cfg, 0, "X");

    expect(out.deepen.groups[1].name).toBe(otherName);
    expect(out.stageParams[otherName]).toEqual({ speed: 100 });
  });

  it("does not mutate the input config", () => {
    const oldName = DEFAULT_CONFIG.deepen.groups[0].name;
    const cfg = { ...DEFAULT_CONFIG, stageParams: { [oldName]: { power: 1 } } };
    const snapshot = JSON.stringify(cfg);

    renameDeepenGroup(cfg, 0, "Y");

    expect(JSON.stringify(cfg)).toBe(snapshot);
  });
});

describe("effectiveScanAngle", () => {
  it("uses the optimal angle when Optimize is on (ignoring any manual value)", () => {
    expect(effectiveScanAngle({ ...DEFAULT_CONFIG, optimizeScanAngle: true, manualScanAngleDeg: 33 }, 12)).toBe(12);
  });
  it("uses the manual angle when set and Optimize is off", () => {
    expect(effectiveScanAngle({ ...DEFAULT_CONFIG, optimizeScanAngle: false, manualScanAngleDeg: 33 }, 12)).toBe(33);
  });
  it("inherits source (undefined) when neither is set", () => {
    expect(effectiveScanAngle({ ...DEFAULT_CONFIG, optimizeScanAngle: false, manualScanAngleDeg: null }, 12)).toBeUndefined();
  });
});

describe("resolveStageParams (deepen linking + per-group layer count)", () => {
  const groups = DEFAULT_CONFIG.deepen.groups;
  const [A, B, C, D] = groups.map((g) => g.name);
  const to = Object.fromEntries(groups.map((g) => [g.name, g.toLayer])) as Record<string, number>;

  it("links laser params from the first group but gives each its own layer count (toLayer)", () => {
    const cfg = { ...DEFAULT_CONFIG, stageParams: { [A]: { power: 77, speed: 120 } } };
    const r = resolveStageParams(cfg);
    expect(r[A]).toEqual({ power: 77, speed: 120, sliceNumber: to[A] });
    expect(r[B]).toEqual({ power: 77, speed: 120, sliceNumber: to[B] });
    expect(r[C]).toEqual({ power: 77, speed: 120, sliceNumber: to[C] });
    expect(r[D]).toEqual({ power: 77, speed: 120, sliceNumber: to[D] });
  });

  it("leaves an unlinked deepen group with its own params + own layer count", () => {
    const gs = DEFAULT_CONFIG.deepen.groups.map((g, i) =>
      i === 1 ? { ...g, copyParamsFromFirst: false } : g);
    const cfg = {
      ...DEFAULT_CONFIG,
      deepen: { ...DEFAULT_CONFIG.deepen, groups: gs },
      stageParams: { [A]: { power: 77 }, [B]: { power: 5 } },
    };
    const r = resolveStageParams(cfg);
    expect(r[B]).toEqual({ power: 5, sliceNumber: to[B] });   // own params, own layer count
    expect(r[C]).toEqual({ power: 77, sliceNumber: to[C] });  // linked params, own layer count
  });

  it("each deepen group's layer count is its toLayer even with no overrides", () => {
    const r = resolveStageParams(DEFAULT_CONFIG);
    expect(r[A]).toEqual({ sliceNumber: to[A] });
    expect(r[B]).toEqual({ sliceNumber: to[B] });
    expect(r[D]).toEqual({ sliceNumber: to[D] });
  });
});

describe("resolveStageParams — footgun fix", () => {
  it("seed/perforate/clean get a sliceNumber from their layerCount (not the source's deep value)", () => {
    const cfg = { ...DEFAULT_CONFIG };
    const r = resolveStageParams(cfg);
    expect(r[STAGE_GROUPS.seed].sliceNumber).toBe(cfg.seed.layerCount);
    expect(r[STAGE_GROUPS.perforate].sliceNumber).toBe(cfg.perforate.layerCount);
    expect(r[STAGE_GROUPS.clean].sliceNumber).toBe(cfg.clean.layerCount);
  });

  it("clean.passes flows through as a passes override (→ customize.repeat on export)", () => {
    const cfg = { ...DEFAULT_CONFIG, clean: { ...DEFAULT_CONFIG.clean, passes: 3 } };
    expect(resolveStageParams(cfg)[STAGE_GROUPS.clean].passes).toBe(3);
  });

  it("an explicit per-stage sliceNumber override still wins", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      stageParams: { [STAGE_GROUPS.seed]: { sliceNumber: 7 } },
    };
    expect(resolveStageParams(cfg)[STAGE_GROUPS.seed].sliceNumber).toBe(7);
  });

  it("each deepen group's sliceNumber is still its own toLayer", () => {
    const r = resolveStageParams(DEFAULT_CONFIG);
    for (const g of DEFAULT_CONFIG.deepen.groups) {
      expect(r[g.name].sliceNumber).toBe(g.toLayer);
    }
  });
});
