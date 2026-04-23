// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { mergeColorsInSvg, type MergeGroup } from "./mergeColors";

const wrap = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`;

function extractFills(svg: string): string[] {
  const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
  return [...dom.querySelectorAll<SVGElement>("*")]
    .map((el) => el.getAttribute("fill"))
    .filter((f): f is string => f !== null);
}

describe("mergeColorsInSvg", () => {
  test("rewrites fill attribute matching a source color", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000", "#fb0002"], representativeColor: "#ff0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect fill="#ff0000"/><rect fill="#fb0002"/><rect fill="#00ff00"/>`),
      groups,
    );
    expect(extractFills(out)).toEqual(["#ff0000", "#ff0000", "#00ff00"]);
  });

  test("rewrites stroke attribute matching a source color", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#0000ff"], representativeColor: "#1111ff" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<path stroke="#0000ff" d="M0 0L1 1"/>`),
      groups,
    );
    const dom = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(dom.querySelector("path")!.getAttribute("stroke")).toBe("#1111ff");
  });

  test("rewrites inline style fill: declaration", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect style="fill: #ff0000; stroke: black"/>`),
      groups,
    );
    const dom = new DOMParser().parseFromString(out, "image/svg+xml");
    const style = dom.querySelector("rect")!.getAttribute("style") ?? "";
    expect(style).toMatch(/fill:\s*#aa0000/);
    expect(style).toMatch(/stroke:\s*black/);
  });

  test("normalises 3-digit hex to 6-digit before matching", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#ff0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect fill="#f00"/>`),
      groups,
    );
    expect(extractFills(out)).toEqual(["#ff0000"]);
  });

  test("leaves fill=none untouched", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect fill="none" stroke="#ff0000"/>`),
      groups,
    );
    const dom = new DOMParser().parseFromString(out, "image/svg+xml");
    const rect = dom.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("none");
    expect(rect.getAttribute("stroke")).toBe("#aa0000");
  });

  test("leaves currentColor and url(#...) untouched", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<rect fill="currentColor"/><rect fill="url(#grad)"/>`),
      groups,
    );
    expect(extractFills(out)).toEqual(["currentColor", "url(#grad)"]);
  });

  test("rewrites colour on a <g> ancestor too (inherited fill)", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<g fill="#ff0000"><rect/></g>`),
      groups,
    );
    const dom = new DOMParser().parseFromString(out, "image/svg+xml");
    expect(dom.querySelector("g")!.getAttribute("fill")).toBe("#aa0000");
  });

  test("preserves <defs> content untouched", () => {
    const groups: MergeGroup[] = [
      { sourceColors: ["#ff0000"], representativeColor: "#aa0000" },
    ];
    const out = mergeColorsInSvg(
      wrap(`<defs><linearGradient id="g"><stop stop-color="#ff0000"/></linearGradient></defs><rect fill="#ff0000"/>`),
      groups,
    );
    // Rect's fill rewrites; the <stop> uses stop-color not fill/stroke so it stays.
    expect(out).toContain('stop-color="#ff0000"');
    expect(out).toContain('fill="#aa0000"');
  });

  test("returns original SVG unchanged when groups is empty", () => {
    const input = wrap(`<rect fill="#ff0000"/>`);
    const out = mergeColorsInSvg(input, []);
    expect(extractFills(out)).toEqual(["#ff0000"]);
  });

  test("throws on malformed SVG", () => {
    expect(() => mergeColorsInSvg("<svg><not-closed>", [])).toThrow();
  });
});
