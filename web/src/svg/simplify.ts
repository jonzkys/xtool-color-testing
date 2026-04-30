/**
 * SVG shape simplification — drops sub-threshold shapes and runs
 * Douglas-Peucker on simple polyline paths. Browser-only (uses
 * ``DOMParser``).
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
 * - ``toleranceMm`` simplifies the vertex chain of polyline paths
 *   (``M`` + ``L`` only — Cubic/Quadratic/Arc paths are skipped to
 *   preserve curve fidelity on hand-designed SVGs). Doesn't change
 *   shape *count*, just vertex count per shape — smaller .xcs file
 *   and snappier rendering.
 *
 * Conversion from mm → SVG-user-units uses the project's ``widthMm``
 * vs the SVG's ``viewBox`` width, mirroring how the rest of the
 * pipeline maps coordinates. Falls back to ``width="…"`` /
 * ``height="…"`` when no ``viewBox`` is set.
 */

import simplify from "simplify-js";
import { countShapeVertices } from "./detectLayers";

const SHAPE_SELECTOR = "path, rect, circle, ellipse, line, polyline, polygon";

export interface SimplifyOptions {
  /** Drop shapes whose computed area (in mm²) is below this threshold.
   *  ``0`` disables the area filter. Open paths (``line``, polyline
   *  paths without a closing ``Z``) are exempt — they're inherently
   *  1D and dropping them by area would be unexpected. */
  minAreaMm2: number;
  /** Douglas-Peucker tolerance (in mm) for ``M``/``L``-only path
   *  vertex reduction. ``0`` disables vertex simplification. */
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
   *  polyline paths simplified. This is what gets written into
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
  /** Number of polyline paths whose vertex count was reduced. */
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

  const shapes = Array.from(parsed.querySelectorAll(SHAPE_SELECTOR));
  const beforeShapes = shapes.length;
  let afterShapes = 0;
  let pathsSimplified = 0;
  let beforeVertices = 0;
  let afterVertices = 0;

  // First pass on the SOURCE tree: simplify polyline paths in place
  // (kept and dropped shapes both get the simplification — preview
  // and final SVG share the same path data). Track which shapes are
  // marked-for-drop so we can both flag them on the preview tree
  // and remove them from the final tree.
  const droppedShapes: Element[] = [];

  for (const el of shapes) {
    // Tally before-state vertex count BEFORE the simplification step
    // mutates ``d``, so the delta the dialog shows reflects both the
    // tolerance pass and the area filter dropping shapes.
    beforeVertices += countShapeVertices(el);

    // ── Path vertex simplification ─────────────────────────────────
    if (
      tolerancePx > 0
      && el.tagName === "path"
      && (el.getAttribute("d") || "").length > 0
    ) {
      const d = el.getAttribute("d") as string;
      if (isPolylineOnlyPathD(d)) {
        const pts = parsePolylinePathD(d);
        if (pts.length >= 4) {
          const closed = /[zZ]\s*$/.test(d.trim());
          const simplified = simplify(pts, tolerancePx, /* highQuality */ true);
          if (simplified.length < pts.length && simplified.length >= 2) {
            el.setAttribute("d", emitPolylinePathD(simplified, closed));
            pathsSimplified++;
          }
        }
      }
    }

    // ── Area filter ────────────────────────────────────────────────
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
  // tagged. Serialize first.
  const previewSerialized = new XMLSerializer().serializeToString(parsed);
  const previewOut = restoreXmlProlog(svgText, previewSerialized);

  // Final SVG = preview tree with dropped shapes removed and the flag
  // attribute stripped from any kept shapes (defensive — only dropped
  // shapes carry it, but a stray attr serves no purpose downstream).
  for (const el of droppedShapes) {
    el.parentNode?.removeChild(el);
  }
  // Strip the drop flag from anything else (including dropped descendants
  // inside structural groups, just in case).
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
      // 1D — exempt from area filter.
      return null;
    case "polygon":
      return polygonAreaFromPoints(el.getAttribute("points") ?? "");
    case "polyline":
      // Open polyline — exempt; closing it would change semantics.
      return null;
    case "path": {
      const d = el.getAttribute("d") ?? "";
      if (!d) return 0;
      const closed = /[zZ]\s*$/.test(d.trim());
      // Closed polyline-only path → exact shoelace area.
      // Open polyline-only path → exempt (1D).
      // Curved path → coordinate-extent bbox area.
      if (isPolylineOnlyPathD(d)) {
        if (!closed) return null;
        const pts = parsePolylinePathD(d);
        return polygonArea(pts);
      }
      return curvyPathExtentArea(d);
    }
    default:
      return 0;
  }
}

function polygonAreaFromPoints(raw: string): number {
  const nums = raw.trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return polygonArea(pts);
}

function polygonArea(pts: { x: number; y: number }[]): number {
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
  // Treat number pairs as (x, y) — accurate enough for an extent
  // estimate; control points show up but they bound the curve too.
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

/** True when the path's ``d`` attribute uses only line commands —
 *  ``M``/``L``/``H``/``V``/``Z`` in either case. Returns false for
 *  paths with cubic/quadratic/arc segments so we never destroy
 *  curves. */
function isPolylineOnlyPathD(d: string): boolean {
  return !/[CcQqAaSsTt]/.test(d);
}

/** Parse a line-only path ``d`` into absolute (x, y) points. Handles
 *  M/m/L/l/H/h/V/v/Z/z; falls back to ``[]`` on anything weirder so
 *  the caller can leave the path untouched. */
function parsePolylinePathD(d: string): { x: number; y: number }[] {
  const tokens: { kind: "cmd" | "num"; val: string | number }[] = [];
  const re = /([MmLlHhVvZz])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push({ kind: "cmd", val: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: "num", val: parseFloat(m[2]) });
  }
  const pts: { x: number; y: number }[] = [];
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "cmd") {
      cmd = t.val as string;
      i++;
      continue;
    }
    if (cmd === "M" || cmd === "L") {
      const x = tokens[i].val as number;
      const y = tokens[i + 1]?.val as number;
      if (typeof y !== "number") return [];
      cx = x; cy = y;
      pts.push({ x: cx, y: cy });
      i += 2;
      cmd = "L";
    } else if (cmd === "m" || cmd === "l") {
      const dx = tokens[i].val as number;
      const dy = tokens[i + 1]?.val as number;
      if (typeof dy !== "number") return [];
      cx += dx; cy += dy;
      pts.push({ x: cx, y: cy });
      i += 2;
      cmd = "l";
    } else if (cmd === "H") {
      cx = tokens[i].val as number;
      pts.push({ x: cx, y: cy });
      i += 1;
    } else if (cmd === "h") {
      cx += tokens[i].val as number;
      pts.push({ x: cx, y: cy });
      i += 1;
    } else if (cmd === "V") {
      cy = tokens[i].val as number;
      pts.push({ x: cx, y: cy });
      i += 1;
    } else if (cmd === "v") {
      cy += tokens[i].val as number;
      pts.push({ x: cx, y: cy });
      i += 1;
    } else {
      return [];
    }
  }
  return pts;
}

/** Emit a minimal polyline path ``d`` from points. Always uses
 *  absolute commands and preserves the closing ``Z`` if requested. */
function emitPolylinePathD(
  pts: { x: number; y: number }[], closed: boolean,
): string {
  if (pts.length === 0) return "";
  const round = (n: number) => {
    const s = n.toFixed(4);
    return s.replace(/\.?0+$/, "");
  };
  const out: string[] = [`M${round(pts[0].x)} ${round(pts[0].y)}`];
  for (let i = 1; i < pts.length; i++) {
    out.push(`L${round(pts[i].x)} ${round(pts[i].y)}`);
  }
  if (closed) out.push("Z");
  return out.join(" ");
}
