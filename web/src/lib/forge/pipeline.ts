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
import { extractContourSubpaths, calibrateMmPerUnit } from "./xcs";
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

  const warnings: string[] = [];

  const cal = calibrateMmPerUnit(parsed, obj);
  const mmPerUnit = cfg.mmPerUnitOverride ?? cal.mmPerUnit;
  if (!cal.confident && cfg.mmPerUnitOverride == null) {
    warnings.push("Could not calibrate path units → mm from the file; using 1.0. Set a manual mm/unit.");
  }

  const rawSubpaths = extractContourSubpaths(obj);
  if (rawSubpaths.length === 0) {
    throw new Error(`incise object ${inciseId} is not a usable vector/path contour`);
  }
  const subpaths = rawSubpaths.map((c) => toMm(c, mmPerUnit));

  // Winding check — run per subpath; warn once if any is not confident.
  let windingWarned = false;
  for (const c of subpaths) {
    const winding = inferWindingAndOutside(c);
    if (!winding.confident && !windingWarned) {
      warnings.push("Inside/outside could not be inferred with confidence — choose a side (flip) before export.");
      windingWarned = true;
    }
  }

  // Physical process order: generate stages for ALL subpaths, then interleave
  // globally as seed → perforate → deepen → clean across the whole part.
  const seed = subpaths.flatMap((c) => generateSeedPaths(c, cfg, inciseId));
  const perf = subpaths.flatMap((c) => generatePerforationPaths(c, cfg, inciseId));
  const deepen = subpaths.flatMap((c) => generateDeepenPaths(c, cfg, inciseId));
  const clean = subpaths.flatMap((c) => generateCleanPaths(c, cfg, inciseId));

  const ordered: GeneratedPath[] = [...seed, ...perf, ...deepen, ...clean];
  ordered.forEach((p, i) => (p.operationOrder = i));

  const pathCounts: Record<GeneratedClass, number> = {
    seed: seed.length,
    perforate: perf.length,
    deepen: deepen.length,
    clean: clean.length,
  };

  const stats: DebugStats = {
    mmPerUnit,
    mmPerUnitConfident: cal.confident || cfg.mmPerUnitOverride != null,
    pathCounts,
    totalPaths: ordered.length,
    warnings,
  };
  return { paths: ordered, stats };
}
