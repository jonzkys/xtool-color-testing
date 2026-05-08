import type { ExposureRow } from "./exposureCorrelations";

export const VARYING_AXES = [
  "power",
  "speed",
  "frequency",
  "density",
  "passes",
  "pulse_width",
] as const;

export type VaryingAxis = (typeof VARYING_AXES)[number];

export interface FamilyMember {
  row: ExposureRow;
  varyingAxis: VaryingAxis;
  varyingValue: number;
}

const MIN_FAMILY_SIZE = 3;

function paramOrNaN(row: ExposureRow, axis: VaryingAxis): number {
  const v = row.params?.[axis];
  return typeof v === "number" ? v : NaN;
}

/**
 * Detect recipe families — groups of entries sharing all-but-one
 * parameter. One row can belong to multiple families (one per axis
 * where it has ≥2 siblings, totalling ≥3 members in the group).
 *
 * Returns a Map keyed by `<axis>|<sortedFixedTuple>`. Members within
 * each family are sorted ascending by their varying value.
 */
export function buildFamilies(
  rows: readonly ExposureRow[],
): Map<string, FamilyMember[]> {
  const groups = new Map<string, FamilyMember[]>();
  for (const row of rows) {
    for (const axis of VARYING_AXES) {
      const fixedParts: string[] = [];
      let valid = true;
      for (const a of VARYING_AXES) {
        if (a === axis) continue;
        const v = paramOrNaN(row, a);
        if (Number.isNaN(v)) {
          valid = false;
          break;
        }
        fixedParts.push(`${a}=${v}`);
      }
      if (!valid) continue;
      const varyingValue = paramOrNaN(row, axis);
      if (Number.isNaN(varyingValue)) continue;
      const key = `${axis}|${fixedParts.sort().join(",")}`;
      const list = groups.get(key) ?? [];
      list.push({ row, varyingAxis: axis, varyingValue });
      groups.set(key, list);
    }
  }
  for (const [key, list] of groups) {
    if (list.length < MIN_FAMILY_SIZE) {
      groups.delete(key);
      continue;
    }
    list.sort((a, b) => a.varyingValue - b.varyingValue);
  }
  return groups;
}
