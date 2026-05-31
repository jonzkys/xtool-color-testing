import { describe, it, expect } from "vitest";
import { renameDeepenGroup, resolveStageParams } from "./config";
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

describe("resolveStageParams (deepen linking)", () => {
  const names = DEFAULT_CONFIG.deepen.groups.map((g) => g.name);
  const [A, B, C, D] = names;

  it("copies the first deepen group's params to later linked groups", () => {
    const cfg = { ...DEFAULT_CONFIG, stageParams: { [A]: { power: 77, speed: 120 } } };
    const r = resolveStageParams(cfg);
    expect(r[B]).toEqual({ power: 77, speed: 120 });
    expect(r[C]).toEqual({ power: 77, speed: 120 });
    expect(r[D]).toEqual({ power: 77, speed: 120 });
    expect(r[A]).toEqual({ power: 77, speed: 120 });
  });

  it("leaves an unlinked deepen group with its own params", () => {
    const groups = DEFAULT_CONFIG.deepen.groups.map((g, i) =>
      i === 1 ? { ...g, copyParamsFromFirst: false } : g);
    const cfg = {
      ...DEFAULT_CONFIG,
      deepen: { ...DEFAULT_CONFIG.deepen, groups },
      stageParams: { [A]: { power: 77 }, [B]: { power: 5 } },
    };
    const r = resolveStageParams(cfg);
    expect(r[B]).toEqual({ power: 5 });
    expect(r[C]).toEqual({ power: 77 });
  });

  it("a linked group with no first-group overrides resolves to empty", () => {
    const r = resolveStageParams(DEFAULT_CONFIG);
    expect(r[B]).toEqual({});
  });
});
