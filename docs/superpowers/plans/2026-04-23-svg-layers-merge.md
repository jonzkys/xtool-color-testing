# SVG Layers Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two layer-count reduction features to the SVG Layers page — post-detection color-similarity merge with modal preview, and pre-generate collapse of layers with byte-identical laser parameters.

**Architecture:** Browser-only. One shared module (`web/src/svg/mergeColors.ts`) exports three pure helpers — `mergeColorsInSvg`, `computeColorMergeGroups`, `computeParamMergeGroups` — used by both features. Feature A opens a modal, rewrites the SVG, and re-runs existing `detectSvgLayers`. Feature B is a last-mile transform inside `handleGenerate`. No backend/schema changes.

**Tech Stack:** React 18, TypeScript, Vitest + jsdom (already a devDep), Radix Dialog primitive, lucide-react icons, existing `color/math.ts` for `hexToLab` + `deltaE2000`.

---

## File Structure

**New files:**
- `web/src/svg/color.ts` — `NAMED_COLORS` + `normalizeColor` (extracted from `SvgLayersPage.tsx`). Shared with `mergeColors.ts`.
- `web/src/svg/mergeColors.ts` — `MergeGroup` type, `mergeColorsInSvg`, `computeColorMergeGroups`, `computeParamMergeGroups`.
- `web/src/svg/mergeColors.test.ts` — Vitest suite covering all three helpers.
- `web/src/components/MergeColorsDialog.tsx` — the modal: similarity slider + live group preview + promote-on-click + Confirm/Cancel.

**Modified files:**
- `web/src/components/SvgLayersPage.tsx` — remove local `NAMED_COLORS`/`normalizeColor`; add Feature A and B state + UI + handlers.

---

## Task 1: Extract color normalization to shared module

**Files:**
- Create: `web/src/svg/color.ts`
- Modify: `web/src/components/SvgLayersPage.tsx` (remove lines 1314-1339 block, add import)

Pure refactor — no behavior change. Isolates the refactor so later commits are small.

- [ ] **Step 1: Create the shared color module**

Write `web/src/svg/color.ts`:

```ts
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
```

- [ ] **Step 2: Update SvgLayersPage to import the shared function**

Delete lines 1314-1339 from `web/src/components/SvgLayersPage.tsx` (the `NAMED_COLORS` const and `normalizeColor` function at the bottom of the file).

Add this import alongside the existing `../color/math` import near the top (around line 37):

```ts
import { normalizeColor } from "../svg/color";
```

- [ ] **Step 3: Verify the build and existing tests pass**

Run: `cd web && npm run build && npm test`
Expected: build succeeds (TypeScript clean); all existing Vitest suites pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/svg/color.ts web/src/components/SvgLayersPage.tsx
git commit -m "Extract normalizeColor into shared svg/color module"
```

---

## Task 2: Add `mergeColorsInSvg` (TDD)

**Files:**
- Create: `web/src/svg/mergeColors.test.ts`
- Create: `web/src/svg/mergeColors.ts`

- [ ] **Step 1: Write the failing test file**

Write `web/src/svg/mergeColors.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `cd web && npx vitest run src/svg/mergeColors.test.ts`
Expected: FAIL — "Cannot find module './mergeColors'" or equivalent.

- [ ] **Step 3: Implement `mergeColorsInSvg`**

Write `web/src/svg/mergeColors.ts`:

```ts
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
  if (groups.length === 0) return svgText;

  // Lookup: normalized source hex -> representative hex.
  const lookup = new Map<string, string>();
  for (const g of groups) {
    for (const src of g.sourceColors) {
      lookup.set(normalizeColor(src), g.representativeColor);
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    throw new Error(`Failed to parse SVG: ${err.textContent ?? "unknown"}`);
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
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `cd web && npx vitest run src/svg/mergeColors.test.ts`
Expected: PASS — all 10 test cases green.

- [ ] **Step 5: Commit**

```bash
git add web/src/svg/mergeColors.ts web/src/svg/mergeColors.test.ts
git commit -m "Add mergeColorsInSvg browser-side DOM rewriter"
```

---

## Task 3: Add `computeColorMergeGroups` (TDD)

**Files:**
- Modify: `web/src/svg/mergeColors.test.ts` (append new describe block)
- Modify: `web/src/svg/mergeColors.ts` (append new export)

- [ ] **Step 1: Append failing tests**

Append to `web/src/svg/mergeColors.test.ts`:

```ts
import {
  computeColorMergeGroups,
} from "./mergeColors";
import type { LayerSpec } from "../types";

function layerWithColor(color: string): LayerSpec {
  return {
    color,
    name: color,
    enabled: true,
    processing_type: "VECTOR_ENGRAVING",
    scan_angle: 90,
    base_params: {
      laser: "red",
      power: 50, speed: 100, frequency: 20000,
      density: 40, passes: 1, pulse_width: 100,
    },
    angle_mode: "fixed",
    material_id: null,
    hatch_passes: [],
  };
}

describe("computeColorMergeGroups", () => {
  test("single cluster when all colours are within threshold", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
      layerWithColor("#f60404"),
    ];
    const counts = { "#ff0000": 100, "#fb0002": 50, "#f60404": 25 };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceColors).toEqual(
      expect.arrayContaining(["#ff0000", "#fb0002", "#f60404"]),
    );
    // Dominant (highest shape_count) becomes the representative.
    expect(groups[0].representativeColor).toBe("#ff0000");
  });

  test("multiple clusters for distinct colour families", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
      layerWithColor("#0000ff"),
      layerWithColor("#0404fb"),
    ];
    const counts = {
      "#ff0000": 200, "#fb0002": 50, "#0000ff": 180, "#0404fb": 40,
    };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups).toHaveLength(2);
    const reps = groups.map((g) => g.representativeColor).sort();
    expect(reps).toEqual(["#0000ff", "#ff0000"]);
  });

  test("no groups when every colour is beyond threshold", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#00ff00"),
      layerWithColor("#0000ff"),
    ];
    const counts = { "#ff0000": 10, "#00ff00": 10, "#0000ff": 10 };
    // ΔE between primaries is way beyond 5.
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups).toHaveLength(0);
  });

  test("singleton layers omitted from output", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
      layerWithColor("#00ff00"),
    ];
    const counts = { "#ff0000": 100, "#fb0002": 50, "#00ff00": 80 };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceColors).not.toContain("#00ff00");
  });

  test("dominant-first seeding: biggest shape_count becomes rep", () => {
    // Both reds within threshold but #fb0002 has more shapes.
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
    ];
    const counts = { "#ff0000": 20, "#fb0002": 500 };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups[0].representativeColor).toBe("#fb0002");
  });

  test("missing shape count treated as zero (not dominant)", () => {
    const layers = [
      layerWithColor("#ff0000"),
      layerWithColor("#fb0002"),
    ];
    // #ff0000 has a count, #fb0002 missing entirely -> falls back to 0.
    const counts = { "#ff0000": 10 };
    const groups = computeColorMergeGroups(layers, counts, 5);
    expect(groups[0].representativeColor).toBe("#ff0000");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd web && npx vitest run src/svg/mergeColors.test.ts`
Expected: FAIL — "computeColorMergeGroups is not exported" or equivalent.

- [ ] **Step 3: Implement `computeColorMergeGroups`**

Append to `web/src/svg/mergeColors.ts`:

```ts
import { deltaE2000, hexToLab, type Lab } from "../color/math";
import type { LayerSpec } from "../types";

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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd web && npx vitest run src/svg/mergeColors.test.ts`
Expected: PASS — all earlier tests plus the six new clustering tests green.

- [ ] **Step 5: Commit**

```bash
git add web/src/svg/mergeColors.ts web/src/svg/mergeColors.test.ts
git commit -m "Add computeColorMergeGroups dominant-first clustering"
```

---

## Task 4: Add `computeParamMergeGroups` (TDD)

**Files:**
- Modify: `web/src/svg/mergeColors.test.ts` (append)
- Modify: `web/src/svg/mergeColors.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `web/src/svg/mergeColors.test.ts`:

```ts
import { computeParamMergeGroups } from "./mergeColors";
import { defaultHatchPass } from "../defaults";

function baseParamsOf(overrides: Partial<LayerSpec["base_params"]> = {}): LayerSpec["base_params"] {
  return {
    laser: "red",
    power: 50, speed: 100, frequency: 20000,
    density: 40, passes: 1, pulse_width: 100,
    ...overrides,
  };
}

function layer(overrides: Partial<LayerSpec> = {}): LayerSpec {
  return {
    color: "#ff0000",
    name: "layer",
    enabled: true,
    processing_type: "VECTOR_ENGRAVING",
    scan_angle: 90,
    base_params: baseParamsOf(),
    angle_mode: "fixed",
    material_id: null,
    hatch_passes: [],
    ...overrides,
  };
}

describe("computeParamMergeGroups", () => {
  test("identical enabled layers collapse into one group", () => {
    const layers = [
      layer({ color: "#ff0000" }),
      layer({ color: "#fb0002" }),
      layer({ color: "#00ff00" }),
    ];
    // #ff0000 and #fb0002 have identical params; #00ff00 differs only by color (still same params!) -> all three collapse.
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((l) => l.color).sort()).toEqual(
      ["#00ff00", "#fb0002", "#ff0000"],
    );
  });

  test("different scan_angle prevents collapse for non-hatched", () => {
    const layers = [
      layer({ color: "#ff0000", scan_angle: 90 }),
      layer({ color: "#fb0002", scan_angle: 45 }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(0);
  });

  test("different angle_mode prevents collapse for non-hatched", () => {
    const layers = [
      layer({ color: "#ff0000", angle_mode: "fixed" }),
      layer({ color: "#fb0002", angle_mode: "crosshatch" }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(0);
  });

  test("scan_angle and angle_mode ignored for HATCHED_LINES", () => {
    const layers = [
      layer({
        color: "#ff0000",
        processing_type: "HATCHED_LINES",
        scan_angle: 90,
        angle_mode: "fixed",
        hatch_passes: [defaultHatchPass(0)],
      }),
      layer({
        color: "#fb0002",
        processing_type: "HATCHED_LINES",
        scan_angle: 45,          // Differs, but ignored for hatched.
        angle_mode: "crosshatch",// Differs, but ignored for hatched.
        hatch_passes: [defaultHatchPass(0)],
      }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(1);
  });

  test("different hatch_passes prevents collapse for HATCHED_LINES", () => {
    const layers = [
      layer({
        color: "#ff0000",
        processing_type: "HATCHED_LINES",
        hatch_passes: [defaultHatchPass(0)],
      }),
      layer({
        color: "#fb0002",
        processing_type: "HATCHED_LINES",
        hatch_passes: [defaultHatchPass(0), defaultHatchPass(90)],
      }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(0);
  });

  test("different base params (power) prevents collapse", () => {
    const layers = [
      layer({ color: "#ff0000", base_params: baseParamsOf({ power: 50 }) }),
      layer({ color: "#fb0002", base_params: baseParamsOf({ power: 60 }) }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(0);
  });

  test("disabled layers excluded from grouping", () => {
    const layers = [
      layer({ color: "#ff0000", enabled: true }),
      layer({ color: "#fb0002", enabled: false }),
      layer({ color: "#f60404", enabled: true }),
    ];
    const groups = computeParamMergeGroups(layers);
    // Two enabled layers with identical params -> one group of two.
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0].map((l) => l.color).sort()).toEqual(["#f60404", "#ff0000"]);
  });

  test("material_id and name do not affect grouping", () => {
    const layers = [
      layer({ color: "#ff0000", name: "alpha", material_id: "1" }),
      layer({ color: "#fb0002", name: "beta",  material_id: "2" }),
    ];
    const groups = computeParamMergeGroups(layers);
    expect(groups).toHaveLength(1);
  });

  test("representatives preserve request-list order", () => {
    const layers = [
      layer({ color: "#00ff00" }),  // index 0
      layer({ color: "#ff0000" }),  // index 1
      layer({ color: "#fb0002" }),  // index 2 — same params as #ff0000
    ];
    const groups = computeParamMergeGroups(layers);
    // First-occurrence rep = #00ff00 (appears first) since all three match.
    expect(groups[0][0].color).toBe("#00ff00");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd web && npx vitest run src/svg/mergeColors.test.ts`
Expected: FAIL — "computeParamMergeGroups is not exported" or equivalent.

- [ ] **Step 3: Implement `computeParamMergeGroups`**

Append to `web/src/svg/mergeColors.ts`:

```ts
/**
 * Group enabled layers by byte-identical laser parameters. Returns one
 * array per group of ≥2 layers; singletons are omitted. Within each
 * group, layers retain their original order in the input array (the
 * first member is the natural representative).
 *
 * The canonical key excludes ``color``, ``name``, ``enabled``, and
 * ``material_id`` (the last is provenance, not behaviour). For
 * ``HATCHED_LINES`` layers, ``scan_angle`` and ``angle_mode`` are
 * excluded because they're semantically unused by the XCS pipeline;
 * ``hatch_passes`` (order-sensitive) is included. For non-hatched
 * layers, ``hatch_passes`` is excluded and scan_angle/angle_mode are
 * included.
 */
export function computeParamMergeGroups(layers: LayerSpec[]): LayerSpec[][] {
  const buckets = new Map<string, LayerSpec[]>();
  for (const layer of layers) {
    if (!layer.enabled) continue;
    const key = JSON.stringify(canonicalKey(layer));
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(layer);
    } else {
      buckets.set(key, [layer]);
    }
  }
  return [...buckets.values()].filter((g) => g.length >= 2);
}

function canonicalKey(l: LayerSpec) {
  const p = l.base_params;
  const base = {
    processing_type: l.processing_type,
    laser: p.laser,
    power: p.power,
    speed: p.speed,
    frequency: p.frequency,
    density: p.density,
    passes: p.passes,
    pulse_width: p.pulse_width,
  };
  if (l.processing_type === "HATCHED_LINES") {
    return { ...base, hatch_passes: l.hatch_passes };
  }
  return { ...base, scan_angle: l.scan_angle, angle_mode: l.angle_mode };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd web && npx vitest run src/svg/mergeColors.test.ts`
Expected: PASS — all prior tests plus the nine new param-grouping tests green.

- [ ] **Step 5: Commit**

```bash
git add web/src/svg/mergeColors.ts web/src/svg/mergeColors.test.ts
git commit -m "Add computeParamMergeGroups for pre-generate collapse"
```

---

## Task 5: Build `MergeColorsDialog` component

**Files:**
- Create: `web/src/components/MergeColorsDialog.tsx`

No tests — this is a UI-only component and the project has no existing React component test infrastructure; manual QA happens in Task 6 wiring.

- [ ] **Step 1: Create the component**

Write `web/src/components/MergeColorsDialog.tsx`:

```tsx
import { useDeferredValue, useMemo, useState } from "react";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui";
import { deltaE2000, hexToLab, type Lab } from "../color/math";
import type { LayerSpec } from "../types";
import {
  computeColorMergeGroups,
  type MergeGroup,
} from "../svg/mergeColors";

// Slider range: 80% = ΔE 10, 100% = ΔE 0. Inverse of the existing
// ``deltaEToPercent`` helper in SvgLayersPage (``100 - dE*2`` clamped).
const MIN_PERCENT = 80;
const MAX_PERCENT = 100;
const DEFAULT_PERCENT = 95;

function percentToDeltaE(pct: number): number {
  return Math.max(0, (100 - pct) / 2);
}

export interface MergeColorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layers: LayerSpec[];
  shapeCountsByColor: Record<string, number>;
  onConfirm: (groups: MergeGroup[]) => void;
}

export function MergeColorsDialog({
  open,
  onOpenChange,
  layers,
  shapeCountsByColor,
  onConfirm,
}: MergeColorsDialogProps) {
  const [percent, setPercent] = useState(DEFAULT_PERCENT);
  // ``overrides`` lets the user click a source swatch to promote it as
  // representative — key is the cluster's default representativeColor.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const deferredPercent = useDeferredValue(percent);

  const threshold = percentToDeltaE(deferredPercent);
  const autoGroups = useMemo(
    () => computeColorMergeGroups(layers, shapeCountsByColor, threshold),
    [layers, shapeCountsByColor, threshold],
  );
  const groups = useMemo<MergeGroup[]>(
    () =>
      autoGroups.map((g) => ({
        ...g,
        representativeColor: overrides[g.representativeColor] ?? g.representativeColor,
      })),
    [autoGroups, overrides],
  );

  const totalSources = groups.reduce((n, g) => n + g.sourceColors.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg">
        <DialogHeader>
          <DialogTitle>Merge similar colors</DialogTitle>
        </DialogHeader>

        <div className="flex items-baseline justify-between mb-1">
          <label
            htmlFor="merge-threshold"
            className="text-[12px] text-[color:var(--color-ink-muted)]"
          >
            Similarity threshold
          </label>
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold text-[color:var(--color-ink)]">
              {percent}% match
            </span>
            <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
              ΔE {percentToDeltaE(percent).toFixed(1)}
            </span>
          </div>
        </div>
        <input
          id="merge-threshold"
          type="range"
          min={MIN_PERCENT}
          max={MAX_PERCENT}
          step={1}
          value={percent}
          onChange={(e) => setPercent(parseInt(e.target.value, 10))}
          className="w-full accent-[color:var(--color-primary)]"
        />
        <div className="flex justify-between text-[10px] text-[color:var(--color-ink-subtle)] mb-4">
          <span>{MIN_PERCENT}%</span>
          <span>{MAX_PERCENT}%</span>
        </div>

        <div className="max-h-[50vh] overflow-auto flex flex-col gap-2">
          {groups.length === 0 && (
            <p className="text-[12.5px] text-[color:var(--color-ink-subtle)] py-4 text-center">
              No colours within {percent}% similarity. Drag the slider
              left to find looser matches.
            </p>
          )}
          {groups.map((g) => {
            const shapeTotal = g.sourceColors.reduce(
              (n, c) => n + (shapeCountsByColor[c] ?? 0),
              0,
            );
            const maxDeltaE = maxDeltaEInGroup(g);
            return (
              <div
                key={g.sourceColors.join("|")}
                className={cn(
                  "rounded-[8px] border border-[color:var(--color-border)]",
                  "bg-[color:var(--color-surface-elevated)] p-3",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {g.sourceColors.map((src) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() =>
                          setOverrides((prev) => ({
                            ...prev,
                            [autoRepFor(autoGroups, g)]: src,
                          }))
                        }
                        title={`Promote ${src} as representative`}
                        className={cn(
                          "h-6 w-6 rounded-[4px] border",
                          src === g.representativeColor
                            ? "border-[color:var(--color-primary)]/60 ring-1 ring-[color:var(--color-primary)]/30"
                            : "border-[color:var(--color-border-strong)] hover:border-[color:var(--color-primary)]",
                        )}
                        style={{ background: src }}
                        aria-label={`Source colour ${src}`}
                      />
                    ))}
                  </div>
                  <div className="text-[color:var(--color-ink-subtle)] text-[14px] shrink-0">→</div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div
                      className="h-9 w-9 rounded-[6px] border border-[color:var(--color-primary)]/30 ring-1 ring-[color:var(--color-primary)]/20"
                      style={{ background: g.representativeColor }}
                      aria-hidden="true"
                    />
                    <span className="font-mono text-[11px] text-[color:var(--color-ink)]">
                      {g.representativeColor}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-[color:var(--color-ink-subtle)]">
                  {g.sourceColors.length} colors · {shapeTotal.toLocaleString()} shapes · ΔE ≤ {maxDeltaE.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={groups.length === 0}
            onClick={() => {
              onConfirm(groups);
              setOverrides({});
            }}
          >
            Merge {totalSources} colors → {groups.length}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The override key is the ORIGINAL dominant representative so that
// promoting swaps even after the user drags the slider.
function autoRepFor(
  autoGroups: MergeGroup[],
  current: MergeGroup,
): string {
  const match = autoGroups.find((g) =>
    g.sourceColors.every((c) => current.sourceColors.includes(c)) &&
    g.sourceColors.length === current.sourceColors.length,
  );
  return match?.representativeColor ?? current.representativeColor;
}

function maxDeltaEInGroup(g: MergeGroup): number {
  const repLab = /^#[0-9a-fA-F]{6}$/.test(g.representativeColor)
    ? hexToLab(g.representativeColor)
    : null;
  if (!repLab) return 0;
  let max = 0;
  for (const src of g.sourceColors) {
    if (src === g.representativeColor) continue;
    if (!/^#[0-9a-fA-F]{6}$/.test(src)) continue;
    const d = deltaE2000(repLab as Lab, hexToLab(src) as Lab);
    if (d > max) max = d;
  }
  return max;
}
```

- [ ] **Step 2: Verify the build succeeds**

Run: `cd web && npm run build`
Expected: TypeScript + Vite build succeed with no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/MergeColorsDialog.tsx
git commit -m "Add MergeColorsDialog with live similarity preview"
```

---

## Task 6: Wire Feature A (merge flow) into SvgLayersPage

**Files:**
- Modify: `web/src/components/SvgLayersPage.tsx`

- [ ] **Step 1: Add imports**

In `web/src/components/SvgLayersPage.tsx`, add `Combine` to the lucide import (around line 3-10) and add two new imports after the existing `import { MergeColorsDialog }`-adjacent imports (pick a sensible spot near the other component imports around line 35):

```ts
import { Combine } from "lucide-react";  // add to existing lucide-react import list
```

```ts
import { MergeColorsDialog } from "./MergeColorsDialog";
import type { MergeGroup } from "../svg/mergeColors";
import { mergeColorsInSvg } from "../svg/mergeColors";
```

Also ensure `Badge` is imported from `../ui` — check the existing `../ui` import block (around lines 39-52) and add `Badge` if missing.

- [ ] **Step 2: Add new state inside the component**

After the existing `const [rawDetected, setRawDetected] = useState<DetectedLayer[]>([]);` near line 129:

```ts
const [originalSvgContent, setOriginalSvgContent] = useState<string | null>(null);
const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
```

- [ ] **Step 3: Set `originalSvgContent` at upload and re-trace entry points (not at merge-driven re-detection)**

Inside `handleFile`, after reading the SVG text and just before calling `applyDetectedSvg`:

For the SVG branch (around line 349):
```ts
if (isSvg || !isRaster) {
  setRasterDataUrl(null);
  const text = await file.text();
  setOriginalSvgContent(text);            // <-- add this line
  await applyDetectedSvg(text, suggested);
  return;
}
```

For the raster branch (after `const svg = await traceImageToSvg(...)` around line 358):
```ts
const svg = await traceImageToSvg(dataUrl, traceOptions);
setOriginalSvgContent(svg);                // <-- add this line
await applyDetectedSvg(svg, suggested);
```

Inside `retrace`, after the successful trace (around line 372):
```ts
const svg = await traceImageToSvg(rasterDataUrl, opts);
setOriginalSvgContent(svg);                // <-- add this line
const currentName = request.name;
await applyDetectedSvg(svg, currentName);
```

Do NOT set `originalSvgContent` in the merge confirm handler (Step 5) — that's what makes reset work.

- [ ] **Step 4: Derive `shapeCountsByColor` from `rawDetected`**

After the existing `enabledColors` useMemo (around line 165), add:

```ts
const shapeCountsByColor = useMemo(() => {
  const out: Record<string, number> = {};
  for (const d of rawDetected) out[d.color] = d.shape_count;
  return out;
}, [rawDetected]);
```

- [ ] **Step 5: Add the merge-confirm handler and reset handler**

Below `autoMatchAllLayers` (around line 301), before `applyDetectedSvg`:

```ts
async function handleMergeConfirm(groups: MergeGroup[]) {
  setMergeDialogOpen(false);
  if (groups.length === 0) return;
  try {
    const merged = mergeColorsInSvg(request.svg_content, groups);
    await applyDetectedSvg(merged, request.name);
  } catch (err) {
    setDetectError((err as Error).message);
  }
}

async function handleResetMerges() {
  if (!originalSvgContent) return;
  await applyDetectedSvg(originalSvgContent, request.name);
}
```

- [ ] **Step 6: Add the Combine action and merged badge inside the Layers `<Section>`**

Locate the existing `<Section title={...} description={...} dense>` for Layers (around line 604-611). Replace its title/description props with a JSX title that includes a trailing Reset badge, and move the existing "Auto-match" button into the Section's `actions` prop along with the new Combine button. Here's the full replacement:

```tsx
<Section
  title={
    <span className="inline-flex items-center gap-2">
      <span>Layers{hasLayers ? ` (${request.layers.length})` : ""}</span>
      {originalSvgContent !== null &&
        originalSvgContent !== request.svg_content && (
          <button
            type="button"
            onClick={handleResetMerges}
            title="Reset to detected layers"
          >
            <Badge variant="accent" size="sm">merged · reset</Badge>
          </button>
        )}
    </span>
  }
  description={
    hasLayers
      ? "Top = drawn on top. Subtraction removes lower layers where upper ones cover."
      : undefined
  }
  actions={
    hasLayers && request.layers.length >= 2 ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setMergeDialogOpen(true)}
        title="Merge colors that are within a similarity threshold"
      >
        <Combine className="h-4 w-4" />
        Merge similar…
      </Button>
    ) : undefined
  }
  dense
>
  {/* existing body: auto-match button, messages, list — unchanged */}
</Section>
```

The existing body inside `<Section>` (auto-match button, near-white filter checkbox, layers `<ul>`) stays exactly as-is.

- [ ] **Step 7: Render the dialog at the bottom of the returned JSX**

Just before the closing `</PageContainer>` tag (around line 829), add:

```tsx
<MergeColorsDialog
  open={mergeDialogOpen}
  onOpenChange={setMergeDialogOpen}
  layers={request.layers}
  shapeCountsByColor={shapeCountsByColor}
  onConfirm={handleMergeConfirm}
/>
```

- [ ] **Step 8: Build and run the dev flow to verify**

Run: `cd web && npm run build`
Expected: clean TypeScript + Vite build.

Then manually verify:
```bash
cd web && npm run dev
```
Load an SVG with several near-identical reds. Click **Merge similar…** → slider at 95% shows at least one group → click a non-rep swatch and see the rep update → click **Merge N → M** → layer count shrinks → `merged · reset` badge appears next to the Layers count → click the badge → layers restore to the original count.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/SvgLayersPage.tsx
git commit -m "SVG Layers: merge similar colors via modal preview"
```

---

## Task 7: Wire Feature B (collapse identical params) and rebuild dist

**Files:**
- Modify: `web/src/components/SvgLayersPage.tsx`
- Modify: `web/dist/**` (from build output)

- [ ] **Step 1: Add new state and param-group derivation**

In `web/src/components/SvgLayersPage.tsx`, add a new import near the other `mergeColors` imports:

```ts
import { computeParamMergeGroups } from "../svg/mergeColors";
```

Add state below the Feature A additions from Task 6:

```ts
const [collapseIdenticalLayers, setCollapseIdenticalLayers] = useState(true);
```

After `enabledColors` / `shapeCountsByColor`, add:

```ts
const paramGroups = useMemo(
  () => (collapseIdenticalLayers ? computeParamMergeGroups(request.layers) : []),
  [collapseIdenticalLayers, request.layers],
);
const collapseBefore = paramGroups.reduce((n, g) => n + g.length, 0);
const collapseAfter = paramGroups.length;
```

- [ ] **Step 2: Add the collapse checkbox inside the Project `<Section>`**

Locate the existing `<Section title="Project" dense>` (around line 701). Inside its body, place the new checkbox row **above** the existing `Subtract overlaps` label. Add this block right after the `grid grid-cols-2` block that holds Width/Height inputs:

```tsx
<label className="flex items-start justify-between gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
  <div className="flex items-start gap-2">
    <input
      type="checkbox"
      checked={collapseIdenticalLayers}
      onChange={(e) => setCollapseIdenticalLayers(e.target.checked)}
      className="mt-0.5"
    />
    <span>
      Collapse identical layers
      <span className="block text-[11px] text-[color:var(--color-ink-subtle)]">
        Layers with the same params merge into one output.
      </span>
    </span>
  </div>
  {collapseBefore > 0 && collapseAfter > 0 && (
    <Badge variant="accent" size="sm">{collapseBefore}→{collapseAfter}</Badge>
  )}
</label>
```

- [ ] **Step 3: Transform the request inside `handleGenerate`**

Replace the body of `handleGenerate` (around line 407-417):

```tsx
async function handleGenerate() {
  setErrorMessage(undefined);
  setGenerating(true);
  try {
    await svgLayersAndDownload(buildGenerateRequest());
  } catch (err) {
    setErrorMessage((err as Error).message);
  } finally {
    setGenerating(false);
  }
}

function buildGenerateRequest(): SvgLayersRequest {
  if (!collapseIdenticalLayers) return request;
  const groups = computeParamMergeGroups(request.layers.filter((l) => l.enabled));
  if (groups.length === 0) return request;

  const mergeGroups: MergeGroup[] = groups.map((members) => ({
    sourceColors: members.map((m) => m.color),
    representativeColor: members[0].color,
  }));
  const representatives = new Set(mergeGroups.map((g) => g.representativeColor));
  const loserColors = new Set(
    mergeGroups.flatMap((g) => g.sourceColors.filter((c) => c !== g.representativeColor)),
  );

  const collapsedSvg = mergeColorsInSvg(request.svg_content, mergeGroups);
  const collapsedLayers = request.layers.filter(
    (l) => !loserColors.has(l.color) || representatives.has(l.color),
  );
  return { ...request, svg_content: collapsedSvg, layers: collapsedLayers };
}
```

- [ ] **Step 4: Build and verify**

Run: `cd web && npm run build && npm test`
Expected: clean TS + Vite build; all tests pass.

Manually verify: load an SVG with several colours, run **Auto-match all layers to palette** so several layers end up with identical params from the palette, watch the `[N→M]` badge appear next to **Collapse identical layers**. Toggle off and on — badge appears/disappears. Generate — the `.xcs` downloads; open it (or use `xcs-gen` CLI) and confirm merged layers produced a single toolpath.

- [ ] **Step 5: Rebuild `web/dist` (per the project memory note)**

Run: `cd web && npm run build`

Verify the dist artifacts updated:

```bash
git status web/dist | head
```

Expected: modified JS chunks reflecting the new code.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SvgLayersPage.tsx web/dist
git commit -m "SVG Layers: collapse identical-param layers on generate"
```

---

## Self-review notes

All four spec features have tasks: extraction (Task 1), `mergeColorsInSvg` (Task 2), `computeColorMergeGroups` (Task 3), `computeParamMergeGroups` (Task 4), dialog component (Task 5), Feature A wiring (Task 6), Feature B wiring (Task 7). No TBDs, no "implement later" phrases, no references to symbols that aren't defined within the plan. Types `MergeGroup` and function names (`mergeColorsInSvg`, `computeColorMergeGroups`, `computeParamMergeGroups`, `handleMergeConfirm`, `handleResetMerges`, `buildGenerateRequest`) are consistent across tasks. `web/dist` rebuild is explicit per the user's memory note.
