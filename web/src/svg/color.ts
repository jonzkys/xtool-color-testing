/**
 * Normalize CSS colour strings (hex short/long, rgb(), named) to a
 * lowercase 6-digit hex. Shared between the SVG Layers preview and the
 * merge-colors rewriter so both agree on which elements to match.
 */

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
};

export function normalizeColor(color: string): string {
  const c = color.trim().toLowerCase();
  if (c.startsWith("#")) {
    if (c.length === 4) {
      return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    }
    return c;
  }
  if (c.startsWith("rgb")) {
    const m = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const hex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
      return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
    }
  }
  return NAMED_COLORS[c] ?? c;
}
