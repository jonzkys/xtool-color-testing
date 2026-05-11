/**
 * MRU (most-recently-used) values per (machine, material, parameter).
 *
 * Persisted to localStorage so recent filter values survive across
 * sessions and tabs. We keep the last 5 distinct values, MRU-ordered
 * (newest at the front). Used by the Filter Stack's per-param
 * "recent" strip and by the data-default fallback.
 */

import type { FilterableParam } from "./exposureFilters";

const STORAGE_PREFIX = "xcsgen.exposure.mru";
const MRU_CAP = 5;
/** Float tolerance for "same value" — keeps 14.6 and 14.599999... as one entry. */
const EQ_EPS = 1e-6;

function key(machineId: string, materialId: number | null, param: FilterableParam): string {
  return `${STORAGE_PREFIX}.${machineId}.${materialId ?? "_"}.${param}`;
}

function loadRaw(k: string): number[] {
  try {
    const raw = window.localStorage.getItem(k);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number =>
      typeof v === "number" && Number.isFinite(v),
    );
  } catch {
    return [];
  }
}

function saveRaw(k: string, values: readonly number[]): void {
  try {
    window.localStorage.setItem(k, JSON.stringify(values));
  } catch {
    // out of quota or disabled — drop silently
  }
}

/** Return the MRU list for (machine, material, param). */
export function getMru(
  machineId: string, materialId: number | null, param: FilterableParam,
): readonly number[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  return loadRaw(key(machineId, materialId, param));
}

/** Bump `value` to the front of the MRU list, dropping duplicates and
 *  trimming to MRU_CAP entries. No-op when value isn't finite. */
export function bumpMru(
  machineId: string, materialId: number | null, param: FilterableParam,
  value: number,
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  if (!Number.isFinite(value)) return;
  const k = key(machineId, materialId, param);
  const current = loadRaw(k);
  const filtered = current.filter((v) => Math.abs(v - value) > EQ_EPS * Math.max(1, Math.abs(value)));
  const next = [value, ...filtered].slice(0, MRU_CAP);
  saveRaw(k, next);
}

/** Clear all MRU lists for this machine + material. Useful for tests. */
export function clearMru(
  machineId: string, materialId: number | null,
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const prefix = `${STORAGE_PREFIX}.${machineId}.${materialId ?? "_"}.`;
  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(prefix)) window.localStorage.removeItem(k);
  }
}
