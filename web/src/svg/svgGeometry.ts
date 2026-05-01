/**
 * SVG path-d → list of sub-paths. Each sub-path is a sequence of
 * (x, y) points plus a ``closed`` flag (Z presence).
 *
 * A new sub-path starts at every `M`/`m` token. Returns `[]` for
 * malformed input or paths containing curve commands (C/Q/A/S/T) so
 * callers can fall back to leaving the path untouched — the
 * topology-preserving simplifier deliberately skips curves to keep
 * hand-designed SVGs untouched.
 *
 * Used by both the area-filter pass (computes per-subpath area for
 * holes) and the topology-preserving simplifier (each closed sub-path
 * is its own ring, each open sub-path its own line string).
 */

export interface Pt { x: number; y: number; }

export interface SubPath {
  closed: boolean;
  points: Pt[];
}

const POLYLINE_ONLY_RE = /[CcQqAaSsTt]/;

export function isPolylineOnlyPathD(d: string): boolean {
  return !POLYLINE_ONLY_RE.test(d);
}

export function parsePathSubpaths(d: string): SubPath[] {
  if (!isPolylineOnlyPathD(d)) return [];
  const tokens: { kind: "cmd" | "num"; val: string | number }[] = [];
  const re = /([MmLlHhVvZz])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push({ kind: "cmd", val: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: "num", val: parseFloat(m[2]) });
  }

  const subpaths: SubPath[] = [];
  let currentIdx = -1;
  const current = () => (currentIdx >= 0 ? subpaths[currentIdx] : null);
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let subStartX = 0;
  let subStartY = 0;
  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "cmd") {
      cmd = t.val as string;
      if (cmd === "Z" || cmd === "z") {
        const sp = current();
        if (sp) sp.closed = true;
        cx = subStartX;
        cy = subStartY;
        currentIdx = -1;
        i++;
        continue;
      }
      i++;
      continue;
    }
    // Numeric token without an active subpath and no leading M is malformed.
    if (cmd === "") return [];
    if (currentIdx < 0 && cmd !== "M" && cmd !== "m") return [];

    if (cmd === "M") {
      const x = tokens[i].val as number;
      const y = tokens[i + 1]?.val as number;
      if (typeof y !== "number") return [];
      cx = x; cy = y;
      subpaths.push({ closed: false, points: [{ x: cx, y: cy }] });
      currentIdx = subpaths.length - 1;
      subStartX = cx; subStartY = cy;
      i += 2;
      cmd = "L";
    } else if (cmd === "m") {
      const dx = tokens[i].val as number;
      const dy = tokens[i + 1]?.val as number;
      if (typeof dy !== "number") return [];
      cx += dx; cy += dy;
      subpaths.push({ closed: false, points: [{ x: cx, y: cy }] });
      currentIdx = subpaths.length - 1;
      subStartX = cx; subStartY = cy;
      i += 2;
      cmd = "l";
    } else if (cmd === "L") {
      const sp = current();
      const x = tokens[i].val as number;
      const y = tokens[i + 1]?.val as number;
      if (typeof y !== "number" || !sp) return [];
      cx = x; cy = y;
      sp.points.push({ x: cx, y: cy });
      i += 2;
    } else if (cmd === "l") {
      const sp = current();
      const dx = tokens[i].val as number;
      const dy = tokens[i + 1]?.val as number;
      if (typeof dy !== "number" || !sp) return [];
      cx += dx; cy += dy;
      sp.points.push({ x: cx, y: cy });
      i += 2;
    } else if (cmd === "H") {
      const sp = current();
      if (!sp) return [];
      cx = tokens[i].val as number;
      sp.points.push({ x: cx, y: cy });
      i += 1;
    } else if (cmd === "h") {
      const sp = current();
      if (!sp) return [];
      cx += tokens[i].val as number;
      sp.points.push({ x: cx, y: cy });
      i += 1;
    } else if (cmd === "V") {
      const sp = current();
      if (!sp) return [];
      cy = tokens[i].val as number;
      sp.points.push({ x: cx, y: cy });
      i += 1;
    } else if (cmd === "v") {
      const sp = current();
      if (!sp) return [];
      cy += tokens[i].val as number;
      sp.points.push({ x: cx, y: cy });
      i += 1;
    } else {
      return [];
    }
  }

  // Drop the closing duplicate vertex when present (Z auto-closes a
  // ring; topojson ingests a non-duplicate ring just fine and we
  // re-emit Z at write time).
  for (const sp of subpaths) {
    if (
      sp.closed && sp.points.length >= 2
      && sp.points[0].x === sp.points[sp.points.length - 1].x
      && sp.points[0].y === sp.points[sp.points.length - 1].y
    ) {
      sp.points.pop();
    }
  }

  return subpaths;
}
