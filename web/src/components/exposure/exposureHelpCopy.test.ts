import { describe, expect, it } from "vitest";
import {
  EXPOSURE_INDEX_HELP,
  EXPOSURE_CHANNEL_HELP,
  EXPOSURE_RAW_PARAM_HELP,
} from "./exposureHelpCopy";
import { INDEX_ROWS, CHANNEL_COLS, RAW_PARAM_ROWS } from "./exposureCorrelations";

describe("exposureHelpCopy", () => {
  it("has an entry for every IndexRow", () => {
    for (const k of INDEX_ROWS) {
      expect(EXPOSURE_INDEX_HELP[k]).toBeDefined();
      expect(EXPOSURE_INDEX_HELP[k].heading.length).toBeGreaterThan(0);
      expect(EXPOSURE_INDEX_HELP[k].definition.length).toBeGreaterThan(0);
      expect(EXPOSURE_INDEX_HELP[k].guide.length).toBeGreaterThan(0);
      expect(EXPOSURE_INDEX_HELP[k].formula.length).toBeGreaterThan(0);
      expect(EXPOSURE_INDEX_HELP[k].inputs.length).toBeGreaterThan(0);
    }
  });

  it("has a fully-populated entry for every ChannelCol", () => {
    for (const k of CHANNEL_COLS) {
      expect(EXPOSURE_CHANNEL_HELP[k]).toBeDefined();
      expect(EXPOSURE_CHANNEL_HELP[k].heading.length).toBeGreaterThan(0);
      expect(EXPOSURE_CHANNEL_HELP[k].definition.length).toBeGreaterThan(0);
      expect(EXPOSURE_CHANNEL_HELP[k].guide.length).toBeGreaterThan(0);
      expect(EXPOSURE_CHANNEL_HELP[k].schematic.length).toBeGreaterThan(0);
    }
  });

  it("has a fully-populated entry for every RawParamRow", () => {
    for (const k of RAW_PARAM_ROWS) {
      expect(EXPOSURE_RAW_PARAM_HELP[k]).toBeDefined();
      expect(EXPOSURE_RAW_PARAM_HELP[k].heading.length).toBeGreaterThan(0);
      expect(EXPOSURE_RAW_PARAM_HELP[k].unit.length).toBeGreaterThan(0);
      expect(EXPOSURE_RAW_PARAM_HELP[k].definition.length).toBeGreaterThan(0);
    }
  });

  it("references every input name in the formula string", () => {
    for (const k of INDEX_ROWS) {
      const help = EXPOSURE_INDEX_HELP[k];
      for (const input of help.inputs) {
        expect(
          help.formula,
          `formula for ${k} should mention input "${input.name}"`,
        ).toContain(input.name);
      }
    }
  });

  it("uses no single-letter input names (full words required)", () => {
    for (const k of INDEX_ROWS) {
      for (const input of EXPOSURE_INDEX_HELP[k].inputs) {
        expect(input.name.length, `${k} input ${input.name}`).toBeGreaterThan(1);
      }
    }
  });
});
