/**
 * SVG shape simplification — drops sub-threshold shapes and runs
 * topology-preserving Visvalingam-Whyatt on polyline shapes. Browser-
 * only (uses ``DOMParser``).
 *
 * Two independent levers:
 *
 * - ``minAreaMm2`` removes shapes whose computed area is below the
 *   threshold. Targets vtracer's single-pixel artefacts — typical
 *   raster traces leave hundreds of these and each becomes a separate
 *   path that xTool studio has to render and the laser has to
 *   traverse. Areas come from element attributes (rect/circle exact,
 *   polygon shoelace, polyline-only path shoelace, curve paths use a
 *   coordinate-extent bbox) so the function works without a layout
 *   context — important for tests and Web-Worker use later.
 *
 * - ``toleranceMm`` simplifies the vertex chain of polyline shapes
 *   (path / polygon / polyline). Curved paths (C/Q/A/S/T) and
 *   primitives (rect/circle/ellipse/line) are passed through
 *   untouched. Vertex reduction is performed in a single batched
 *   topology pass so adjacent shapes that share boundaries (vtracer
 *   colour regions) stay aligned — no slivers between them.
 *
 * Conversion from mm → SVG-user-units uses the project's ``widthMm``
 * vs the SVG's ``viewBox`` width, mirroring how the rest of the
 * pipeline maps coordinates. Falls back to ``width="…"`` /
 * ``height="…"`` when no ``viewBox`` is set.
 */

import { countShapeVertices } from "./detectLayers";
import {
  isPolylineOnlyPathD,
  parsePathSubpaths,
  type Pt,
  type SubPath,
} from "./svgGeometry";
import {
  simplifyTopology,
  type RingInput,
  type ShapeInput,
} from "./topoSimplify";

const SHAPE_SELECTOR = "path, rect, circle, ellipse, line, polyline, polygon";

export interface SimplifyOptions {
  /** Drop shapes whose computed area (in mm²) is below this threshold.
   *  ``0`` disables the area filter. Open paths (``line``, polyline
   *  paths without a closing ``Z``) are exempt — they're inherently
   *  1D and dropping them by area would be unexpected. */
  minAreaMm2: number;
  /** Tolerance (in mm) for vertex reduction. ``0`` disables the pass.
   *  Interpreted as the perpendicular offset on a "long-ish" edge that
   *  should still be considered redundant — colinear vertices drop at
   *  any positive value, larger detours need a larger tolerance. */
  toleranceMm: number;
  /** Project width in mm — used together with the SVG viewBox to
   *  convert ``minAreaMm2`` and ``toleranceMm`` into user-units. */
  widthMm: number;
}

/** Attribute name used to flag dropped shapes in the preview SVG.
 *  Stylable via ``[data-xcs-simplify-drop]`` so the dialog can paint
 *  them red over the kept shapes. */
export const DROP_FLAG_ATTR = "data-xcs-simplify-drop";

export interface SimplifyResult {
  /** Rewritten SVG with sub-threshold shapes removed and remaining
   *  polyline shapes simplified. This is what gets written into
   *  ``request.svg_content`` on Apply. */
  svgText: string;
  /** Same tree as ``svgText`` but dropped shapes are kept in-place
   *  and tagged with ``data-xcs-simplify-drop="1"`` so the dialog
   *  can highlight what's about to disappear. The kept shapes are
   *  identical to ``svgText``. */
  previewSvg: string;
  /** Shape count before simplification. */
  beforeShapes: number;
  /** Shape count after the area-threshold pass. */
  afterShapes: number;
  /** Number of polyline shapes whose vertex count was reduced. */
  pathsSimplified: number;
  /** Total vertex count across every detected shape before
   *  simplification — includes shapes that will be dropped, so the
   *  before/after delta reflects both the area filter and the
   *  path-tolerance pass. */
  beforeVertices: number;
  /** Total vertex count across surviving shapes after both passes. */
  afterVertices: number;
}

/**
 * Run simplification end-to-end. Pure transform — caller is
 * responsible for writing the result back into the page state.
 *
 * Throws on invalid SVG input or zero/negative widthMm.
 */
export function simplifySvg(
  svgText: string, opts: SimplifyOptions,
): SimplifyResult {
  if (opts.widthMm <= 0) {
    throw new Error("widthMm must be positive");
  }

  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (parsed.querySelector("parsererror")) {
    throw new Error("Invalid SVG: could not parse document.");
  }
  const docRoot = parsed.documentElement;
  if (docRoot.tagName !== "svg") {
    throw new Error("Not an SVG — root element is not <svg>.");
  }

  const view = parseViewBoxOrSize(docRoot);
  if (view.width <= 0 || view.height <= 0) {
    throw new Error("SVG has no usable viewBox or width/height for scale.");
  }
  const pxPerMm = view.width / opts.widthMm;
  const minAreaPx = opts.minAreaMm2 * pxPerMm * pxPerMm;
  const tolerancePx = opts.toleranceMm * pxPerMm;
  // V-W weight is twice a triangle area. Treating tolerance as the
  // perpendicular offset on an edge of length tolerance gives weight ≈
  // tolerance². For longer edges this is conservative (drops more
  // aggressively), which matches user intuition: small wiggles vanish
  // first, sharp corners stay.
  const weight = tolerancePx * tolerancePx;

  const shapes = Array.from(parsed.querySelectorAll(SHAPE_SELECTOR));
  const beforeShapes = shapes.length;

  // Snapshot before-vertex counts BEFORE the simplification mutates
  // anything, so the delta the dialog shows reflects both the
  // tolerance pass and the area filter dropping shapes.
  let beforeVertices = 0;
  for (const el of shapes) beforeVertices += countShapeVertices(el);

  // ── Vertex simplification (batched, topology-preserving) ───────────
  let pathsSimplified = 0;
  if (tolerancePx > 0) {
    const inputs: ShapeInput[] = [];
    const idToEl = new Map<string, Element>();
    const ringsBefore = new Map<string, RingInput[]>();
    for (let i = 0; i < shapes.length; i++) {
      const el = shapes[i];
      const rings = elementToRings(el);
      if (rings.length === 0) continue;
      const id = `s${i}`;
      inputs.push({ id, rings });
      idToEl.set(id, el);
      ringsBefore.set(id, rings);
    }
    if (inputs.length > 0) {
      const out = simplifyTopology(inputs, weight);
      for (const s of out) {
        const el = idToEl.get(s.id);
        if (!el) continue;
        const before = ringsBefore.get(s.id)!;
        if (ringsDiffer(before, s.rings)) {
          writeRingsToElement(el, s.rings);
          pathsSimplified++;
        }
      }
    }
  }

  // ── Area filter ────────────────────────────────────────────────────
  let afterShapes = 0;
  let afterVertices = 0;
  const droppedShapes: Element[] = [];
  for (const el of shapes) {
    if (minAreaPx > 0) {
      const area = computeArea(el);
      if (area !== null && area < minAreaPx) {
        droppedShapes.push(el);
        el.setAttribute(DROP_FLAG_ATTR, "1");
        continue;
      }
    }
    afterShapes++;
    afterVertices += countShapeVertices(el);
  }

  // Preview SVG = current tree with dropped shapes still present and
  // tagged. Final SVG = same tree minus dropped shapes.
  const previewSerialized = new XMLSerializer().serializeToString(parsed);
  const previewOut = restoreXmlProlog(svgText, previewSerialized);
  for (const el of droppedShapes) {
    el.parentNode?.removeChild(el);
  }
  parsed.querySelectorAll(`[${DROP_FLAG_ATTR}]`).forEach((el) => {
    el.removeAttribute(DROP_FLAG_ATTR);
  });
  const finalSerialized = new XMLSerializer().serializeToString(parsed);
  const finalOut = restoreXmlProlog(svgText, finalSerialized);

  return {
    svgText: finalOut,
    previewSvg: previewOut,
    beforeShapes,
    afterShapes,
    pathsSimplified,
    beforeVertices,
    afterVertices,
  };
}

// ── Shape ↔ ring helpers ───────────────────────────────────────────────

/** SVG element → ring list. Returns ``[]`` for non-polyline elements
 *  (curves, primitives the topology pipeline can't simplify). */
function elementToRings(el: Element): RingInput[] {
  if (el.tagName === "polygon") {
    const pts = parsePointsAttr(el.getAttribute("points") ?? "");
    return pts.length >= 3 ? [{ closed: true, points: pts }] : [];
  }
  if (el.tagName === "polyline") {
    const pts = parsePointsAttr(el.getAttribute("points") ?? "");
    return pts.length >= 2 ? [{ closed: false, points: pts }] : [];
  }
  if (el.tagName === "path") {
    const d = el.getAttribute("d") ?? "";
    if (!d) return [];
    return parsePathSubpaths(d).map<RingInput>((s: SubPath) => ({
      closed: s.closed,
      points: s.points,
    }));
  }
  return [];
}

/** Write a list of rings back to an SVG element, choosing the right
 *  attribute (``points`` for polygon/polyline, ``d`` for path). */
function writeRingsToElement(el: Element, rings: RingInput[]): void {
  if (rings.length === 0) return;
  if (el.tagName === "polygon" || el.tagName === "polyline") {
    const r = rings[0];
    el.setAttribute(
      "points",
      r.points.map((p) => `${roundCoord(p.x)},${roundCoord(p.y)}`).join(" "),
    );
    return;
  }
  if (el.tagName === "path") {
    const parts: string[] = [];
    for (const r of rings) {
      if (r.points.length === 0) continue;
      parts.push(`M${roundCoord(r.points[0].x)} ${roundCoord(r.points[0].y)}`);
      for (let i = 1; i < r.points.length; i++) {
        parts.push(`L${roundCoord(r.points[i].x)} ${roundCoord(r.points[i].y)}`);
      }
      if (r.closed) parts.push("Z");
    }
    el.setAttribute("d", parts.join(" "));
  }
}

function parsePointsAttr(raw: string): Pt[] {
  const nums = raw.trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return pts;
}

function roundCoord(n: number): string {
  const s = n.toFixed(4);
  return s.replace(/\.?0+$/, "");
}

function ringsDiffer(a: RingInput[], b: RingInput[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i].points.length !== b[i].points.length) return true;
  }
  return false;
}

// ── XML helpers ────────────────────────────────────────────────────────

function restoreXmlProlog(original: string, serialized: string): string {
  if (
    original.trimStart().startsWith("<?xml")
    && !serialized.startsWith("<?xml")
  ) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
  }
  return serialized;
}

interface ViewBox { width: number; height: number; }

function parseViewBoxOrSize(svg: Element): ViewBox {
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(parseFloat);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const w = parseFloat(svg.getAttribute("width") ?? "0");
  const h = parseFloat(svg.getAttribute("height") ?? "0");
  return { width: w, height: h };
}

// ── Area filter (unchanged from the pre-topology version) ──────────────

/** Return the shape's area in user-units, or ``null`` for shapes
 *  whose area isn't meaningful (line, open polyline-only path). */
function computeArea(el: Element): number | null {
  const num = (k: string) => parseFloat(el.getAttribute(k) ?? "0") || 0;
  switch (el.tagName) {
    case "rect":
      return Math.abs(num("width") * num("height"));
    case "circle": {
      const r = num("r");
      return Math.PI * r * r;
    }
    case "ellipse":
      return Math.PI * num("rx") * num("ry");
    case "line":
      return null;
    case "polygon":
      return polygonAreaFromPoints(el.getAttribute("points") ?? "");
    case "polyline":
      return null;
    case "path": {
      const d = el.getAttribute("d") ?? "";
      if (!d) return 0;
      // Closed polyline-only path → exact shoelace area summed across
      // all sub-paths (multi-region paths are common in vtracer
      // output). Open polyline-only path → exempt (1D). Curved path →
      // coordinate-extent bbox area.
      if (isPolylineOnlyPathD(d)) {
        const subs = parsePathSubpaths(d);
        const closedSubs = subs.filter((s) => s.closed);
        if (closedSubs.length === 0) return null;
        let total = 0;
        for (const s of closedSubs) total += polygonArea(s.points);
        return total;
      }
      return curvyPathExtentArea(d);
    }
    default:
      return 0;
  }
}

function polygonAreaFromPoints(raw: string): number {
  const nums = raw.trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return polygonArea(pts);
}

function polygonArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(s) * 0.5;
}

/** Coordinate-extent fallback for paths with curves — a coarse
 *  bounding box from min/max x and min/max y across every numeric
 *  token in ``d``. Slightly over-estimates real area, which is the
 *  safer error mode (we keep things we shouldn't drop). */
function curvyPathExtentArea(d: string): number {
  const nums = d.match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g);
  if (!nums || nums.length < 4) return 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = parseFloat(nums[i]);
    const y = parseFloat(nums[i + 1]);
    if (Number.isFinite(x)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (Number.isFinite(y)) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return 0;
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}
