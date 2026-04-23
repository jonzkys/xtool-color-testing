import { normalizeColor } from "./color";
import { deltaE2000, hexToLab, type Lab } from "../color/math";
import type { LayerSpec } from "../types";

export interface MergeGroup {
  /** Colours that should collapse into ``representativeColor``. All
   *  entries should be normalized hex (``#rrggbb`` lowercase). */
  sourceColors: string[];
  /** The hex that wins in the rewritten SVG. */
  representativeColor: string;
}

/**
 * Rewrite every element's fill/stroke/inline-style colour so that any
 * colour listed in a group's ``sourceColors`` becomes that group's
 * ``representativeColor``. Colours not in any group pass through
 * untouched. Non-hex values (``none``, ``currentColor``, ``url(#…)``)
 * never match and pass through.
 *
 * Browser-only — uses ``DOMParser``/``XMLSerializer``.
 */
export function mergeColorsInSvg(
  svgText: string,
  groups: MergeGroup[],
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  // DOMParser reports errors as a <parsererror> root or a child element.
  const err =
    doc.documentElement.tagName === "parsererror"
      ? doc.documentElement
      : doc.querySelector("parsererror");
  if (err) {
    throw new Error(`Failed to parse SVG: ${err.textContent ?? "unknown"}`);
  }

  if (groups.length === 0) return svgText;

  // Lookup: normalized source hex -> representative hex.
  const lookup = new Map<string, string>();
  for (const g of groups) {
    for (const src of g.sourceColors) {
      lookup.set(normalizeColor(src), g.representativeColor);
    }
  }

  const rewriteAttr = (el: Element, attr: "fill" | "stroke") => {
    const raw = el.getAttribute(attr);
    if (!raw || raw === "none") return;
    const normalized = normalizeColor(raw);
    const rep = lookup.get(normalized);
    if (rep && rep !== raw) el.setAttribute(attr, rep);
  };

  const rewriteStyle = (el: Element) => {
    const style = el.getAttribute("style");
    if (!style) return;
    let next = style;
    next = next.replace(/fill:\s*([^;]+)/gi, (match, val: string) => {
      const trimmed = val.trim();
      if (trimmed === "none") return match;
      const rep = lookup.get(normalizeColor(trimmed));
      return rep ? `fill: ${rep}` : match;
    });
    next = next.replace(/stroke:\s*([^;]+)/gi, (match, val: string) => {
      const trimmed = val.trim();
      if (trimmed === "none") return match;
      const rep = lookup.get(normalizeColor(trimmed));
      return rep ? `stroke: ${rep}` : match;
    });
    if (next !== style) el.setAttribute("style", next);
  };

  doc.querySelectorAll("*").forEach((el) => {
    rewriteAttr(el, "fill");
    rewriteAttr(el, "stroke");
    rewriteStyle(el);
  });

  const serialized = new XMLSerializer().serializeToString(doc);
  // Preserve the XML prolog when the input had one (XMLSerializer drops it).
  if (svgText.trimStart().startsWith("<?xml") && !serialized.startsWith("<?xml")) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
  }
  return serialized;
}

/**
 * Greedy star clustering: sort layers by shape count desc so dominant
 * colours seed clusters first; each seed absorbs any remaining colour
 * within ``thresholdDeltaE``. Returns only clusters with ≥2 members.
 *
 * Star (seed + satellites) rather than transitive single-linkage keeps
 * results predictable — "colours close to red become red" instead of
 * surprising chain-linking through a midtone.
 */
export function computeColorMergeGroups(
  layers: LayerSpec[],
  shapeCountsByColor: Record<string, number>,
  thresholdDeltaE: number,
): MergeGroup[] {
  const entries = layers.map((l) => ({
    color: l.color,
    count: shapeCountsByColor[l.color] ?? 0,
    lab: /^#[0-9a-fA-F]{6}$/.test(l.color) ? hexToLab(l.color) : null,
  }));
  // Dominant first.
  entries.sort((a, b) => b.count - a.count);

  const assigned = new Set<string>();
  const groups: MergeGroup[] = [];

  for (const seed of entries) {
    if (assigned.has(seed.color) || !seed.lab) continue;
    const cluster: string[] = [seed.color];
    assigned.add(seed.color);
    for (const cand of entries) {
      if (assigned.has(cand.color) || !cand.lab) continue;
      if (deltaE2000(seed.lab as Lab, cand.lab as Lab) <= thresholdDeltaE) {
        cluster.push(cand.color);
        assigned.add(cand.color);
      }
    }
    if (cluster.length >= 2) {
      groups.push({ sourceColors: cluster, representativeColor: seed.color });
    }
  }
  return groups;
}
