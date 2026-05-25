// web/src/lib/forge/pipeline.ts
import type {
  Contour,
  DebugStats,
  ForgeConfig,
  GeneratedClass,
  GeneratedPath,
  ParsedXcs,
  PipelineResult,
} from "./types";
import { extractContourGeometry, calibrateMmPerUnit } from "./xcs";
import { inferWindingAndOutside } from "./contour";
import {
  generateCleanPaths,
  generateDeepenPaths,
  generatePerforationPaths,
  generateSeedPaths,
} from "./stages";

/** Scale a contour's points from path units → mm. */
function toMm(c: Contour, mmPerUnit: number): Contour {
  return { points: c.points.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit })), closed: c.closed };
}

/**
 * Run the full generation pipeline against the selected incise object. Returns
 * ordered GeneratedPath[] (seed → perforate → deepen A..D → clean) plus debug
 * stats + warnings. Pure: no I/O, no DOM. Throws only on unrecoverable input
 * (no such object / not a vector path) — soft issues become warnings.
 */
export function runPipeline(
  parsed: ParsedXcs,
  inciseId: string,
  cfg: ForgeConfig,
): PipelineResult {
  const obj = parsed.objects.find((o) => o.id === inciseId);
  if (!obj) throw new Error(`incise object ${inciseId} not found`);
  if (!obj.dPath) throw new Error(`incise object ${inciseId} is not a usable vector/path contour`);

  const warnings: string[] = [];

  const cal = calibrateMmPerUnit(parsed, obj);
  const mmPerUnit = cfg.mmPerUnitOverride ?? cal.mmPerUnit;
  if (!cal.confident && cfg.mmPerUnitOverride == null) {
    warnings.push("Could not calibrate path units → mm from the file; using 1.0. Set a manual mm/unit.");
  }

  const contour = toMm(extractContourGeometry(obj), mmPerUnit);

  const winding = inferWindingAndOutside(contour);
  if (!winding.confident) {
    warnings.push("Inside/outside could not be inferred with confidence — choose a side (flip) before export.");
  }

  // Physical process order. Each generator stamps its own operationOrder
  // locally; we re-stamp a global monotonic order here.
  const seed = generateSeedPaths(contour, cfg, inciseId);
  const perf = generatePerforationPaths(contour, cfg, inciseId);
  const deepen = generateDeepenPaths(contour, cfg, inciseId);
  const clean = generateCleanPaths(contour, cfg, inciseId);

  const ordered: GeneratedPath[] = [...seed, ...perf, ...deepen, ...clean];
  ordered.forEach((p, i) => (p.operationOrder = i));

  const pathCounts: Record<GeneratedClass, number> = {
    seed: seed.length,
    perforate: perf.length,
    deepen: deepen.length,
    clean: clean.length,
  };
  const segmentCount = deepen.filter((p) => p.segmentIndex !== undefined).length;

  const stats: DebugStats = {
    mmPerUnit,
    mmPerUnitConfident: cal.confident || cfg.mmPerUnitOverride != null,
    pathCounts,
    segmentCount,
    totalPaths: ordered.length,
    warnings,
  };
  return { paths: ordered, stats };
}
