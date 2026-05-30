import { describe, it, expect } from "vitest";
import { renameDeepenGroup } from "./config";
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
