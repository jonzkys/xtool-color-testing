// web/src/lib/forge/xcs.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseXcsFile,
  classify,
  findEmbossObjects,
  findInciseObjects,
  extractContourGeometry,
  calibrateMmPerUnit,
  contourToDPath,
  primitiveDPath,
} from "./xcs";

const SAMPLE = resolve(__dirname, "../../../../samples/xcs/incise_emboss.xcs");
function loadSample(): ArrayBuffer {
  const buf = readFileSync(SAMPLE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const TEXT_SAMPLE = resolve(__dirname, "../../../../samples/xcs/test-text.xcs");
function loadText(): ArrayBuffer {
  const b = readFileSync(TEXT_SAMPLE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
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

  it("calibrates mmPerUnit confidently from the display scale (≈0.848)", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const cal = calibrateMmPerUnit(parsed, incise);
    expect(cal.confident).toBe(true);
    // scale.x (0.84813), NOT the buggy perimeter-derived 0.2375.
    expect(cal.mmPerUnit).toBeCloseTo(0.848, 2);
  });
});

describe("classify", () => {
  it("maps processingType tokens to the right mode class", () => {
    expect(classify("INTAGLIO")).toBe("incise");
    expect(classify("VECTOR_CUTTING")).toBe("incise");
    expect(classify("RELIEF")).toBe("emboss");
    expect(classify("VECTOR_ENGRAVING")).toBe("score");
    expect(classify("FILL_VECTOR_ENGRAVING")).toBe("score");
    expect(classify("COLOR_FILL_ENGRAVE")).toBe("score");
    expect(classify("SOMETHING_ELSE")).toBe("other");
    expect(classify(null)).toBe("other");
  });
});

describe("parseXcsFile (incise-only sample: test-text.xcs)", () => {
  it("yields exactly one geometry-bearing cut target and no emboss", () => {
    const parsed = parseXcsFile(loadText());
    expect(parsed.targets.length).toBe(1);
    expect(parsed.targets[0].processingType).toBe("INTAGLIO");
    expect(parsed.targets[0].hasGeometry).toBe(true);
    expect(parsed.emboss.length).toBe(0);
  });

  it("skips phantom device entries (no canvas display) entirely", () => {
    const parsed = parseXcsFile(loadText());
    expect(parsed.objects.length).toBe(1);
    expect(parsed.objects.every((o) => o.hasGeometry)).toBe(true);
    expect(parsed.preserved.length).toBe(0);
  });

  it("calibrates confidently at ≈1.0 (scale.x) with no perimeter", () => {
    const parsed = parseXcsFile(loadText());
    const cal = calibrateMmPerUnit(parsed, parsed.targets[0]);
    expect(cal.confident).toBe(true);
    expect(cal.mmPerUnit).toBeCloseTo(1.0, 3);
  });
});

describe("parseXcsFile (real sample: targets/preserved)", () => {
  it("splits the emboss+incise sample into one target and one preserved layer", () => {
    const parsed = parseXcsFile(loadSample());
    expect(parsed.targets.length).toBe(1);
    expect(parsed.targets[0].processingType).toBe("INTAGLIO");
    expect(parsed.preserved.length).toBe(1);
    expect(parsed.preserved[0].processingType).toBe("RELIEF");
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

import { buildGeneratedXcs, exportXcs, extractContourSubpaths } from "./xcs";
import { runPipeline } from "./pipeline";
import { DEFAULT_CONFIG } from "./defaults";
import { AGGRESSIVE } from "./presets";
import { resolveStageParams, STAGE_GROUPS } from "./config";

const SIZES_SAMPLE = resolve(__dirname, "../../../../samples/xcs/sizes_ex.xcs");
function loadSizes(): ArrayBuffer {
  const b = readFileSync(SIZES_SAMPLE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe("primitive shapes (sizes_ex.xcs — RECT primitives)", () => {
  it("treats RECT primitives as geometry-bearing cut targets", () => {
    const parsed = parseXcsFile(loadSizes());
    expect(parsed.targets.length).toBe(5);
    expect(parsed.targets.every((t) => t.hasGeometry)).toBe(true);
    expect(parsed.targets.every((t) => t.processingType === "INTAGLIO")).toBe(true);
  });

  it("calibrates each rect to its true real-world width", () => {
    const parsed = parseXcsFile(loadSizes());
    const widths = parsed.targets
      .map((t) => {
        const cal = calibrateMmPerUnit(parsed, t);
        const subs = extractContourSubpaths(t);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const c of subs) for (const p of c.points) {
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        return Math.min(maxX - minX, maxY - minY) * cal.mmPerUnit; // short side = rect width
      })
      .sort((a, b) => a - b);
    [0.2, 0.4, 0.8, 1, 5].forEach((exp, i) => expect(widths[i]).toBeCloseTo(exp, 2));
  });
});

describe("source params (incise customize → StageParams)", () => {
  it("attaches mapped params to the cut target (test-text.xcs)", () => {
    const parsed = parseXcsFile(loadText());
    const p = parsed.targets[0].params!;
    expect(p.power).toBe(1);
    expect(p.speed).toBe(80);
    expect(p.passes).toBe(1);          // customize.repeat
    expect(p.pulseWidth).toBe(200);
    expect(p.frequency).toBe(65);      // customize.mopaFrequency
    expect(p.density).toBe(100);
    expect(p.laser).toBe("blue");      // customize.processingLightSource
    expect(p.zAxisMove).toBe(false);
    expect(p.zLayers).toBe(1);
    expect(p.zDecline).toBeCloseTo(0.01, 4);
    expect(p.sliceNumber).toBe(100);
  });
});

describe("applyStageParams (new fields)", () => {
  it("writes density, laser, and the z-descent fields into the INTAGLIO customize", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const seed = paths.find((p) => p.groupName === "CUT_01_SEED")!;
    const stageParams = {
      CUT_01_SEED: { density: 222, laser: "red" as const, zAxisMove: true, zLayers: 8, zDecline: 0.05, sliceNumber: 256 },
    };
    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit, stageParams) as {
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { data: { INTAGLIO: { parameter: { customize: Record<string, unknown> } } } }]> } }]> } };
    };
    const entries = out.device.data.value.flatMap(([, g]) => g.displays.value);
    const c = entries.find(([id]) => id === `forge-${seed.operationOrder}`)![1].data.INTAGLIO.parameter.customize;
    expect(c.density).toBe(222);
    expect(c.processingLightSource).toBe("red");
    expect(c.zAxisMove).toBe(true);
    expect(c.zLayers).toBe(8);
    expect(c.zDecline).toBe(0.05);
    expect(c.sliceNumber).toBe(256);
  });
});

describe("primitiveDPath geometry", () => {
  // bbox over ALL numeric coords (on-curve + control points all lie within the
  // shape's extent for these constructions)
  const bbox = (dp: string) => {
    const nums = (dp.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const disp = (o: Record<string, unknown>) => o as unknown as Parameters<typeof primitiveDPath>[0];

  it("sharp rect at scale 1 → local bbox = w×h, closed", () => {
    const dp = primitiveDPath(disp({ type: "RECT", width: 5, height: 10, scale: { x: 1, y: 1 } }))!;
    expect(dp.endsWith("Z")).toBe(true);
    expect(bbox(dp).w).toBeCloseTo(5, 3);
    expect(bbox(dp).h).toBeCloseTo(10, 3);
  });
  it("scale ≠ 1 → path authored in units = mm / scale", () => {
    const dp = primitiveDPath(disp({ type: "RECT", width: 5, height: 10, scale: { x: 0.5, y: 0.5 } }))!;
    expect(bbox(dp).w).toBeCloseTo(10, 3);  // 5 / 0.5
    expect(bbox(dp).h).toBeCloseTo(20, 3);  // 10 / 0.5
  });
  it("rounded rect uses cubic beziers, stays within bbox, closed", () => {
    const dp = primitiveDPath(disp({ type: "RECT", width: 10, height: 10, radius: 2, scale: { x: 1, y: 1 } }))!;
    expect(dp).toContain("C");
    expect(dp.endsWith("Z")).toBe(true);
    expect(bbox(dp).w).toBeCloseTo(10, 2);
    expect(bbox(dp).h).toBeCloseTo(10, 2);
  });
  it("ellipse/circle → cubic beziers, bbox = w×h", () => {
    const dp = primitiveDPath(disp({ type: "CIRCLE", width: 8, height: 8, scale: { x: 1, y: 1 } }))!;
    expect(dp).toContain("C");
    expect(bbox(dp).w).toBeCloseTo(8, 2);
    expect(bbox(dp).h).toBeCloseTo(8, 2);
  });
  it("zero-size / unknown type → undefined", () => {
    expect(primitiveDPath(disp({ type: "RECT", width: 0, height: 5 }))).toBeUndefined();
    expect(primitiveDPath(disp({ type: "STAR", width: 5, height: 5 }))).toBeUndefined();
  });
});

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

describe("scan-angle on export", () => {
  it("writes processAngle on generated entries when an angle is supplied", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    expect(typeof stats.scanAngleDeg).toBe("number");
    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit, resolveStageParams(DEFAULT_CONFIG), 37) as {
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { data: { INTAGLIO: { parameter: { customize: Record<string, number> } } } }]> } }]> } };
    };
    const entries = out.device.data.value.flatMap(([, g]) => g.displays.value).filter(([id]) => id.startsWith("forge-"));
    expect(entries.length).toBeGreaterThan(0);
    for (const [, e] of entries) expect(e.data.INTAGLIO.parameter.customize.processAngle).toBe(37);
  });
  it("leaves processAngle untouched (source value) when no angle is supplied", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit, resolveStageParams(DEFAULT_CONFIG)) as {
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { data: { INTAGLIO: { parameter: { customize: Record<string, number> } } } }]> } }]> } };
    };
    const entries = out.device.data.value.flatMap(([, g]) => g.displays.value).filter(([id]) => id.startsWith("forge-"));
    // source incise_emboss INTAGLIO processAngle is 15
    for (const [, e] of entries) expect(e.data.INTAGLIO.parameter.customize.processAngle).toBe(15);
  });
});

describe("seed/perforate/clean shallow-slice on export", () => {
  it("seed, perforate, and clean export their config layerCount as sliceNumber (not the source's deep value)", () => {
    // Use test-text.xcs (incise-only; sliceNumber=100 in source).
    // LEAN: seed.layerCount=3, perforate.layerCount=2, clean.layerCount=10.
    const parsed = parseXcsFile(loadText());
    const incise = parsed.targets[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const out = buildGeneratedXcs(
      parsed,
      incise.id,
      paths,
      stats.mmPerUnit,
      resolveStageParams(DEFAULT_CONFIG),
    ) as {
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { data: { INTAGLIO: { parameter: { customize: Record<string, number> } } } }]> } }]> } };
    };
    const entries = out.device.data.value.flatMap(([, g]) => g.displays.value);

    const findEntry = (groupName: string) => {
      const p = paths.find((x) => x.groupName === groupName);
      expect(p).toBeDefined();
      const e = entries.find(([id]) => id === `forge-${p!.operationOrder}`);
      expect(e).toBeDefined();
      return e![1].data.INTAGLIO.parameter.customize;
    };

    // Each fixed stage must use its config layerCount, not the source's 100.
    expect(findEntry(STAGE_GROUPS.seed).sliceNumber).toBe(DEFAULT_CONFIG.seed.layerCount);       // 3
    expect(findEntry(STAGE_GROUPS.perforate).sliceNumber).toBe(DEFAULT_CONFIG.perforate.layerCount); // 2
    expect(findEntry(STAGE_GROUPS.clean).sliceNumber).toBe(DEFAULT_CONFIG.clean.layerCount);     // 10
  });
});

describe("deepen layer count on export", () => {
  it("each deepen display's sliceNumber is its own toLayer (not the source's slice count)", () => {
    // Use AGGRESSIVE (4 groups: 50/100/200/256) so the multi-distinct-toLayer
    // guard actually fires — LEAN has only one enabled group (all toLayer=256).
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const { paths, stats } = runPipeline(parsed, incise.id, AGGRESSIVE);
    // The worker passes resolveStageParams(config) to buildGeneratedXcs.
    const out = buildGeneratedXcs(
      parsed,
      incise.id,
      paths,
      stats.mmPerUnit,
      resolveStageParams(AGGRESSIVE),
    ) as {
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { data: { INTAGLIO: { parameter: { customize: Record<string, number> } } } }]> } }]> } };
    };
    const entries = out.device.data.value.flatMap(([, g]) => g.displays.value);
    const toByName = Object.fromEntries(AGGRESSIVE.deepen.groups.map((g) => [g.name, g.toLayer]));

    const deepenPaths = paths.filter((p) => p.generatedClass === "deepen");
    expect(deepenPaths.length).toBeGreaterThan(0);
    // The deepen passes span more than one distinct toLayer (so a regression to
    // "all the same slice count" would actually be caught).
    expect(new Set(deepenPaths.map((p) => toByName[p.groupName])).size).toBeGreaterThan(1);
    for (const p of deepenPaths) {
      const entry = entries.find(([id]) => id === `forge-${p.operationOrder}`)![1];
      expect(entry.data.INTAGLIO.parameter.customize.sliceNumber).toBe(toByName[p.groupName]);
    }
  });
});
