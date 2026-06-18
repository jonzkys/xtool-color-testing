// web/src/lib/forge/spiralTestXs.ts
// Assemble a spiral-test grid into a single .xs file. Spiral cut via
// buildGeneratedXcs (VECTOR_CUTTING); labels appended as filled
// FILL_VECTOR_ENGRAVING displays.
import { buildGeneratedXcs, parseXcsFile, ringsToDPath, MAX_PATH_POINTS } from "./xcs";
import { legacyRawToXs } from "./xs";
import type { SpiralTestConfig, SpiralTestResult } from "./spiralTest";
import { ringsBBox } from "./spiralTest";

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

const LABEL_COLOR = "#0ea5e9"; // distinct layer colour for the engrave op

/** FILL_VECTOR_ENGRAVING device entry (mirrors a Studio fill-engrave op). */
function fillEngraveEntry(score: SpiralTestConfig["score"]): Record<string, unknown> {
  return {
    isFill: true,
    type: "PATH",
    processingType: "FILL_VECTOR_ENGRAVING",
    data: {
      FILL_VECTOR_ENGRAVING: {
        materialType: "customize",
        planType: "blue",
        parameter: {
          customize: {
            bitmapEngraveMode: "normal",
            speed: score.speed,
            density: score.linesPerCm,
            needGapNumDensity: true,
            // dotDuration / dpi / defocus_distance are fixed Studio fill-engrave
            // defaults (not exposed in config); the rest is config-driven.
            dotDuration: 100,
            dpi: 500,
            processingLightSource: score.laser,
            power: score.power,
            repeat: score.passes,
            defocus: false,
            defocus_distance: 3,
            bitmapScanMode: score.scanMode === "bidirectional" ? "zMode" : "nMode",
            pulseWidth: score.pulseWidth,
            mopaFrequency: score.frequency,
          },
        },
      },
    },
    processIgnore: false,
    isWhiteModel: true,
  };
}

export function buildSpiralTestXs(result: SpiralTestResult, cfg: SpiralTestConfig): ArrayBuffer {
  const parsed = parseXcsFile(TEMPLATE_BYTES);
  const inciseId = parsed.targets[0].id;

  // Spiral cut via the proven writer (cut paths only — labels are filled, so
  // they cannot ride the spiral-only / open-path code path). Per-cell cut
  // profiles arrive pre-grouped as result.stageParams (keyed by groupName).
  const doc = buildGeneratedXcs(
    parsed, inciseId, result.cutPaths, 1 /* mmPerUnit */, result.stageParams,
    undefined /* scanAngle */, false /* userOrder */, MAX_PATH_POINTS, false /* joinStrands */,
  ) as {
    canvas: Array<{ displays: Array<Record<string, unknown>>; layerData: Record<string, unknown> }>;
    device: { data: { value: Array<[string, { displays: { value: Array<[string, unknown]> } }]> } };
  };

  // Append each label string as a filled PATH display + a FILL_VECTOR_ENGRAVING entry.
  const canvas = doc.canvas[0];
  const entries = doc.device.data.value[0][1].displays.value;
  canvas.layerData[LABEL_COLOR] = { name: "LABEL_ENGRAVE", order: Object.keys(canvas.layerData).length + 1, visible: true };
  result.labelOutlines.forEach((lbl, i) => {
    if (lbl.rings.length === 0) return;
    const b = ringsBBox(lbl.rings);
    if (!b) return;
    const id = `label-${i}`;
    canvas.displays.push({
      id, type: "PATH", name: "LABEL_ENGRAVE",
      dPath: ringsToDPath(lbl.rings, 1),
      isClosePath: true, isFill: true, fillRule: "nonzero",
      layerTag: LABEL_COLOR, layerColor: LABEL_COLOR,
      scale: { x: 1, y: 1 }, angle: 0, pivot: { x: 0, y: 0 },
      offsetX: 0, offsetY: 0, graphicX: 0, graphicY: 0,
      x: b.minX, y: b.minY, width: b.w, height: b.h,
    });
    entries.push([id, fillEngraveEntry(cfg.score)]);
  });

  return legacyRawToXs(doc, null, false);
}
