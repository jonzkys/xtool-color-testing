import type { ForgeConfig } from "./types";

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
