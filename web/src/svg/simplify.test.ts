// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { simplifySvg } from "./simplify";

const SVG = (body: string, opts: { width?: number; viewBox?: string } = {}) => {
  const w = opts.width ?? 100;
  const vb = opts.viewBox ?? `0 0 ${w} ${w}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${w}">${body}</svg>`;
};

describe("simplifySvg", () => {
  it("drops shapes whose bbox area is below the threshold", () => {
    // viewBox 100×100 maps to widthMm=100 ⇒ 1 px = 1 mm.
    // big rect: 50×50 = 2500 mm² → keep
    // tiny dot: 1×1 = 1 mm²        → drop at minAreaMm2=2
    const svg = SVG(`
      <rect x="0" y="0" width="50" height="50" fill="#ff0000"/>
      <rect x="60" y="60" width="1" height="1" fill="#00ff00"/>
    `);
    const r = simplifySvg(svg, { minAreaMm2: 2, toleranceMm: 0, widthMm: 100 });
    expect(r.beforeShapes).toBe(2);
    expect(r.afterShapes).toBe(1);
    expect(r.svgText).toContain("#ff0000");
    expect(r.svgText).not.toContain("#00ff00");
  });

  it("keeps everything when minAreaMm2=0 and toleranceMm=0", () => {
    const svg = SVG(`<rect x="0" y="0" width="1" height="1"/>`);
    const r = simplifySvg(svg, { minAreaMm2: 0, toleranceMm: 0, widthMm: 100 });
    expect(r.beforeShapes).toBe(1);
    expect(r.afterShapes).toBe(1);
    expect(r.pathsSimplified).toBe(0);
  });

  it("simplifies vertex chain on a polyline path", () => {
    // 6 collinear-ish points in a 50×50 vector — Douglas-Peucker
    // should collapse the colinear interior points.
    const d = "M0 0 L10 0.05 L20 0.1 L30 0.05 L40 0 L50 0";
    const svg = SVG(`<path d="${d}" fill="none" stroke="#000"/>`);
    const r = simplifySvg(svg, {
      minAreaMm2: 0, toleranceMm: 1, widthMm: 100,
    });
    expect(r.afterShapes).toBe(1);
    expect(r.pathsSimplified).toBe(1);
    // Resulting d should have fewer L commands.
    const matched = r.svgText.match(/<path[^/]*d="([^"]+)"/);
    expect(matched).not.toBeNull();
    const newD = matched![1];
    const lCount = (newD.match(/L/g) ?? []).length;
    expect(lCount).toBeLessThan(5);
  });

  it("preserves curved paths (skips simplification on C/Q/A)", () => {
    const d = "M0 0 C 10 0 20 10 30 30 L 40 40";
    const svg = SVG(`<path d="${d}" fill="none" stroke="#000"/>`);
    const r = simplifySvg(svg, {
      minAreaMm2: 0, toleranceMm: 5, widthMm: 100,
    });
    expect(r.pathsSimplified).toBe(0);
    expect(r.svgText).toContain(d);
  });

  it("preserves the closing Z when simplifying a polyline path", () => {
    // Closed square traced via repeated colinear vertices to give DP
    // something to remove.
    const d = "M0 0 L25 0 L50 0 L50 25 L50 50 L25 50 L0 50 L0 25 Z";
    const svg = SVG(`<path d="${d}" fill="#abc"/>`);
    const r = simplifySvg(svg, {
      minAreaMm2: 0, toleranceMm: 1, widthMm: 100,
    });
    expect(r.pathsSimplified).toBe(1);
    const newD = r.svgText.match(/<path[^/]*d="([^"]+)"/)![1];
    expect(newD.trim().endsWith("Z")).toBe(true);
  });

  it("converts mm thresholds against the viewBox/width ratio", () => {
    // viewBox 1000×1000, widthMm=10 ⇒ 1 mm = 100 px ⇒ 1 mm² = 10000 px².
    // A 50×50 px rect has area 2500 px² = 0.25 mm² → drops at 0.5 mm²,
    // keeps at 0.1 mm².
    const svg = SVG(`<rect x="0" y="0" width="50" height="50"/>`,
      { width: 1000, viewBox: "0 0 1000 1000" });
    const dropped = simplifySvg(svg, {
      minAreaMm2: 0.5, toleranceMm: 0, widthMm: 10,
    });
    expect(dropped.afterShapes).toBe(0);
    const kept = simplifySvg(svg, {
      minAreaMm2: 0.1, toleranceMm: 0, widthMm: 10,
    });
    expect(kept.afterShapes).toBe(1);
  });

  it("rejects invalid SVG input", () => {
    expect(() =>
      simplifySvg("not an svg", { minAreaMm2: 0, toleranceMm: 0, widthMm: 100 }),
    ).toThrow();
  });

  it("rejects non-positive widthMm", () => {
    const svg = SVG(`<rect width="1" height="1"/>`);
    expect(() =>
      simplifySvg(svg, { minAreaMm2: 0, toleranceMm: 0, widthMm: 0 }),
    ).toThrow();
  });

  it("reports before/after vertex counts", () => {
    // A 6-vertex M/L path with collinear interior points; DP at
    // toleranceMm=1 should reduce it to ~2 vertices.
    const d = "M0 0 L10 0.05 L20 0.1 L30 0.05 L40 0 L50 0";
    const svg = SVG(`<path d="${d}" fill="none" stroke="#000"/>`);
    const r = simplifySvg(svg, {
      minAreaMm2: 0, toleranceMm: 1, widthMm: 100,
    });
    expect(r.beforeVertices).toBe(6);
    expect(r.afterVertices).toBeLessThan(6);
    expect(r.afterVertices).toBeGreaterThanOrEqual(2);
  });

  it("reports the vertex count of dropped shapes in the before total", () => {
    // 4 (kept rect) + 4 (dropped rect) = 8 before; only 4 after.
    const svg = SVG(`
      <rect x="0" y="0" width="50" height="50" fill="#ff0000"/>
      <rect x="60" y="60" width="1" height="1" fill="#00ff00"/>
    `);
    const r = simplifySvg(svg, {
      minAreaMm2: 2, toleranceMm: 0, widthMm: 100,
    });
    expect(r.beforeVertices).toBe(8);
    expect(r.afterVertices).toBe(4);
  });
});

describe("simplifySvg adjacency preservation", () => {
  it("drops a shared collinear midpoint from both sides identically", () => {
    // Two squares meeting on the x=10 edge with a colinear midpoint
    // vertex on each side. The previous DP pipeline would either
    // drop or keep them inconsistently between the two shapes,
    // leaving slivers; the topology pipeline drops both at once.
    const svg = SVG(`
      <path d="M0 0 L10 0 L10 5 L10 10 L0 10 Z" fill="#abc"/>
      <path d="M10 0 L20 0 L20 10 L10 10 L10 5 Z" fill="#cba"/>
    `);
    const r = simplifySvg(svg, {
      minAreaMm2: 0, toleranceMm: 1, widthMm: 100,
    });
    const dAttrs = (r.svgText.match(/d="([^"]+)"/g) ?? []).map((m) => m.slice(3, -1));
    expect(dAttrs.length).toBe(2);
    for (const d of dAttrs) {
      // No "L10 5" remains in either shape.
      expect(/L\s*10\s+5(?![0-9])/.test(d)).toBe(false);
    }
  });

  it("preserves curved paths inside a multi-shape SVG (curves shouldn't be touched)", () => {
    const svg = SVG(`
      <path d="M0 0 L10 0 L10 5 L10 10 L0 10 Z" fill="#abc"/>
      <path d="M20 20 C 30 20 40 30 50 30" fill="none" stroke="#000"/>
    `);
    const r = simplifySvg(svg, {
      minAreaMm2: 0, toleranceMm: 1, widthMm: 100,
    });
    expect(r.svgText).toContain("M20 20 C 30 20 40 30 50 30");
  });

  it("keeps a triangle's 3 corners when tolerance is well under its edge length", () => {
    // Small isolated triangle — V-W must not collapse it to <3 verts.
    const svg = SVG(`<polygon points="0,0 10,0 5,10" fill="#000"/>`);
    const r = simplifySvg(svg, {
      minAreaMm2: 0, toleranceMm: 0.5, widthMm: 100,
    });
    expect(r.afterShapes).toBe(1);
    const points = r.svgText.match(/points="([^"]+)"/)![1];
    const coords = points.trim().split(/\s+/);
    expect(coords.length).toBe(3);
  });
});
