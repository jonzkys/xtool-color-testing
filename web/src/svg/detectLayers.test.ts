// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { countShapeVertices, detectSvgLayers } from "./detectLayers";

const SVG = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${body}</svg>`;

function elementFromSvg(body: string): Element {
  const doc = new DOMParser().parseFromString(SVG(body), "image/svg+xml");
  const child = doc.documentElement.firstElementChild;
  if (!child) throw new Error("no child");
  return child;
}

describe("countShapeVertices", () => {
  it("counts 4 for a rect", () => {
    expect(countShapeVertices(elementFromSvg(`<rect width="10" height="10"/>`))).toBe(4);
  });

  it("counts 2 for a line", () => {
    expect(
      countShapeVertices(elementFromSvg(`<line x1="0" y1="0" x2="10" y2="10"/>`)),
    ).toBe(2);
  });

  it("counts 1 for circle and ellipse (continuous curves, no discrete vertices)", () => {
    expect(countShapeVertices(elementFromSvg(`<circle r="5"/>`))).toBe(1);
    expect(countShapeVertices(elementFromSvg(`<ellipse rx="5" ry="3"/>`))).toBe(1);
  });

  it("counts the listed points on polyline / polygon", () => {
    expect(
      countShapeVertices(
        elementFromSvg(`<polyline points="0,0 10,0 10,10 0,10"/>`),
      ),
    ).toBe(4);
    expect(
      countShapeVertices(
        elementFromSvg(`<polygon points="0,0 10,0 10,10 0,10"/>`),
      ),
    ).toBe(4);
  });

  it("counts move-to and line-to commands on a path", () => {
    // M(1) + L(1) + L(1) + L(1) = 4 vertices, Z doesn't add one
    expect(
      countShapeVertices(elementFromSvg(`<path d="M0 0 L10 0 L10 10 L0 10 Z"/>`)),
    ).toBe(4);
  });

  it("counts implicit repeats after a single L command", () => {
    // M0 0  then L with 3 implicit pairs (10,0 / 10,10 / 0,10) = 1 + 3 = 4
    expect(
      countShapeVertices(elementFromSvg(`<path d="M0 0 L10 0 10 10 0 10 Z"/>`)),
    ).toBe(4);
  });

  it("counts each cubic bezier endpoint once on a curved path", () => {
    // M(1) + C(1 endpoint) + C(1 endpoint) = 3
    expect(
      countShapeVertices(
        elementFromSvg(
          `<path d="M0 0 C 5 0 10 5 10 10 C 10 15 5 20 0 20"/>`,
        ),
      ),
    ).toBe(3);
  });

  it("counts H and V as single-vertex commands", () => {
    // M(1) + H(1) + V(1) + H(1) + V(1) = 5
    expect(
      countShapeVertices(elementFromSvg(`<path d="M0 0 H10 V10 H0 V0"/>`)),
    ).toBe(5);
  });

  it("counts arc endpoints", () => {
    // M(1) + A(1 endpoint) = 2
    expect(
      countShapeVertices(
        elementFromSvg(`<path d="M0 0 A 5 5 0 0 1 10 0"/>`),
      ),
    ).toBe(2);
  });
});

describe("detectSvgLayers vertex_count", () => {
  // jsdom doesn't surface SVG fill="..." presentation attributes through
  // getComputedStyle, so the tests use ``style="fill:..."`` (which jsdom
  // does resolve) to exercise the colour-grouping path.
  it("aggregates vertex_count per colour", () => {
    const layers = detectSvgLayers(
      SVG(`
        <rect width="10" height="10" style="fill:#ff0000"/>
        <rect width="20" height="20" style="fill:#ff0000"/>
        <path d="M0 0 L10 0 L10 10 Z" style="fill:#00ff00"/>
      `),
    );
    const red = layers.find((l) => l.color === "#ff0000");
    const green = layers.find((l) => l.color === "#00ff00");
    expect(red?.vertex_count).toBe(8); // 4 + 4
    expect(green?.vertex_count).toBe(3);
  });
});
