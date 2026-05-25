// web/src/lib/forge/contour.ts
import type { Contour, Pt } from "./types";

const BEZIER_STEPS = 16; // subdivisions per bezier segment

/** Tokenise an SVG path into [command, ...numbers] groups. */
function tokenize(d: string): Array<{ cmd: string; nums: number[] }> {
  const out: Array<{ cmd: string; nums: number[] }> = [];
  const re = /([MmLlHhVvQqCcZz])([^MmLlHhVvQqCcZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    out.push({ cmd: m[1], nums });
  }
  return out;
}

function quad(p0: Pt, c: Pt, p1: Pt, steps: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    });
  }
  return pts;
}

function cubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, steps: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return pts;
}

/**
 * Flatten an SVG-style dPath (M/L/H/V/Q/C/Z, absolute or relative) into a
 * mm-space polyline. Beziers are subdivided into BEZIER_STEPS chords. Only the
 * commands seen in xTool .xcs incise paths are handled (no arcs / S / T).
 */
export function flattenDPath(d: string): Contour {
  const tokens = tokenize(d);
  const points: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let closed = false;

  for (const { cmd, nums } of tokens) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const base = () => (rel ? cur : { x: 0, y: 0 });
    switch (C) {
      case "M": {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const b = base();
          cur = { x: b.x + nums[i], y: b.y + nums[i + 1] };
          if (i === 0) start = cur;
          points.push(cur);
        }
        break;
      }
      case "L": {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const b = base();
          cur = { x: b.x + nums[i], y: b.y + nums[i + 1] };
          points.push(cur);
        }
        break;
      }
      case "H": {
        for (const n of nums) {
          cur = { x: (rel ? cur.x : 0) + n, y: cur.y };
          points.push(cur);
        }
        break;
      }
      case "V": {
        for (const n of nums) {
          cur = { x: cur.x, y: (rel ? cur.y : 0) + n };
          points.push(cur);
        }
        break;
      }
      case "Q": {
        for (let i = 0; i + 3 < nums.length; i += 4) {
          const b = base();
          const c = { x: b.x + nums[i], y: b.y + nums[i + 1] };
          const p1 = { x: b.x + nums[i + 2], y: b.y + nums[i + 3] };
          points.push(...quad(cur, c, p1, BEZIER_STEPS));
          cur = p1;
        }
        break;
      }
      case "C": {
        for (let i = 0; i + 5 < nums.length; i += 6) {
          const b = base();
          const c1 = { x: b.x + nums[i], y: b.y + nums[i + 1] };
          const c2 = { x: b.x + nums[i + 2], y: b.y + nums[i + 3] };
          const p1 = { x: b.x + nums[i + 4], y: b.y + nums[i + 5] };
          points.push(...cubic(cur, c1, c2, p1, BEZIER_STEPS));
          cur = p1;
        }
        break;
      }
      case "Z": {
        closed = true;
        cur = start;
        break;
      }
    }
  }
  return { points, closed };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const EPS = 1e-6;

/** True if the contour is explicitly closed or its ends coincide. */
export function detectClosedContour(c: Contour): boolean {
  if (c.closed) return true;
  if (c.points.length < 3) return false;
  return dist(c.points[0], c.points[c.points.length - 1]) < 1e-3;
}

/** Remove consecutive duplicate points and any closing duplicate of point 0. */
export function normaliseContour(c: Contour): Contour {
  const pts: Pt[] = [];
  for (const p of c.points) {
    const last = pts[pts.length - 1];
    if (!last || dist(last, p) > EPS) pts.push(p);
  }
  const closed = detectClosedContour(c);
  if (closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < EPS) {
    pts.pop();
  }
  return { points: pts, closed };
}

/** Total length walking the polyline (wrapping if closed). */
export function contourPerimeter(c: Contour): number {
  const n = c.points.length;
  if (n < 2) return 0;
  let total = 0;
  for (let i = 0; i < n - 1; i++) total += dist(c.points[i], c.points[i + 1]);
  if (c.closed) total += dist(c.points[n - 1], c.points[0]);
  return total;
}

/** Shoelace signed area. >0 CCW, <0 CW in screen (y-down) coords. */
export function signedArea(c: Contour): number {
  const p = c.points;
  const n = p.length;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return a / 2;
}

export interface WindingInfo {
  /**
   * The sign to multiply a positive clipper delta by so the offset moves to
   * the OUTSIDE (scrap side) of the contour. For a closed polygon, outside =
   * inflate, so this encodes winding handedness.
   */
  outsideSign: 1 | -1;
  confident: boolean;
}

/**
 * Infer which side is "outside" (scrap). For a closed polygon we use winding:
 * Clipper inflates a positive-area (CCW) polygon outward with a positive delta,
 * so outsideSign = +1 for CCW and -1 for CW. Open contours can't be classified
 * by winding, so we report not-confident and the caller must require a manual
 * side choice (the UI "flip" control).
 */
export function inferWindingAndOutside(c: Contour): WindingInfo {
  if (!detectClosedContour(c) || c.points.length < 3) {
    return { outsideSign: 1, confident: false };
  }
  const area = signedArea(c);
  if (Math.abs(area) < 1e-9) return { outsideSign: 1, confident: false };
  return { outsideSign: area > 0 ? 1 : -1, confident: true };
}
