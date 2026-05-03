import { describe, expect, it } from "vitest";
import { X_AXES, Y_AXES, type XAxis, type YAxis } from "./stabilityChartMath";
import {
  TOOLBAR_HELP,
  X_AXIS_HELP,
  Y_AXIS_HELP,
  type ToolbarHelpKey,
} from "./stabilityHelpCopy";

/* The help copy file is a static map keyed by axis id. The chart renders
 * a HelpTip for every pill, so a missing key would produce a runtime
 * crash. Lock down coverage with a couple of cheap data tests. */

describe("stabilityHelpCopy", () => {
  it("covers every Y axis with a non-empty short + long copy", () => {
    for (const meta of Y_AXES) {
      const id = meta.id as YAxis;
      const help = Y_AXIS_HELP[id];
      expect(help, `missing Y axis help for ${id}`).toBeDefined();
      expect(help.short.length).toBeGreaterThan(10);
      expect(help.long.length).toBeGreaterThan(10);
      expect(help.heading.length).toBeGreaterThan(0);
    }
  });

  it("covers every X axis with a non-empty short + long copy", () => {
    for (const meta of X_AXES) {
      const id = meta.id as XAxis;
      const help = X_AXIS_HELP[id];
      expect(help, `missing X axis help for ${id}`).toBeDefined();
      expect(help.short.length).toBeGreaterThan(10);
      expect(help.long.length).toBeGreaterThan(10);
      expect(help.heading.length).toBeGreaterThan(0);
    }
  });

  it("covers every toolbar / row label key", () => {
    const keys: ToolbarHelpKey[] = [
      "mode",
      "connectors",
      "trend",
      "yRow",
      "xRow",
      "metricRow",
      "calibrate",
    ];
    for (const k of keys) {
      const h = TOOLBAR_HELP[k];
      expect(h, `missing toolbar help for ${k}`).toBeDefined();
      expect(h.short.length).toBeGreaterThan(10);
      expect(h.long.length).toBeGreaterThan(10);
    }
  });
});
