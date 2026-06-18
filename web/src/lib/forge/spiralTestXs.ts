// web/src/lib/forge/spiralTestXs.ts
// Assemble a spiral-test grid into a single .xs file. Reuses the proven
// buildGeneratedXcs path (all paths emitted as spiral VECTOR_CUTTING in two
// groups) + the .xcs→.xs synthesis (legacyRawToXs(doc, null)). The label group
// is a low-power single-pass cut (it marks rather than severs) — the spec's
// sanctioned fallback, chosen so the whole job stays one VECTOR_CUTTING pipeline.
import { buildGeneratedXcs, parseXcsFile, MAX_PATH_POINTS } from "./xcs";
import { legacyRawToXs } from "./xs";
import type { StageParams } from "./types";
import type { SpiralTestConfig, SpiralTestResult } from "./spiralTest";

// Synthetic canvas key for the template doc — legacyRawToXs(_, null) reuses it
// as the .xs canvas id. Any stable UUID-shaped string works.
const CANVAS_ID = "00000000-0000-4000-8000-0000000000aa";

/** Minimal legacy-raw .xcs doc with ONE INTAGLIO incise display at scale 1 /
 *  offset 0, so buildGeneratedXcs reuses a 1:1 mm→canvas mapping and strips it. */
function templateBytes(): ArrayBuffer {
  const doc = {
    canvas: [
      {
        displays: [
          {
            id: "tpl-incise", type: "PATH", name: "tpl",
            dPath: "M0,0 L1,0 L1,1 L0,1 Z",
            isClosePath: true, isFill: true,
            scale: { x: 1, y: 1 }, offsetX: 0, offsetY: 0,
            x: 0, y: 0, width: 1, height: 1, angle: 0, pivot: { x: 0, y: 0 },
          },
        ],
        layerData: {},
      },
    ],
    device: {
      data: {
        dataType: "Map",
        value: [
          [
            CANVAS_ID,
            {
              mode: "LASER_PLANE",
              displays: {
                dataType: "Map",
                value: [
                  [
                    "tpl-incise",
                    {
                      type: "PATH", processingType: "INTAGLIO", isFill: true,
                      data: { INTAGLIO: { materialType: "customize", parameter: { customize: {} } } },
                    },
                  ],
                ],
              },
            },
          ],
        ],
      },
    },
  };
  return new TextEncoder().encode(JSON.stringify(doc)).buffer;
}

const TEMPLATE_BYTES = templateBytes();

export function buildSpiralTestXs(result: SpiralTestResult, cfg: SpiralTestConfig): ArrayBuffer {
  const parsed = parseXcsFile(TEMPLATE_BYTES);
  const inciseId = parsed.targets[0].id;

  // Only the cut group needs stageParams — buildGeneratedXcs emits every spiral
  // path as VECTOR_CUTTING, then we retag the label group's device entries to a
  // VECTOR_ENGRAVING op below (a vector line-engrave along the single-stroke text).
  const stageParams: Record<string, StageParams> = {
    CUT_SPIRAL: {
      power: cfg.cut.power, speed: cfg.cut.speed, passes: cfg.cut.passes,
      pulseWidth: cfg.cut.pulseWidth, frequency: cfg.cut.frequency, laser: cfg.cut.laser,
      cuttingDrop: true, sinkingMethod: "step",
      firstCuttingDropValue: cfg.cut.focusInitialMm, cuttingDropValue: cfg.cut.focusInitialMm,
      descentIntervalDescent: cfg.cut.focusIntervalPasses, descentPerStep: cfg.cut.focusStepMm,
    },
  };

  const allPaths = [...result.cutPaths, ...result.labelPaths];
  const doc = buildGeneratedXcs(
    parsed, inciseId, allPaths, 1 /* mmPerUnit */, stageParams,
    undefined /* scanAngle */, false /* userOrder */, MAX_PATH_POINTS, false /* joinStrands */,
  );
  retagLabelsAsEngrave(doc, cfg.score);
  return legacyRawToXs(doc, null, false);
}

/** VECTOR_ENGRAVING device entry mirroring a real Studio vector-engrave op. */
function engraveEntry(score: SpiralTestConfig["score"]): Record<string, unknown> {
  return {
    isFill: false,
    type: "PATH",
    processingType: "VECTOR_ENGRAVING",
    data: {
      VECTOR_ENGRAVING: {
        materialType: "customize",
        planType: "blue",
        parameter: {
          customize: {
            processingLightSource: score.laser,
            power: score.power,
            speed: score.speed,
            repeat: score.passes,
            pulseWidth: score.pulseWidth,
            mopaFrequency: score.frequency,
            enableKerf: false,
            kerfDistance: 0,
          },
        },
      },
    },
    processIgnore: false,
    isWhiteModel: true,
  };
}

/** Rewrite the SCORE_LABEL group's device entries (emitted as VECTOR_CUTTING by
 *  buildGeneratedXcs) into a VECTOR_ENGRAVING op, so the labels engrave rather
 *  than cut. The display geometry the writer produced is reused as-is. */
function retagLabelsAsEngrave(doc: unknown, score: SpiralTestConfig["score"]): void {
  const d = doc as {
    canvas: Array<{ displays: Array<{ id: string; name?: string }> }>;
    device: { data: { value: Array<[string, { displays: { value: Array<[string, unknown]> } }]> } };
  };
  const labelIds = new Set(
    d.canvas[0].displays.filter((disp) => disp.name === "SCORE_LABEL").map((disp) => disp.id),
  );
  const entries = d.device.data.value[0][1].displays.value;
  for (const pair of entries) {
    if (labelIds.has(pair[0])) pair[1] = engraveEntry(score);
  }
}
