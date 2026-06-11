// web/src/lib/forge/xs.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { isXsBuffer, xsToLegacyRaw, legacyRawToXs } from "./xs";
import {
  parseXcsFile,
  findInciseObjects,
  findEmbossObjects,
  extractContourGeometry,
  buildGeneratedXcs,
  ringsToDPath,
} from "./xcs";
import { runPipeline } from "./pipeline";
import { DEFAULT_CONFIG } from "./defaults";
import { SPIRAL_CUT } from "./presets";
import { resolveStageParams } from "./config";
import { generateSpiralPaths } from "./spiral";

const XS_SAMPLE = resolve(__dirname, "../../../../samples/xcs/incise_emboss.xs");
const XCS_SAMPLE = resolve(__dirname, "../../../../samples/xcs/incise_emboss.xcs");

function loadXs(): ArrayBuffer {
  const b = readFileSync(XS_SAMPLE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function loadXcs(): ArrayBuffer {
  const b = readFileSync(XCS_SAMPLE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe("isXsBuffer", () => {
  it("returns true for a real .xs (ZIP) bundle", () => {
    expect(isXsBuffer(loadXs())).toBe(true);
  });
  it("returns false for a legacy .xcs JSON document", () => {
    expect(isXsBuffer(loadXcs())).toBe(false);
  });
  it("returns false for arbitrary JSON text", () => {
    expect(isXsBuffer(new TextEncoder().encode('{"hello":1}').buffer)).toBe(false);
  });
  it("returns false for an empty buffer", () => {
    expect(isXsBuffer(new ArrayBuffer(0))).toBe(false);
  });
});

describe("xsToLegacyRaw (incise_emboss.xs)", () => {
  it("reconstructs a legacy-shaped raw that parseXcsFile consumes", () => {
    const { raw } = xsToLegacyRaw(loadXs());
    const parsed = parseXcsFile(toBuf(raw));

    // exactly one incise (INTAGLIO) and one emboss (RELIEF)
    expect(findInciseObjects(parsed).length).toBe(1);
    expect(findEmbossObjects(parsed).length).toBe(1);
    expect(findInciseObjects(parsed)[0].processingType).toBe("INTAGLIO");
    expect(findEmbossObjects(parsed)[0].processingType).toBe("RELIEF");
  });

  it("the INTAGLIO contour is a geometry-bearing target with a real dPath", () => {
    const { raw } = xsToLegacyRaw(loadXs());
    const parsed = parseXcsFile(toBuf(raw));
    expect(parsed.targets.length).toBe(1);
    const incise = parsed.targets[0];
    expect(incise.hasGeometry).toBe(true);
    expect(typeof incise.dPath).toBe("string");
    expect(incise.dPath!.length).toBeGreaterThan(0);
    const contour = extractContourGeometry(incise);
    expect(contour.points.length).toBeGreaterThan(3);
    expect(contour.closed).toBe(true);
  });

  it("populates the incise stage params from the device profile values", () => {
    const { raw } = xsToLegacyRaw(loadXs());
    const parsed = parseXcsFile(toBuf(raw));
    const p = parsed.targets[0].params!;
    expect(p.sliceNumber).toBe(256);
    expect(p.zDecline).toBeCloseTo(0.08, 4);
    expect(p.zAxisMove).toBe(true);
    expect(p.zLayers).toBe(10);
    expect(p.power).toBe(100);
    expect(p.speed).toBe(200);
    expect(p.density).toBe(300);
    expect(p.laser).toBe("red");
  });

  it("preserves the RELIEF emboss as a passed-through layer", () => {
    const { raw } = xsToLegacyRaw(loadXs());
    const parsed = parseXcsFile(toBuf(raw));
    expect(parsed.preserved.length).toBe(1);
    expect(parsed.preserved[0].processingType).toBe("RELIEF");
  });

  it("retains the original bundle members for repack", () => {
    const { bundle } = xsToLegacyRaw(loadXs());
    expect(bundle[".format"]).toBeDefined();
    expect(bundle["project.json"]).toBeDefined();
    // a resource PNG (the relief heightmap) must be retained verbatim
    const pngKeys = Object.keys(bundle).filter(
      (k) => k.startsWith("resources/") && k.endsWith(".png"),
    );
    expect(pngKeys.length).toBeGreaterThan(0);
  });
});

describe("legacyRawToXs (export round-trip)", () => {
  it("re-emits a valid .xs bundle with .format=v2 + project + displays", () => {
    const { raw, bundle } = xsToLegacyRaw(loadXs());
    const out = legacyRawToXs(raw, bundle);
    expect(isXsBuffer(out)).toBe(true);

    const members = unzipSync(new Uint8Array(out));
    expect(strFromU8(members[".format"])).toBe("v2");
    expect(members["project.json"]).toBeDefined();
    const displaysKey = Object.keys(members).find((k) => k.endsWith("displays-0.json"));
    expect(displaysKey).toBeDefined();
    const displays = JSON.parse(strFromU8(members[displaysKey!])).displays as Array<{
      id: string;
      type: string;
    }>;
    // the PATH (incise) + BITMAP (emboss) survive
    expect(displays.some((d) => d.type === "PATH")).toBe(true);
    expect(displays.some((d) => d.type === "BITMAP")).toBe(true);
  });

  it("parse(export(parse(x))) is stable — INTAGLIO params survive a round-trip", () => {
    const first = xsToLegacyRaw(loadXs());
    const parsed1 = parseXcsFile(toBuf(first.raw));
    const incise1 = parsed1.targets[0];
    expect(incise1.params?.sliceNumber).toBe(256);

    const out = legacyRawToXs(first.raw, first.bundle);
    const second = xsToLegacyRaw(out);
    const parsed2 = parseXcsFile(toBuf(second.raw));

    expect(parsed2.targets.length).toBe(1);
    const incise2 = parsed2.targets[0];
    expect(incise2.processingType).toBe("INTAGLIO");
    expect(incise2.params?.sliceNumber).toBe(256);
    expect(incise2.params?.zDecline).toBeCloseTo(0.08, 4);
    expect(incise2.params?.zAxisMove).toBe(true);
    expect(incise2.dPath).toBe(incise1.dPath);
    // emboss still preserved
    expect(parsed2.preserved.length).toBe(1);
    expect(parsed2.preserved[0].processingType).toBe("RELIEF");
  });

  it("retains the relief PNG resource bytes verbatim across export", () => {
    const { raw, bundle } = xsToLegacyRaw(loadXs());
    const srcPng = Object.entries(bundle).find(
      ([k]) => k.startsWith("resources/") && k.endsWith(".png") && !k.includes("project-cover"),
    )!;
    const out = legacyRawToXs(raw, bundle);
    const members = unzipSync(new Uint8Array(out));
    expect(members[srcPng[0]]).toBeDefined();
    expect(Array.from(members[srcPng[0]])).toEqual(Array.from(srcPng[1]));
  });

  it("carries Forge-generated INTAGLIO entries into the rebuilt device file", () => {
    const { raw, bundle } = xsToLegacyRaw(loadXs());
    const parsed = parseXcsFile(toBuf(raw));
    const incise = parsed.targets[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const modified = buildGeneratedXcs(
      parsed,
      incise.id,
      paths,
      stats.mmPerUnit,
      resolveStageParams(DEFAULT_CONFIG),
    );
    const out = legacyRawToXs(modified, bundle);

    // re-read the exported bundle: generated forge-* displays must be present
    // and resolve to INTAGLIO in the device bindings.
    const reparsed = parseXcsFile(toBuf(xsToLegacyRaw(out).raw));
    const generated = reparsed.objects.filter((o) => o.id.startsWith("forge-"));
    expect(generated.length).toBe(paths.length);
    expect(generated.every((o) => o.processingType === "INTAGLIO")).toBe(true);
    // source incise removed, emboss preserved
    expect(reparsed.objects.find((o) => o.id === incise.id)).toBeUndefined();
    expect(reparsed.preserved.some((o) => o.processingType === "RELIEF")).toBe(true);
  });
});

describe("legacyRawToXs from a legacy .xcs (no retained bundle → synthesize)", () => {
  // The Forge page now lets the user export .xs even when the upload was a
  // legacy .xcs. There is no retained v2 bundle, so legacyRawToXs(raw, null)
  // must synthesize a complete bundle from scratch.
  function legacyRaw(): unknown {
    // parseXcsFile keeps the original JSON on parsed.raw; that's the legacy-
    // shaped raw the worker feeds to legacyRawToXs for a .xcs input.
    return parseXcsFile(loadXcs()).raw;
  }

  it("isXsBuffer is false for the legacy .xcs input", () => {
    expect(isXsBuffer(loadXcs())).toBe(false);
  });

  it("synthesizes a valid v2 bundle (.format=v2 + project/profiles/device/displays)", () => {
    const out = legacyRawToXs(legacyRaw(), null);
    expect(isXsBuffer(out)).toBe(true);
    const m = unzipSync(new Uint8Array(out));
    expect(strFromU8(m[".format"]).trim()).toBe("v2");
    expect(m["project.json"]).toBeTruthy();
    expect(m["profiles.json"]).toBeTruthy();
    expect(Object.keys(m).some((k) => k.startsWith("devices/device-"))).toBe(true);
    expect(Object.keys(m).some((k) => /canvases\/.+\/displays-0\.json$/.test(k))).toBe(true);
  });

  it("extracts the inline base64 RELIEF heightmap into a content-addressed resource", () => {
    const out = legacyRawToXs(legacyRaw(), null);
    const m = unzipSync(new Uint8Array(out));
    const pngs = Object.keys(m).filter(
      (k) => /^resources\/[0-9a-f]{64}\.png$/.test(k),
    );
    expect(pngs.length).toBeGreaterThanOrEqual(1); // the emboss heightmap survived
    // a BITMAP display now references it by resourcePath
    const cid = Object.keys(m).find((k) => /canvases\/.+\/displays-0\.json$/.test(k))!;
    const chunk = JSON.parse(strFromU8(m[cid])) as { displays: Array<Record<string, unknown>> };
    const bmp = chunk.displays.find((d) => d.type === "BITMAP");
    expect(typeof bmp?.resourcePath).toBe("string");
    expect((bmp?.resourcePath as string).startsWith("resources/")).toBe(true);
  });

  it("round-trips: synthesize .xs from .xcs, re-read, INTAGLIO target + RELIEF survive", () => {
    const out = legacyRawToXs(legacyRaw(), null);
    const reparsed = xsToLegacyRaw(out);
    const parsed = parseXcsFile(toBuf(reparsed.raw));
    expect(parsed.targets.length).toBeGreaterThanOrEqual(1);
    expect(parsed.targets[0].processingType).toBe("INTAGLIO");
    expect(parsed.preserved.some((o) => o.processingType === "RELIEF")).toBe(true);
    // incise depth params survived the .xcs → .xs → legacy round-trip
    const incise = findInciseObjects(parsed)[0];
    expect(incise.params?.sliceNumber).toBeGreaterThan(0);
  });
});

/** Serialise a legacy-shaped raw object back to a JSON ArrayBuffer (mirrors what
 *  exportXcs does) so parseXcsFile can consume it in tests. */
function toBuf(raw: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(raw)).buffer;
}

// ── Retained-bundle (.xs-input) path: spiral export flips RELIEF→LASER_PLANE ─

describe("legacyRawToXs (retained .xs bundle) — spiral export flips activeMode", () => {
  // This is the real user path: user uploads incise_emboss.xs, Forge runs spiral
  // export, and legacyRawToXs(modifiedRaw, bundle) must recompute activeMode from
  // the current entries (VECTOR_CUTTING only → LASER_PLANE) rather than trusting
  // the stale meta sidecar (was RELIEF_PROCESS because the original .xs had emboss).

  function buildSpiralModifiedRaw() {
    const { raw, bundle } = xsToLegacyRaw(loadXs());
    const parsed = parseXcsFile(toBuf(raw));

    // Grab the INTAGLIO incise target.
    const incise = parsed.targets[0];
    expect(incise).toBeDefined();
    expect(incise.processingType).toBe("INTAGLIO");

    // Generate spiral paths on the contour geometry.
    const contour = extractContourGeometry(incise);
    expect(contour.points.length).toBeGreaterThan(3);
    const spiralPaths = generateSpiralPaths([contour.points], SPIRAL_CUT, incise.id);
    expect(spiralPaths.length).toBeGreaterThan(0);

    // Build the Forge-modified legacy raw — drops INTAGLIO/RELIEF, emits VECTOR_CUTTING.
    const modified = buildGeneratedXcs(
      parsed,
      incise.id,
      spiralPaths,
      1,
      resolveStageParams(SPIRAL_CUT),
    );
    return { modified, bundle, spiralPaths, inciseId: incise.id };
  }

  it("activeMode is LASER_PLANE (not RELIEF_PROCESS) in the repacked .xs device", () => {
    const { modified, bundle } = buildSpiralModifiedRaw();
    const out = legacyRawToXs(modified, bundle);
    expect(isXsBuffer(out)).toBe(true);

    const m = unzipSync(new Uint8Array(out));
    const devKey = Object.keys(m).find((k) => k.startsWith("devices/device-"))!;
    expect(devKey).toBeDefined();
    const device = JSON.parse(strFromU8(m[devKey])) as {
      processing: Record<string, { activeMode: string; modes: Record<string, { data?: Record<string, unknown> }> }>;
    };
    const proc = Object.values(device.processing)[0];
    expect(proc.activeMode).toBe("LASER_PLANE");
  });

  it("mode data.lightSourceMode is 'red' (spiral VECTOR_CUTTING uses MOPA IR)", () => {
    const { modified, bundle } = buildSpiralModifiedRaw();
    const out = legacyRawToXs(modified, bundle);

    const m = unzipSync(new Uint8Array(out));
    const devKey = Object.keys(m).find((k) => k.startsWith("devices/device-"))!;
    const device = JSON.parse(strFromU8(m[devKey])) as {
      processing: Record<string, { activeMode: string; modes: Record<string, { data?: Record<string, unknown> }> }>;
    };
    const proc = Object.values(device.processing)[0];
    const modeData = proc.modes["LASER_PLANE"]?.data ?? {};
    expect(modeData.lightSourceMode).toBe("red");
  });

  it("no profile or binding has processingType INTAGLIO or RELIEF", () => {
    const { modified, bundle } = buildSpiralModifiedRaw();
    const out = legacyRawToXs(modified, bundle);

    const m = unzipSync(new Uint8Array(out));
    const profilesDoc = JSON.parse(strFromU8(m["profiles.json"])) as {
      profiles: Record<string, { processingType: string }>;
    };
    const profileTypes = Object.values(profilesDoc.profiles).map((p) => p.processingType);
    expect(profileTypes.some((t) => t === "INTAGLIO" || t === "RELIEF")).toBe(false);

    const devKey = Object.keys(m).find((k) => k.startsWith("devices/device-"))!;
    const device = JSON.parse(strFromU8(m[devKey])) as {
      processing: Record<string, { modes: Record<string, { bindings?: Array<{ baseProfileId: string }> }> }>;
    };
    const proc = Object.values(device.processing)[0];
    const bindings = proc.modes["LASER_PLANE"]?.bindings ?? [];
    for (const b of bindings) {
      const pt = profilesDoc.profiles[b.baseProfileId]?.processingType ?? "";
      expect(pt === "INTAGLIO" || pt === "RELIEF").toBe(false);
    }
  });

  it("a VECTOR_CUTTING profile IS present in the repacked bundle", () => {
    const { modified, bundle } = buildSpiralModifiedRaw();
    const out = legacyRawToXs(modified, bundle);

    const m = unzipSync(new Uint8Array(out));
    const profilesDoc = JSON.parse(strFromU8(m["profiles.json"])) as {
      profiles: Record<string, { processingType: string }>;
    };
    const profileTypes = Object.values(profilesDoc.profiles).map((p) => p.processingType);
    expect(profileTypes.some((t) => t === "VECTOR_CUTTING")).toBe(true);
  });

  it("re-reading the repacked bundle gives LASER_PLANE activeMode via xsToLegacyRaw", () => {
    const { modified, bundle } = buildSpiralModifiedRaw();
    const out = legacyRawToXs(modified, bundle);

    const { raw: reparsedRaw } = xsToLegacyRaw(out);
    const reparsed = reparsedRaw as { __xsMeta?: { activeMode?: string } };
    expect(reparsed.__xsMeta?.activeMode).toBe("LASER_PLANE");
  });
});

// ── Part B: flat LASER_PLANE + red laser detection ───────────────────────────

/** Build a minimal legacy-shaped raw with a single VECTOR_CUTTING entry that
 *  uses processingLightSource="red" (simulating a spiral-only export). */
function redVectorCuttingRaw(): unknown {
  const canvasId = "canvas-red-spiral";
  const displayId = "spiral-1";
  return {
    canvas: [{
      displays: [{
        id: displayId, type: "PATH", name: "spiral",
        dPath: "M0,0 L10,0 L10,10",
        scale: { x: 1, y: 1 }, offsetX: 0, offsetY: 0,
        isFill: false, isClosePath: false,
      }],
      layerData: {},
    }],
    device: {
      data: {
        dataType: "Map",
        value: [[canvasId, {
          mode: "LASER_PLANE",
          displays: {
            dataType: "Map",
            value: [[displayId, {
              type: "PATH",
              processingType: "VECTOR_CUTTING",
              isFill: false,
              data: {
                VECTOR_CUTTING: {
                  materialType: "customize",
                  planType: "blue",
                  parameter: {
                    customize: {
                      processingLightSource: "red",
                      power: 100, speed: 1500, repeat: 500,
                      pulseWidth: 80, mopaFrequency: 65,
                      cuttingDrop: true, sinkingMethod: "one",
                      descentIntervalDescent: 10, descentPerStep: 0.06,
                    },
                  },
                },
              },
            }]],
          },
        }]],
      },
    },
  };
}

describe("synthModeData — lightSourceMode param (Part B)", () => {
  it("LASER_PLANE defaults to lightSourceMode=blue", () => {
    const out = legacyRawToXs(redVectorCuttingRaw(), null);
    const m = unzipSync(new Uint8Array(out));
    const devKey = Object.keys(m).find((k) => k.startsWith("devices/device-"))!;
    const device = JSON.parse(strFromU8(m[devKey])) as {
      processing: Record<string, { activeMode: string; modes: Record<string, { data?: Record<string, unknown> }> }>;
    };
    // There is exactly one canvas — find the processing entry.
    const proc = Object.values(device.processing)[0];
    expect(proc.activeMode).toBe("LASER_PLANE");
    const modeData = proc.modes["LASER_PLANE"]?.data ?? {};
    // Because this raw carries red VECTOR_CUTTING, lightSourceMode should be "red".
    expect(modeData.lightSourceMode).toBe("red");
  });

  it("LASER_PLANE with blue VECTOR_CUTTING keeps lightSourceMode=blue", () => {
    // Mutate the raw to use blue laser.
    const raw = redVectorCuttingRaw() as { device: { data: { value: Array<[string, { displays: { value: Array<[string, { data: { VECTOR_CUTTING: { parameter: { customize: Record<string, unknown> } } } }]> } }]> } } };
    const customize = raw.device.data.value[0][1].displays.value[0][1].data.VECTOR_CUTTING.parameter.customize;
    customize.processingLightSource = "blue";

    const out = legacyRawToXs(raw, null);
    const m = unzipSync(new Uint8Array(out));
    const devKey = Object.keys(m).find((k) => k.startsWith("devices/device-"))!;
    const device = JSON.parse(strFromU8(m[devKey])) as {
      processing: Record<string, { activeMode: string; modes: Record<string, { data?: Record<string, unknown> }> }>;
    };
    const proc = Object.values(device.processing)[0];
    expect(proc.activeMode).toBe("LASER_PLANE");
    const modeData = proc.modes["LASER_PLANE"]?.data ?? {};
    expect(modeData.lightSourceMode).toBe("blue");
  });
});

// ── Spiral + emboss fixture: flat-mode round-trip through .xs synth ──────────

const embossSquare: import("./types").Pt[] = [
  { x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 },
];

/** Minimal legacy-shaped raw with an INTAGLIO incise target + a RELIEF emboss object.
 *  This is the exact configuration that triggered the Embossment-mode bug. */
function embossInciseRaw(): unknown {
  const targetId = "target-incise";
  const embossId = "target-emboss";
  const canvasId = "canvas-emboss-incise";
  return {
    canvas: [{
      displays: [
        {
          id: targetId,
          type: "PATH",
          name: "incise-square",
          dPath: ringsToDPath([embossSquare], 1),
          scale: { x: 1, y: 1 },
          offsetX: 0, offsetY: 0, graphicX: 0, graphicY: 0,
          x: -10, y: -10, width: 20, height: 20,
          isFill: true, isClosePath: true, fillRule: "evenodd",
        },
        {
          id: embossId,
          type: "BITMAP",
          name: "emboss-relief",
          scale: { x: 1, y: 1 },
          offsetX: 0, offsetY: 0, graphicX: 0, graphicY: 0,
          x: -10, y: -10, width: 20, height: 20,
          layerColor: "#00befe", layerTag: "#00befe",
        },
      ],
      layerData: { "#00befe": { name: "#00BEFE", order: 1, visible: true } },
    }],
    device: {
      data: {
        dataType: "Map",
        value: [[canvasId, {
          mode: "RELIEF_PROCESS",
          displays: {
            dataType: "Map",
            value: [
              [targetId, {
                type: "PATH", processingType: "INTAGLIO", isFill: true,
                data: {
                  INTAGLIO: {
                    parameter: {
                      customize: {
                        processingLightSource: "blue",
                        power: 100, speed: 200, repeat: 1,
                        pulseWidth: 200, mopaFrequency: 65,
                        density: 100, zAxisMove: false,
                        zLayers: 1, zDecline: 0.01, sliceNumber: 100,
                      },
                    },
                  },
                },
              }],
              [embossId, {
                type: "BITMAP", processingType: "RELIEF", isFill: false,
                data: {
                  RELIEF: {
                    parameter: {
                      customize: {
                        processingLightSource: "red",
                        power: 80, speed: 200, repeat: 1, density: 300,
                      },
                    },
                  },
                },
              }],
            ],
          },
        }]],
      },
    },
  };
}

describe("spiral .xs synth from emboss+incise file — activeMode must be LASER_PLANE", () => {
  it("synthesizes LASER_PLANE when spiral export drops all INTAGLIO/RELIEF entries", () => {
    const raw = embossInciseRaw();
    const parsed = parseXcsFile(new TextEncoder().encode(JSON.stringify(raw)).buffer);
    const incise = parsed.targets[0];
    expect(incise).toBeDefined();

    const spiralPaths = generateSpiralPaths([embossSquare], SPIRAL_CUT, incise.id);
    expect(spiralPaths.length).toBeGreaterThan(0);

    // Build the Forge-modified legacy raw (drops INTAGLIO/RELIEF, emits VECTOR_CUTTING).
    const modified = buildGeneratedXcs(parsed, incise.id, spiralPaths, 1, resolveStageParams(SPIRAL_CUT));

    // Synthesize a .xs bundle from the modified legacy raw.
    const xs = legacyRawToXs(modified, null);
    expect(isXsBuffer(xs)).toBe(true);

    // Read the device file and verify activeMode is LASER_PLANE (not RELIEF_PROCESS).
    const m = unzipSync(new Uint8Array(xs));
    const devKey = Object.keys(m).find((k) => k.startsWith("devices/device-"))!;
    expect(devKey).toBeDefined();
    const device = JSON.parse(strFromU8(m[devKey])) as {
      processing: Record<string, { activeMode: string }>;
    };
    const proc = Object.values(device.processing)[0];
    expect(proc.activeMode).toBe("LASER_PLANE");
  });

  it("the spiral VECTOR_CUTTING display survives the .xs synth round-trip", () => {
    const raw = embossInciseRaw();
    const parsed = parseXcsFile(new TextEncoder().encode(JSON.stringify(raw)).buffer);
    const incise = parsed.targets[0];
    const spiralPaths = generateSpiralPaths([embossSquare], SPIRAL_CUT, incise.id);

    const modified = buildGeneratedXcs(parsed, incise.id, spiralPaths, 1, resolveStageParams(SPIRAL_CUT));
    const xs = legacyRawToXs(modified, null);

    // Re-read the bundle: the spiral forge-* displays must survive in the displays chunk.
    const m = unzipSync(new Uint8Array(xs));
    const dispKey = Object.keys(m).find((k) => /canvases\/.+\/displays-0\.json$/.test(k))!;
    expect(dispKey).toBeDefined();
    const chunk = JSON.parse(strFromU8(m[dispKey])) as { displays: Array<{ id: string; type: string }> };
    const forgeDisplays = chunk.displays.filter((d) => d.id.startsWith("forge-"));
    expect(forgeDisplays.length).toBe(spiralPaths.length);
    // No BITMAP (emboss) display — it was dropped.
    expect(chunk.displays.some((d) => d.type === "BITMAP")).toBe(false);
  });
});
