/**
 * Shared formatting for capture warnings — used by ResultsPanel (per-row
 * pill) and ResultDetailDialog (banner above the swatch grid).
 *
 * The corner names match the burn-space orientation used by the layout
 * module: ArUco IDs 1/2/3 sit at top-right, bottom-left, and bottom-right
 * of the burn area respectively. (The QR carries the top-left corner.)
 */

export const ARUCO_CORNER_NAMES: Record<number, string> = {
  1: "top-right",
  2: "bottom-left",
  3: "bottom-right",
};

/** Render a list of ArUco IDs as a human-readable corner phrase:
 *  [1] → "top-right"
 *  [1, 2] → "top-right and bottom-left"
 *  [1, 2, 3] → "top-right, bottom-left, and bottom-right"
 */
export function formatMissingCorners(ids: number[]): string {
  const names = ids.map((id) => ARUCO_CORNER_NAMES[id] ?? `marker ${id}`);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
