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
  contourToDPath,
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

describe("contourToDPath", () => {
  it("never emits Infinity/NaN when mmPerUnit is non-positive", () => {
    const pts = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    for (const bad of [0, -1]) {
      const d = contourToDPath(pts, true, bad);
      expect(d).not.toContain("Infinity");
      expect(d).not.toContain("NaN");
    }
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

  it("gives each generated display its OWN bbox, not the source's full bbox", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const srcDisplay = (parsed.raw as { canvas: { displays: Array<Record<string, unknown>> }[] })
      .canvas[0].displays.find((d) => d.id === incise.id)!;
    const srcWidth = srcDisplay.width as number;
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit) as {
      canvas: Array<{ displays: Array<Record<string, unknown>> }>;
    };
    const displays = out.canvas[0].displays.filter((d) => String(d.id).startsWith("forge-"));

    // A perforation pocket is a ~0.2mm feature — its display width must be tiny,
    // NOT the full-pendant source width (the old bug blew pockets up).
    const pocket = displays.find((d) => d.name === "CUT_02_PERFORATE")!;
    expect(pocket.width as number).toBeLessThan(srcWidth / 5);
    expect(pocket.width as number).toBeGreaterThan(0);

    // Every generated display's width/height matches its own dPath extent.
    for (const d of displays) {
      const nums = ((d.dPath as string).match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0);
      const scale = (srcDisplay.scale as { x: number }).x;
      const expectedW = (Math.max(...xs) - Math.min(...xs)) * scale;
      expect(Math.abs((d.width as number) - expectedW)).toBeLessThan(0.05);
    }
  });

  it("applies per-stage param overrides onto the exported INTAGLIO entry", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const seedPath = paths.find((p) => p.groupName === "CUT_01_SEED")!;
    const stageParams = {
      CUT_01_SEED: { power: 42, speed: 333, passes: 7, frequency: 55 },
    };
    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit, stageParams) as {
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { processingType: string; data: { INTAGLIO: { parameter: { customize: Record<string, number> } } } }]> } }]> } };
    };
    // find the seed display's device entry and check overrides took
    const entries = out.device.data.value.flatMap(([, g]) => g.displays.value);
    const seedEntry = entries.find(([id]) => id === `forge-${seedPath.operationOrder}`)![1];
    const c = seedEntry.data.INTAGLIO.parameter.customize;
    expect(c.power).toBe(42);
    expect(c.speed).toBe(333);
    expect(c.repeat).toBe(7);
    expect(c.mopaFrequency).toBe(55);
    // a non-overridden field keeps the source value (source power was 100)
    const deepEntry = entries.find(([id]) => id === `forge-${paths.find((p) => p.generatedClass === "deepen")!.operationOrder}`)![1];
    expect(deepEntry.data.INTAGLIO.parameter.customize.power).toBe(100);
  });
});
