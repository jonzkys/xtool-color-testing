import { describe, expect, it } from "vitest";
import { X_AXES, Y_AXES, type XAxis, type YAxis } from "./stabilityChartMath";
import {
  TOOLBAR_HELP,
  X_AXIS_HELP,
  Y_AXIS_HELP,
  type ToolbarHelpKey,
} from "./stabilityHelpCopy";

/* The help copy file is a static map keyed by axis id. The chart's row
 * `?` opens a HelpTip modal that reads ``definition`` + ``guide`` from
 * here, so a missing key would produce an empty card. Lock down coverage
 * with a couple of cheap data tests. */

describe("stabilityHelpCopy", () => {
  it("covers every Y axis with a non-empty definition + guide", () => {
    for (const meta of Y_AXES) {
      const id = meta.id as YAxis;
      const help = Y_AXIS_HELP[id];
      expect(help, `missing Y axis help for ${id}`).toBeDefined();
      expect(help.definition.length).toBeGreaterThan(20);
      expect(help.guide.length).toBeGreaterThan(20);
      expect(help.heading.length).toBeGreaterThan(0);
    }
  });

  it("covers every X axis with a non-empty definition + guide", () => {
    for (const meta of X_AXES) {
      const id = meta.id as XAxis;
      const help = X_AXIS_HELP[id];
      expect(help, `missing X axis help for ${id}`).toBeDefined();
      expect(help.definition.length).toBeGreaterThan(20);
      expect(help.guide.length).toBeGreaterThan(20);
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
      expect(h.definition.length).toBeGreaterThan(20);
      expect(h.guide.length).toBeGreaterThan(20);
    }
  });
});
