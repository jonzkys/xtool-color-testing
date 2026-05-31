import type { ForgeConfig, StageParams } from "./types";

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
 * Expand the per-stage override map for export: every deepen group after the
 * first whose `copyParamsFromFirst` is set (default true) inherits the FIRST
 * deepen group's overrides. Pure — returns a new map; never mutates config.
 */
export function resolveStageParams(config: ForgeConfig): Record<string, StageParams> {
  const out: Record<string, StageParams> = { ...config.stageParams };
  const groups = config.deepen.groups;
  if (groups.length === 0) return out;
  const firstName = groups[0].name;
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    if (g.copyParamsFromFirst ?? true) out[g.name] = config.stageParams[firstName] ?? {};
  }
  return out;
}
