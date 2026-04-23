/**
 * Client-side SVG colour-layer detection.
 *
 * Replaces the ``/api/svg-detect-layers`` endpoint. The server used to
 * run svgelements ``SVG.parse()`` over the user's SVG to emit a list of
 * unique fill/stroke colours + counts; the browser already has the raw
 * SVG text so the round-trip + Python parse were pure overhead.
 *
 * Colour resolution goes through a real DOM mount + ``getComputedStyle``
 * so CSS-based (class/selector) fills work the same as inline
 * ``fill=`` attributes. The container is detached from layout
 * (``position:absolute; left:-99999px``); ``display:none`` is avoided
 * because some browsers short-circuit style computation on hidden
 * subtrees. Mount → walk → unmount all happens inside a try/finally
 * so we never leak the hidden node.
 *
 * Matches the server's previous semantics exactly for ordering
 * (document order, first-seen-wins), the fill-vs-stroke preference,
 * and the near-white detection heuristic.
 */

import type { DetectedLayer } from "../types";

const SHAPE_SELECTOR = "path, rect, circle, ellipse, line, polyline, polygon";

// Keep these in sync with src/xcs_gen/svg_source.py — the UI's near-white
// hide toggle depends on both ends agreeing on "what counts as white".
const NEAR_WHITE_THRESHOLD = 220;
const NEAR_WHITE_MAX_SPREAD = 20;

export function detectSvgLayers(svgText: string): DetectedLayer[] {
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (parsed.querySelector("parsererror")) {
    throw new Error("Invalid SVG: could not parse document.");
  }
  const docRoot = parsed.documentElement;
  if (!(docRoot instanceof SVGSVGElement)) {
    throw new Error("Not an SVG — root element is not <svg>.");
  }

  // Clone into a node owned by the live document so getComputedStyle
  // resolves CSS rules declared inside the SVG.
  const mounted = document.importNode(docRoot, true) as SVGSVGElement;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:absolute; left:-99999px; top:0; width:0; height:0; overflow:hidden;";
  host.appendChild(mounted);
  document.body.appendChild(host);

  try {
    const order: string[] = [];
    const isFill: Record<string, boolean> = {};
    const counts: Record<string, number> = {};

    const shapes = mounted.querySelectorAll<SVGGraphicsElement>(SHAPE_SELECTOR);
    for (const el of Array.from(shapes)) {
      const style = window.getComputedStyle(el);
      const fill = cssColorToHex(style.fill);
      const stroke = cssColorToHex(style.stroke);

      let color: string | null = null;
      let asFill = false;
      if (fill !== null) {
        color = fill;
        asFill = true;
      } else if (stroke !== null) {
        color = stroke;
        asFill = false;
      }
      if (color == null) continue;

      if (!(color in counts)) {
        order.push(color);
        isFill[color] = asFill;
      }
      counts[color] = (counts[color] ?? 0) + 1;
    }

    return order.map((c) => ({
      color: c,
      shape_count: counts[c],
      is_fill: isFill[c],
      is_near_white: isNearWhite(c),
    }));
  } finally {
    host.remove();
  }
}

/** Normalise a CSS colour string (``rgb(...)``, ``rgba(...)``, ``#...``,
 *  or named like ``red``) into a lowercase ``#rrggbb``. Returns ``null``
 *  for ``none``, paint-server refs (``url(#grad)``), or fully-transparent
 *  alpha. */
function cssColorToHex(css: string | null | undefined): string | null {
  if (!css) return null;
  const s = css.trim().toLowerCase();
  if (s === "" || s === "none" || s === "transparent") return null;
  if (s.startsWith("url(")) return null;

  // ``rgb(r, g, b)`` or ``rgba(r, g, b, a)`` — what getComputedStyle
  // normalises to in all modern browsers.
  const m = s.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*(?:[,/]\s*(\d*(?:\.\d+)?))?\s*\)$/,
  );
  if (m) {
    const a = m[4] !== undefined ? Number(m[4]) : 1;
    if (a === 0) return null;
    return toHex(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  // #rrggbb or #rgb literal — rare since getComputedStyle converts, but
  // we also handle direct attribute values as a defensive fallback.
  if (s.startsWith("#")) {
    if (s.length === 7) return s;
    if (s.length === 4) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    }
  }

  return null;
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function isNearWhite(hex: string): boolean {
  if (!hex || hex.length !== 7 || !hex.startsWith("#")) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return false;
  const lo = Math.min(r, g, b);
  const hi = Math.max(r, g, b);
  return lo >= NEAR_WHITE_THRESHOLD && hi - lo <= NEAR_WHITE_MAX_SPREAD;
}
