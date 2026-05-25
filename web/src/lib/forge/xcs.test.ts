// web/src/lib/forge/xcs.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseXcsFile,
  findEmbossObjects,
  findInciseObjects,
  extractContourGeometry,
  calibrateMmPerUnit,
} from "./xcs";

const SAMPLE = resolve(__dirname, "../../../../samples/xcs/incise_emboss.xcs");
function loadSample(): ArrayBuffer {
  const buf = readFileSync(SAMPLE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("parseXcsFile (real sample)", () => {
  it("finds exactly one incise (INTAGLIO) and one emboss (RELIEF) object", () => {
    const parsed = parseXcsFile(loadSample());
    expect(findInciseObjects(parsed).length).toBe(1);
    expect(findEmbossObjects(parsed).length).toBe(1);
    expect(findInciseObjects(parsed)[0].processingType).toBe("INTAGLIO");
    expect(findEmbossObjects(parsed)[0].processingType).toBe("RELIEF");
  });

  it("extracts a closed contour with points from the incise object", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const contour = extractContourGeometry(incise);
    expect(contour.points.length).toBeGreaterThan(10);
    expect(contour.closed).toBe(true);
  });

  it("calibrates mmPerUnit confidently from the RELIEF_PROCESS perimeter", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const cal = calibrateMmPerUnit(parsed, incise);
    expect(cal.confident).toBe(true);
    expect(cal.mmPerUnit).toBeGreaterThan(0);
  });
});

describe("parseXcsFile (errors)", () => {
  it("throws on non-JSON input", () => {
    const bad = new TextEncoder().encode("not json").buffer;
    expect(() => parseXcsFile(bad)).toThrow();
  });
});

import { buildGeneratedXcs, exportXcs } from "./xcs";
import { runPipeline } from "./pipeline";
import { DEFAULT_CONFIG } from "./defaults";

interface RawCanvasDoc {
  canvas: Array<{
    displays: Array<{
      id: string;
      dPath?: string;
      isFill?: boolean;
      fillRule?: string;
      layerTag?: string;
      name?: string;
    }>;
    layerData?: Record<string, { name: string; order: number; visible: boolean }>;
  }>;
}

describe("buildGeneratedXcs round-trip", () => {
  it("removes the source incise object and adds generated INTAGLIO entries", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const embossId = findEmbossObjects(parsed)[0].id;
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);

    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit);
    const reparsed = parseXcsFile(exportXcs(out));

    // source incise gone
    expect(reparsed.objects.find((o) => o.id === incise.id)).toBeUndefined();
    // emboss preserved
    expect(reparsed.objects.find((o) => o.id === embossId)).toBeDefined();
    // generated cut entries present and all INTAGLIO
    const generated = reparsed.objects.filter((o) => o.id.startsWith("forge-"));
    expect(generated.length).toBe(paths.length);
    expect(generated.every((o) => o.processingType === "INTAGLIO")).toBe(true);
  });

  it("produces JSON that re-parses (valid document)", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit);
    expect(() => JSON.parse(new TextDecoder().decode(exportXcs(out)))).not.toThrow();
  });

  it("every generated display fills even-odd with a compound band dPath, and stages become layers", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit) as RawCanvasDoc;

    const canvas = out.canvas[0];
    const displays = canvas.displays.filter((d) => d.id.startsWith("forge-"));
    expect(displays.length).toBe(paths.length);

    // source incise display removed; emboss BITMAP layer (#00befe) preserved.
    expect(canvas.displays.find((d) => d.id === incise.id)).toBeUndefined();
    expect(canvas.layerData?.["#00befe"]).toBeDefined();

    for (const d of displays) {
      expect(d.isFill).toBe(true);
      expect(d.fillRule).toBe("evenodd");
      // every generated display's layerTag is a real layerData key
      expect(canvas.layerData?.[d.layerTag!]).toBeDefined();
    }

    // band stages (seed/deepen/clean) emit a compound dPath: ≥2 M commands.
    const bandStages = paths.filter((p) => p.generatedClass !== "perforate");
    for (const p of bandStages) {
      const d = displays.find((x) => x.id === `forge-${p.operationOrder}`)!;
      const mCount = (d.dPath!.match(/M/g) ?? []).length;
      expect(mCount).toBeGreaterThanOrEqual(2);
    }

    // canvas.layerData gains one entry per distinct stage groupName (+ the
    // preserved #00befe emboss entry).
    const distinctGroups = new Set(paths.map((p) => p.groupName));
    const layerKeys = Object.keys(canvas.layerData ?? {});
    expect(layerKeys.length).toBe(distinctGroups.size + 1);

    // and the document still re-parses
    expect(() => parseXcsFile(exportXcs(out))).not.toThrow();
  });
});
