import { normalizeColor } from "./color";

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
