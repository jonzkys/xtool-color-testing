import type { ForgeConfig, StageParams } from "./types";

/** Canonical group names for the fixed (non-deepen) stages — the single source
 *  of truth shared by the generators, the exporter and the estimator. */
export const STAGE_GROUPS = {
  seed: "CUT_01_SEED",
  perforate: "CUT_02_PERFORATE",
  clean: "CUT_07_CLEAN",
  spiral: "CUT_08_SPIRAL",
} as const;

/**
 * Rename a deepen pass-group, migrating any per-stage param overrides keyed by
 * the old group name to the new name. Export keys overrides by groupName
 * (xcs.ts), so without this migration a rename would orphan the old overrides
 * and silently drop them on export. Pure — returns a new config, never mutates.
 */
export function renameDeepenGroup(config: ForgeConfig, index: number, newName: string): ForgeConfig {
  const old = config.deepen.groups[index];
  if (!old) return config;
  const oldName = old.name;
  const groups = config.deepen.groups.map((g, i) => (i === index ? { ...g, name: newName } : g));
  const stageParams = { ...config.stageParams };
  if (oldName !== newName && oldName in stageParams) {
    stageParams[newName] = stageParams[oldName];
    delete stageParams[oldName];
  }
  return { ...config, deepen: { ...config.deepen, groups }, stageParams };
}

/**
 * The scan angle (deg) to write to `processAngle` on export, or undefined to
 * leave the source's value untouched. Precedence: the Optimize toggle
 * (auto-optimal) > a manual override > source. `optimalDeg` is the
 * geometry-derived optimum (`DebugStats.scanAngleDeg`).
 */
export function effectiveScanAngle(config: ForgeConfig, optimalDeg: number): number | undefined {
  if (config.optimizeScanAngle) return optimalDeg;
  if (config.manualScanAngleDeg != null) return config.manualScanAngleDeg;
  return undefined;
}

/**
 * Expand the per-stage override map for export. Two deepen-specific rules:
 *  - **Linking:** a deepen group after the first whose `copyParamsFromFirst` is
 *    set (default true) inherits the FIRST deepen group's laser overrides.
 *  - **Layer count:** every deepen group's layer count (`sliceNumber`) is its
 *    OWN end depth (`toLayer`) — never copied from the first. Without this the
 *    deepen stages all inherit the source incise's slice count and engrave the
 *    same number of layers; the whole point of the deepen schedule is that each
 *    pass goes deeper (more layers).
 * Pure — returns a new map; never mutates config.
 */
export function resolveStageParams(config: ForgeConfig): Record<string, StageParams> {
  const sp = config.stageParams;
  const out: Record<string, StageParams> = { ...sp };

  // Fixed stages: a shallow, explicit sliceNumber so they never inherit the
  // source incise's deep slice count (the footgun). Explicit override wins.
  out[STAGE_GROUPS.seed] = {
    ...(sp[STAGE_GROUPS.seed] ?? {}),
    sliceNumber: sp[STAGE_GROUPS.seed]?.sliceNumber ?? config.seed.layerCount,
  };
  out[STAGE_GROUPS.perforate] = {
    ...(sp[STAGE_GROUPS.perforate] ?? {}),
    sliceNumber: sp[STAGE_GROUPS.perforate]?.sliceNumber ?? config.perforate.layerCount,
  };
  out[STAGE_GROUPS.clean] = {
    ...(sp[STAGE_GROUPS.clean] ?? {}),
    sliceNumber: sp[STAGE_GROUPS.clean]?.sliceNumber ?? config.clean.layerCount,
    // `passes` is the StageParams field; applyStageParams maps it → customize.repeat.
    passes: sp[STAGE_GROUPS.clean]?.passes ?? config.clean.passes,
  };

  out[STAGE_GROUPS.spiral] = {
    ...(sp[STAGE_GROUPS.spiral] ?? {}),
    // Vector cut: passes → customize.repeat, NOT raster slices. sliceNumber stays 1.
    passes: sp[STAGE_GROUPS.spiral]?.passes ?? config.spiral.passes,
    sliceNumber: 1,
    // Focus step-down so the cut follows focus down through the thickness.
    // "step" = stepwise descent (descend `descentPerStep` mm every
    // `descentIntervalDescent` passes); "one" is a single drop that ignores the
    // per-step/interval values, making the interval redundant. Studio enum:
    // J.ONE="one", J.STEP="step".
    cuttingDrop: true,
    sinkingMethod: "step",
    descentIntervalDescent: config.spiral.focusIntervalPasses,
    descentPerStep: config.spiral.focusStepMm,
  };

  // Deepen groups: linking + each group's own toLayer as sliceNumber (unchanged).
  const groups = config.deepen.groups;
  if (groups.length > 0) {
    const firstName = groups[0].name;
    groups.forEach((g, i) => {
      const linked = i > 0 && (g.copyParamsFromFirst ?? true);
      const base = linked ? sp[firstName] ?? {} : sp[g.name] ?? {};
      out[g.name] = { ...base, sliceNumber: g.toLayer };
    });
  }
  return out;
}
