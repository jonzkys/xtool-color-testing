# Forge Incise-Only Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Forge convert an incise-only `.xcs` (no emboss) into a smart cut, fix the layer taxonomy / phantom-object / calibration bugs that surfaced, and verify every black island (incl. `test-text.xcs`'s disjoint circles) is cut.

**Architecture:** Client-side only (`web/src/lib/forge/` + `web/src/pages/ForgePage.tsx`, no backend). Narrow the emboss class to `RELIEF`, add a `score` class, skip phantom device-map entries at parse, derive cut-`targets` + `preserved` layers, replace the buggy perimeter calibration with the display's true `scale`, lift the UI emboss gate, and relabel the panels.

**Tech Stack:** TypeScript, React, Vite, Vitest, `clipper-lib`. Run all commands from repo root unless noted. Frontend lives in `web/`.

**Spec:** `docs/superpowers/specs/2026-05-31-forge-incise-only-design.md`

**Conventions (from CLAUDE.md):**
- Frontend tests: `cd web && npm test` (Vitest). Typecheck: `cd web && npx tsc --noEmit`.
- After any `web/src/**` change, the served build is stale until `cd web && npm run build`. The final task rebuilds + does a real-browser check.
- Pre-commit hooks flag unused imports / schema drift — **do not** `--no-verify`.
- This work is on branch `feat/forge-incise-only` (already created off `main`).

---

## File Structure

**Modify:**
- `web/src/lib/forge/types.ts` — `XcsObject.modeClass` gains `"score"`; add `hasGeometry`; `ParsedXcs` gains `targets` + `preserved`.
- `web/src/lib/forge/xcs.ts` — narrow `EMBOSS_TYPES`, add `SCORE_TYPES`, export `classify`, skip phantom entries in `parseXcsFile`, derive `targets`/`preserved`, **rewrite** `calibrateMmPerUnit`, drop the now-unused `contourPerimeter` import, refresh stale emboss comments.
- `web/src/lib/forge/forge.worker.ts` — `parsed` response sends `targetIds` + `preservedIds` (was `embossIds`/`inciseIds`).
- `web/src/pages/ForgePage.tsx` — `State.ready` field rename, parsed-handler + auto-select, validation (remove emboss gate), idle copy, the two left-panel cards.
- `web/src/lib/forge/stages.ts`, `offset.ts` — comment-only cleanup of the "so the emboss is never engraved" rationale.

**Modify (tests):**
- `web/src/lib/forge/xcs.test.ts` — new `classify` unit test, incise-only `test-text.xcs` parse + calibration tests, update the perimeter calibration test to the scale value.
- `web/src/lib/forge/pipeline.test.ts` — incise-only run test asserting bands at both circle centroids.

**Create:**
- `changelog/2026-05-31-forge-incise-only.md` — minor changelog entry.

**Commit (existing untracked fixture):**
- `samples/xcs/test-text.xcs` — the canonical incise-only fixture (committed in Task 1).

---

## Task 1: Classification, phantom-skip, targets/preserved, fixture

**Files:**
- Modify: `web/src/lib/forge/types.ts`
- Modify: `web/src/lib/forge/xcs.ts:5-12, :55-89`
- Test: `web/src/lib/forge/xcs.test.ts`
- Commit fixture: `samples/xcs/test-text.xcs`

- [ ] **Step 1: Write the failing tests**

Add to `web/src/lib/forge/xcs.test.ts`. First extend the imports at the top (line 5-12) to include `classify`:

```ts
import {
  parseXcsFile,
  classify,
  findEmbossObjects,
  findInciseObjects,
  extractContourGeometry,
  calibrateMmPerUnit,
  contourToDPath,
} from "./xcs";
```

Then add a second sample loader after the existing `loadSample` (around line 18):

```ts
const TEXT_SAMPLE = resolve(__dirname, "../../../../samples/xcs/test-text.xcs");
function loadText(): ArrayBuffer {
  const b = readFileSync(TEXT_SAMPLE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
```

Then add these describe blocks (anywhere after the existing `parseXcsFile (real sample)` block):

```ts
describe("classify", () => {
  it("maps processingType tokens to the right mode class", () => {
    expect(classify("INTAGLIO")).toBe("incise");
    expect(classify("VECTOR_CUTTING")).toBe("incise");
    expect(classify("RELIEF")).toBe("emboss");
    expect(classify("VECTOR_ENGRAVING")).toBe("score");
    expect(classify("FILL_VECTOR_ENGRAVING")).toBe("score");
    expect(classify("COLOR_FILL_ENGRAVE")).toBe("score");
    expect(classify("SOMETHING_ELSE")).toBe("other");
    expect(classify(null)).toBe("other");
  });
});

describe("parseXcsFile (incise-only sample: test-text.xcs)", () => {
  it("yields exactly one geometry-bearing cut target and no emboss", () => {
    const parsed = parseXcsFile(loadText());
    expect(parsed.targets.length).toBe(1);
    expect(parsed.targets[0].processingType).toBe("INTAGLIO");
    expect(parsed.targets[0].hasGeometry).toBe(true);
    expect(parsed.emboss.length).toBe(0);
  });

  it("skips phantom device entries (no canvas display) entirely", () => {
    const parsed = parseXcsFile(loadText());
    // 7 device entries, but only 1 has a matching canvas display with geometry.
    expect(parsed.objects.length).toBe(1);
    expect(parsed.objects.every((o) => o.hasGeometry)).toBe(true);
    expect(parsed.preserved.length).toBe(0);
  });
});

describe("parseXcsFile (real sample: targets/preserved)", () => {
  it("splits the emboss+incise sample into one target and one preserved layer", () => {
    const parsed = parseXcsFile(loadSample());
    expect(parsed.targets.length).toBe(1);
    expect(parsed.targets[0].processingType).toBe("INTAGLIO");
    expect(parsed.preserved.length).toBe(1);
    expect(parsed.preserved[0].processingType).toBe("RELIEF");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts -t "classify|incise-only|targets/preserved"`
Expected: FAIL — `classify` is not exported; `parsed.targets` / `parsed.preserved` / `hasGeometry` are `undefined`; the `test-text.xcs` fixture loads but `parsed.objects.length` is 7, not 1.

- [ ] **Step 3: Update types in `web/src/lib/forge/types.ts`**

Change `XcsObject` (currently lines 107-116) to add the `score` class and `hasGeometry`:

```ts
/** One object detected inside the uploaded XCS. */
export interface XcsObject {
  id: string;
  type: string; // PATH | BITMAP | CIRCLE | ...
  name: string | null;
  processingType: string | null; // INTAGLIO | RELIEF | VECTOR_CUTTING | ...
  modeClass: "incise" | "emboss" | "score" | "other";
  dPath?: string;
  /** True when this object carries a vector path (a forge-able contour). */
  hasGeometry: boolean;
  /** id of the device.data process group this object belongs to. */
  groupKey: string;
}
```

Change `ParsedXcs` (currently lines 118-124) to add the two derived lists:

```ts
/** Result of parsing an uploaded .xcs. `raw` is the full JSON document. */
export interface ParsedXcs {
  raw: unknown;
  objects: XcsObject[];
  emboss: XcsObject[];
  incise: XcsObject[];
  /** Incise objects with usable geometry — the forge-able cut targets. */
  targets: XcsObject[];
  /** Real non-incise objects (emboss / score / other) preserved untouched. */
  preserved: XcsObject[];
}
```

- [ ] **Step 4: Update classification + parse in `web/src/lib/forge/xcs.ts`**

Replace the constants + `classify` (currently lines 5-12) with:

```ts
const INCISE_TYPES = new Set(["INTAGLIO", "VECTOR_CUTTING"]);
const EMBOSS_TYPES = new Set(["RELIEF"]);
const SCORE_TYPES = new Set([
  "VECTOR_ENGRAVING",
  "FILL_VECTOR_ENGRAVING",
  "COLOR_FILL_ENGRAVE",
]);

/** Classify a layer by its device-map processingType. Exported for testing. */
export function classify(pt: string | null): XcsObject["modeClass"] {
  if (pt && INCISE_TYPES.has(pt)) return "incise";
  if (pt && EMBOSS_TYPES.has(pt)) return "emboss";
  if (pt && SCORE_TYPES.has(pt)) return "score";
  return "other";
}
```

Replace the object-building loop + `parsed` assembly in `parseXcsFile` (currently lines 65-88) with:

```ts
  // Walk device.data Map → group → displays Map → processing entries.
  const objects: XcsObject[] = [];
  for (const [groupKey, group] of mapEntries<RawGroup>(raw.device?.data)) {
    for (const [displayId, entry] of mapEntries<RawEntry>(group.displays)) {
      const disp = byId.get(displayId);
      // Device-map entries can reference displays that no longer exist on the
      // canvas (orphan sub-entries of a compound path). They carry no geometry
      // and can be neither a cut target nor a visible layer — skip them. They
      // remain byte-intact in `raw`, so export still preserves them.
      if (!disp) continue;
      const processingType = entry.processingType ?? null;
      objects.push({
        id: displayId,
        type: disp.type ?? entry.type ?? "UNKNOWN",
        name: disp.name ?? null,
        processingType,
        modeClass: classify(processingType),
        dPath: disp.dPath,
        hasGeometry: !!disp.dPath,
        groupKey,
      });
    }
  }

  const parsed: ParsedXcs = {
    raw,
    objects,
    emboss: objects.filter((o) => o.modeClass === "emboss"),
    incise: objects.filter((o) => o.modeClass === "incise"),
    targets: objects.filter((o) => o.modeClass === "incise" && o.hasGeometry),
    preserved: objects.filter((o) => o.modeClass !== "incise"),
  };
  return parsed;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts -t "classify|incise-only|targets/preserved"`
Expected: PASS (all assertions green).

- [ ] **Step 6: Run the full forge test file to catch regressions**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts`
Expected: PASS except possibly the existing `"calibrates mmPerUnit confidently from the RELIEF_PROCESS perimeter"` test (calibration is rewritten in Task 2 — if it fails here, that's expected and fixed next). All other tests PASS.

- [ ] **Step 7: Commit (incl. the fixture)**

```bash
git add web/src/lib/forge/types.ts web/src/lib/forge/xcs.ts web/src/lib/forge/xcs.test.ts samples/xcs/test-text.xcs
git commit -m "feat(forge): score class + phantom-skip + cut targets/preserved layers

VECTOR_ENGRAVING is score (not emboss); only RELIEF is emboss. parseXcsFile
skips orphan device entries with no canvas display. ParsedXcs exposes
geometry-bearing cut targets + preserved layers. Adds the incise-only
test-text.xcs fixture."
```

---

## Task 2: Rewrite calibration to the display scale

**Files:**
- Modify: `web/src/lib/forge/xcs.ts:3, :123-143`
- Test: `web/src/lib/forge/xcs.test.ts`

- [ ] **Step 1: Write/adjust the failing tests**

In `web/src/lib/forge/xcs.test.ts`, **replace** the existing calibration test (currently the `it("calibrates mmPerUnit confidently from the RELIEF_PROCESS perimeter", …)` block) with:

```ts
  it("calibrates mmPerUnit confidently from the display scale (≈0.848)", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const cal = calibrateMmPerUnit(parsed, incise);
    expect(cal.confident).toBe(true);
    // scale.x (0.84813), NOT the buggy perimeter-derived 0.2375.
    expect(cal.mmPerUnit).toBeCloseTo(0.848, 2);
  });
```

Then add a new calibration test for the incise-only sample (in the `parseXcsFile (incise-only sample: test-text.xcs)` describe block from Task 1):

```ts
  it("calibrates confidently at ≈1.0 (scale.x) with no perimeter", () => {
    const parsed = parseXcsFile(loadText());
    const cal = calibrateMmPerUnit(parsed, parsed.targets[0]);
    expect(cal.confident).toBe(true);
    expect(cal.mmPerUnit).toBeCloseTo(1.0, 3);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts -t "calibrat"`
Expected: FAIL — the real-sample test expects `0.848` but the current perimeter method returns `0.2375`.

- [ ] **Step 3: Rewrite `calibrateMmPerUnit` in `web/src/lib/forge/xcs.ts`**

Replace the `calibrateMmPerUnit` function and its doc comment (currently lines 123-143) with:

```ts
/**
 * Derive path-units → mm for the selected incise contour.
 *
 * The xTool canvas is in millimetres and a display maps its path units to the
 * canvas via `canvasX = unit·scale.x + offsetX` — so the display's own
 * `scale.x` IS the units→mm factor (cross-checked by `width / bbox-width`).
 * The old `RELIEF_PROCESS.perimeter` method was wrong: that perimeter
 * describes the emboss, not the incise contour, and made kerf bands ~3.57×
 * too wide. Falls back to 1.0 + not-confident only when neither scale nor
 * width is available (caller surfaces a warning + manual override).
 */
export function calibrateMmPerUnit(p: ParsedXcs, incise: XcsObject): Calibration {
  const raw = p.raw as { canvas?: Array<{ displays?: Array<Record<string, unknown>> }> };
  const disp = (raw.canvas?.[0]?.displays ?? []).find((d) => d.id === incise.id) as
    | { scale?: { x?: number; y?: number }; width?: number }
    | undefined;

  // 1. Uniform display scale = path-units → bed-mm. Authoritative.
  const sx = disp?.scale?.x;
  const sy = disp?.scale?.y;
  if (typeof sx === "number" && sx > 0 && (typeof sy !== "number" || Math.abs(sx - sy) < 1e-6)) {
    return { mmPerUnit: sx, confident: true };
  }

  // 2. Real-world width ÷ flattened-bbox width (missing/anisotropic scale).
  const w = disp?.width;
  if (typeof w === "number" && w > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of extractContourSubpaths(incise)) {
      for (const pt of c.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
      }
    }
    const bboxW = maxX - minX;
    if (Number.isFinite(bboxW) && bboxW > 0) return { mmPerUnit: w / bboxW, confident: true };
  }

  // 3. No usable signal.
  return { mmPerUnit: 1, confident: false };
}
```

- [ ] **Step 4: Drop the now-unused `contourPerimeter` import**

`contourPerimeter` was only used by the old calibration. The pre-commit hook fails on unused imports. Change `web/src/lib/forge/xcs.ts:3` from:

```ts
import { flattenDPath, normaliseContour, contourPerimeter, splitSubpaths } from "./contour";
```

to:

```ts
import { flattenDPath, normaliseContour, splitSubpaths } from "./contour";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts -t "calibrat"`
Expected: PASS — real sample `≈0.848`, incise-only `≈1.0`.

- [ ] **Step 6: Run typecheck + the full lib test suite**

Run: `cd web && npx tsc --noEmit && npx vitest run src/lib/forge/`
Expected: PASS. (`pipeline.test.ts` assertions are count/order/ring-shape based, not absolute scale, so the new `mmPerUnit` does not break them.)

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/forge/xcs.ts web/src/lib/forge/xcs.test.ts
git commit -m "fix(forge): calibrate mm/unit from display scale, not job perimeter

The RELIEF_PROCESS perimeter describes the emboss, not the incise contour,
so the old method made kerf bands ~3.57x too wide on emboss files. Use the
display's scale.x (width/bbox cross-check) instead; incise-only files with
no perimeter now calibrate confidently."
```

---

## Task 3: Worker response — targets/preserved ids

**Files:**
- Modify: `web/src/lib/forge/forge.worker.ts:12-16, :27-32`

- [ ] **Step 1: Update the response type**

In `web/src/lib/forge/forge.worker.ts`, change the `ForgeResponse` union's `"parsed"` arm (line 13) from:

```ts
  | { type: "parsed"; objects: XcsObject[]; embossIds: string[]; inciseIds: string[] }
```

to:

```ts
  | { type: "parsed"; objects: XcsObject[]; targetIds: string[]; preservedIds: string[] }
```

- [ ] **Step 2: Update the parse handler**

Change the `post({ type: "parsed", … })` call (lines 27-32) to:

```ts
      post({
        type: "parsed",
        objects: parsed.objects,
        targetIds: parsed.targets.map((o) => o.id),
        preservedIds: parsed.preserved.map((o) => o.id),
      });
```

- [ ] **Step 3: Verify typecheck fails in ForgePage (expected)**

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — `ForgePage.tsx` still references `msg.embossIds` / `msg.inciseIds` and `state.embossIds` / `state.inciseIds`. Fixed in Task 4.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/forge/forge.worker.ts
git commit -m "refactor(forge): worker sends targetIds/preservedIds"
```

---

## Task 4: ForgePage — state, parsed handler, auto-select, validation (gate removal)

**Files:**
- Modify: `web/src/pages/ForgePage.tsx:58-68, :108-118, :200-213`

- [ ] **Step 1: Update the `State` type**

Change the `ready` arm of `State` (lines 61-67) from:

```ts
  | {
      kind: "ready";
      fileName: string;
      objects: XcsObject[];
      embossIds: string[];
      inciseIds: string[];
    }
```

to:

```ts
  | {
      kind: "ready";
      fileName: string;
      objects: XcsObject[];
      targetIds: string[];
      preservedIds: string[];
    }
```

- [ ] **Step 2: Update the parsed-message handler + auto-select**

Change the `if (msg.type === "parsed")` block (lines 108-118) from its current body to:

```ts
      if (msg.type === "parsed") {
        const currentState = stateRef.current;
        const fileName = currentState.kind === "loading" ? currentState.fileName : "file.xcs";
        setState({
          kind: "ready",
          fileName,
          objects: msg.objects,
          targetIds: msg.targetIds,
          preservedIds: msg.preservedIds,
        });
        setSelectedIncise(msg.targetIds.length === 1 ? msg.targetIds[0] : null);
      } else if (msg.type === "generated") {
```

- [ ] **Step 3: Update validation (remove the emboss gate)**

Replace the `validation` useMemo body (lines 200-213) with:

```ts
  const validation = useMemo(() => {
    const errors: string[] = [];
    if (state.kind === "ready") {
      if (state.targetIds.length === 0)
        errors.push("No incise contour with usable geometry found.");
      if (state.targetIds.length > 1 && !selectedIncise)
        errors.push("Multiple incise contours — select a target.");
      const obj = selectedIncise ? state.objects.find((o) => o.id === selectedIncise) : null;
      if (selectedIncise && !obj?.dPath)
        errors.push("Selected target is not a usable vector/path contour.");
    }
    const warnings = result?.stats.warnings ?? [];
    return { errors, warnings };
  }, [state, selectedIncise, result]);
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: FAIL only inside the left-panel JSX (`state.embossIds` at the old Emboss card, `state.inciseIds` at the old Incise card) — fixed in Task 5. No other errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ForgePage.tsx
git commit -m "feat(forge): lift emboss requirement; gate on a usable incise target"
```

---

## Task 5: ForgePage — Cut target / Preserved layers panels + copy

**Files:**
- Modify: `web/src/pages/ForgePage.tsx:261-265, :303-332`

- [ ] **Step 1: Update the idle empty-state copy**

Replace the `EmptyState` in the `state.kind === "idle"` block (lines 261-265) with:

```tsx
        {state.kind === "idle" && (
          <EmptyState
            title="Upload an xTool .xcs"
            description="The file needs at least one incise (INTAGLIO) contour — the cut target. Forge converts the selected contour into staged seed / perforate / deepen / clean cut paths; any emboss or score layers are preserved untouched."
          />
        )}
```

- [ ] **Step 2: Replace the two left-panel cards**

Replace the "Emboss objects" + "Incise objects" cards (lines 303-332) with the "Preserved layers" + "Cut target" cards:

```tsx
              <Card>
                <CardHeader>
                  <CardTitle>Cut target</CardTitle>
                </CardHeader>
                <div className="p-2 font-mono flex flex-col gap-1">
                  {state.targetIds.map((id) => {
                    const o = state.objects.find((x) => x.id === id);
                    return (
                      <label key={id} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="incise"
                          checked={selectedIncise === id}
                          onChange={() => setSelectedIncise(id)}
                        />
                        {id.slice(0, 8)} · {o?.processingType ?? "INTAGLIO"}
                      </label>
                    );
                  })}
                </div>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Preserved layers</CardTitle>
                </CardHeader>
                <div className="p-2 font-mono flex flex-col gap-1 text-[var(--color-ink-muted)]">
                  {state.preservedIds.length === 0 ? (
                    <span>None — only the cut target is present.</span>
                  ) : (
                    <>
                      {state.preservedIds.map((id) => {
                        const o = state.objects.find((x) => x.id === id);
                        return (
                          <div key={id}>
                            {id.slice(0, 8)} · {o?.processingType ?? "—"}
                          </div>
                        );
                      })}
                      <span className="mt-1 text-[10px]">passed through untouched</span>
                    </>
                  )}
                </div>
              </Card>
```

- [ ] **Step 3: Typecheck + build**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (no remaining `embossIds`/`inciseIds` references).

Run: `cd web && npm test`
Expected: PASS — all Vitest suites green (incl. the untouched `ForgeControls`/`ForgeStageParams` component tests, which don't depend on the renamed state).

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ForgePage.tsx
git commit -m "feat(forge): Cut target + Preserved layers panels with real labels"
```

---

## Task 6: Verify every black island is cut (disjoint circles)

This encodes the spec's primary success criterion. `test-text.xcs`'s target is a 17-subpath compound including two disjoint ring+dot decorations at ~(36,47) and ~(80,47) (path-unit coords; `mmPerUnit≈1.0` so mm ≈ units).

**Files:**
- Test: `web/src/lib/forge/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

In `web/src/lib/forge/pipeline.test.ts`, add a second sample loader after the existing `loadSample` (around line 13):

```ts
const TEXT_SAMPLE = resolve(__dirname, "../../../../samples/xcs/test-text.xcs");
function loadText(): ArrayBuffer {
  const b = readFileSync(TEXT_SAMPLE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
```

Add this describe block at the end of the file:

```ts
describe("runPipeline (incise-only sample: test-text.xcs)", () => {
  it("calibrates confidently at ~1.0 with no warning", () => {
    const parsed = parseXcsFile(loadText());
    const { stats } = runPipeline(parsed, parsed.targets[0].id, DEFAULT_CONFIG);
    expect(stats.mmPerUnit).toBeCloseTo(1.0, 3);
    expect(stats.mmPerUnitConfident).toBe(true);
    expect(stats.warnings.some((w) => w.includes("calibrate"))).toBe(false);
  });

  it("cuts every black island, including both disjoint ring+dot circles", () => {
    const parsed = parseXcsFile(loadText());
    const { paths } = runPipeline(parsed, parsed.targets[0].id, DEFAULT_CONFIG);
    expect(paths.length).toBeGreaterThan(0);
    // A generated ring point must land near each circle centre (within 4mm).
    const near = (cx: number, cy: number) =>
      paths.some((p) =>
        p.rings.some((r) => r.some((pt) => Math.hypot(pt.x - cx, pt.y - cy) < 4)),
      );
    expect(near(36, 47)).toBe(true); // left ring+dot
    expect(near(80, 47)).toBe(true); // right ring+dot
  });
});
```

This needs `parsed.targets` (Task 1). The existing imports (`parseXcsFile`, `runPipeline`, `DEFAULT_CONFIG`, `readFileSync`, `resolve`) already cover it.

- [ ] **Step 2: Run the test**

Run: `cd web && npx vitest run src/lib/forge/pipeline.test.ts -t "incise-only"`
Expected (the verification): the calibration assertion PASSES. The "cuts every black island" assertion **either passes** (the band geometry already covers both islands — the likely outcome, since `bandFromRegion` offsets the whole multi-component region in the default `outside` mode) **or fails** if `buildPartRegion`'s nesting heuristic mis-classifies a disjoint circle.

- [ ] **Step 3 (contingency — only if the island test failed): fix `buildPartRegion`**

If `near(36,47)` or `near(80,47)` is false, the nesting-level classifier (`offset.ts:136-184`) dropped/inverted a disjoint island. Diagnose and fix:

1. Add a temporary debug print to confirm which loops survive:
   ```ts
   // TEMP in a scratch test: log region ring count + bboxes
   const subs = parsed.targets[0]; // … flatten via extractContourSubpaths + toMm
   ```
   (Use the existing `buildPartRegion` export; compare input loop count (17) to output ring count.)
2. The most likely fix: `nestingLevels` (`offset.ts:136`) probes only `loop[0]`; for a tiny circle whose first point sits exactly on another loop's edge, containment can misread. Make the part-region union **per-connected-component**: when `odd.length === 0` the code already does an even-odd `Union` of all loops (`offset.ts:183`) which preserves every island — verify the failing case isn't taking the `Difference` branch (`:181`) and erasing an island. If it is, restrict the `Difference` to loops sharing a containment tree with an odd-level loop, leaving independent islands to the even-odd union, then merge the two results with `ctUnion`.
3. Re-run Step 2 until both `near()` assertions pass. Keep the change minimal and covered by this test.

- [ ] **Step 4: Run the full pipeline test file**

Run: `cd web && npx vitest run src/lib/forge/pipeline.test.ts`
Expected: PASS (existing incise_emboss tests + the new incise-only tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/pipeline.test.ts web/src/lib/forge/offset.ts
git commit -m "test(forge): assert incise-only cut covers every disjoint island"
```

(If Task 6 Step 3 wasn't needed, `offset.ts` won't be staged — that's fine.)

---

## Task 7: Comment cleanup (stale emboss rationale)

Comment-only; no test. The even-odd "part body is a hole" design is correct regardless of emboss — only the *rationale* was emboss-specific.

**Files:**
- Modify: `web/src/lib/forge/stages.ts` (the band-model comment ~lines 14-18)
- Modify: `web/src/lib/forge/offset.ts:195-197, :215-219`
- Modify: `web/src/lib/forge/xcs.ts` (`buildGeneratedXcs` doc, the `#00befe` line ~:220, and the alignment comment ~:291)

- [ ] **Step 1: Update `offset.ts` comments**

In `bandFromRegion`'s doc comment (lines 195-197), change:
```
 * leaving the part body (the inner region) a HOLE so the emboss is never
 * engraved. Returns rings (Pt[][]); empty if the outer boundary vanished.
```
to:
```
 * leaving the part body (the inner region) a HOLE, so only the kerf sliver is
 * engraved — not the whole part. Returns rings (Pt[][]); empty if a boundary
 * vanished.
```

In the inner comment (lines 215-219), change the phrase `engraving over the emboss.` to `flood-filling the whole part.` and `engraves over the emboss` to `engraves the whole part body`.

- [ ] **Step 2: Update `stages.ts` band-model comment**

Find the comment (around lines 14-18) containing `so the emboss is never engraved` and change that clause to `so only the kerf sliver is engraved (the part body stays a hole)`.

- [ ] **Step 3: Update `xcs.ts` `buildGeneratedXcs` comments**

In the `buildGeneratedXcs` doc block, change the `#00befe` sentence (line ~220) from:
```
 * are set to that colour. The existing `#00befe` layerData entry is preserved
 * (the emboss BITMAP still uses it). Params/processingType are copied from the
```
to:
```
 * are set to that colour. Any pre-existing layerData entries (e.g. an emboss
 * BITMAP's `#00befe`) are preserved if present. Params/processingType are
 * copied from the
```

Change the inline alignment comment (line ~291) from `so it stays aligned with the emboss.` to `so it stays aligned with the source contour.`

- [ ] **Step 4: Verify nothing broke**

Run: `cd web && npx tsc --noEmit && npx vitest run src/lib/forge/`
Expected: PASS (comments only).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/stages.ts web/src/lib/forge/offset.ts web/src/lib/forge/xcs.ts
git commit -m "docs(forge): drop stale 'protect the emboss' comments"
```

---

## Task 8: Changelog entry

**Files:**
- Create: `changelog/2026-05-31-forge-incise-only.md`

- [ ] **Step 1: Create the changelog file**

```markdown
---
id: 2026-05-31-forge-incise-only
date: 2026-05-31
level: minor
title: Forge — incise-only files + corrected kerf scale
summary: Forge no longer needs an emboss layer; any incise-only design converts to a smart cut, and kerf widths now match the beam-width setting.
---

Forge previously refused to export unless the uploaded `.xcs` carried a raised
emboss (RELIEF) object — but the cut geometry never used it. Now an
incise-only design (outlined text or shapes, no relief) converts to a smart
cut on its own: drop in the file, pick the contour, export.

Two fixes rode along. Layer detection now treats `VECTOR_ENGRAVING` as
**score** rather than emboss and hides device-map entries that carry no
geometry, so the object lists show only what's really there. And kerf
calibration now reads each contour's true scale instead of a job perimeter
that actually described the emboss — on emboss files the generated bands were
about 3.57× too wide. **Re-check a cut after updating.**
```

- [ ] **Step 2: Verify the entry parses (id matches filename stem)**

Run: `cd web && npm run build > /dev/null 2>&1 && echo OK`
Expected: `OK` (build succeeds; the changelog is read at request time by the backend, the filename stem `2026-05-31-forge-incise-only` matches the `id`).

- [ ] **Step 3: Commit**

```bash
git add changelog/2026-05-31-forge-incise-only.md
git commit -m "docs(changelog): Forge incise-only + corrected kerf scale"
```

---

## Task 9: Full verification (tsc + tests + build + real browser)

UI isn't "done" at tsc + tests + build green (per CLAUDE.md + project memory). This task does the golden-path browser check.

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + full unit suite**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: PASS — every suite green.

- [ ] **Step 2: Production build**

Run: `cd web && npm run build`
Expected: build completes; `web/dist/` updated (the backend serves this).

- [ ] **Step 3: Launch the dev server**

Run: `uv run --active xcs-gen serve --host 127.0.0.1 --port 8017`
(Leave running; open `http://127.0.0.1:8017/#/forge` in the browser via Chrome DevTools MCP.)

- [ ] **Step 4: Incise-only golden path (`test-text.xcs`)**

Using the Chrome DevTools MCP tooling, on `#/forge`:
1. Upload `samples/xcs/test-text.xcs`.
2. Confirm: **Cut target** shows exactly one `INTAGLIO` entry, auto-selected; **Preserved layers** shows "None — only the cut target is present."; Validation shows `ready` (green); **no** "No emboss" error; **no** calibration warning.
3. Confirm the preview renders the staged cut paths over the "Test" outline, and visually that **both small ring+dot circles** (left and right) have generated bands around them.
4. Confirm **Export modified .xcs** is enabled; click it; confirm a file downloads.
5. Take a screenshot and read it critically (per project memory `feedback_ui_screenshot_review`).

- [ ] **Step 5: Regression — emboss sample still works (`incise_emboss.xcs`)**

1. Upload `samples/xcs/incise_emboss.xcs`.
2. Confirm **Cut target** shows the `INTAGLIO` contour; **Preserved layers** shows the `RELIEF` layer; Validation `ready`; Export enabled.
3. Confirm the preview renders bands; note they are visibly **thinner** than before (the corrected calibration) — this is expected.

- [ ] **Step 6: Stop the server**

Stop the `xcs-gen serve` process.

- [ ] **Step 7: Push + open a draft PR**

```bash
git push -u origin feat/forge-incise-only
gh pr create --draft \
  --title "feat(forge): incise-only input support + corrected kerf calibration" \
  --body "$(cat <<'BODY'
Lets Forge convert an incise-only .xcs (no emboss) into a smart cut.

- Narrow emboss class to RELIEF; VECTOR_ENGRAVING is now `score`.
- Skip phantom device-map entries (no canvas display) at parse.
- Derive cut `targets` (incise + geometry) and `preserved` layers.
- Lift the UI emboss gate; relabel panels to Cut target / Preserved layers.
- Fix kerf calibration: use the display's true `scale.x` (cross-checked by
  width/bbox) instead of the job perimeter, which described the emboss and
  made bands ~3.57x too wide. **Re-verify cuts in xTool.**
- Verified `test-text.xcs` cuts every black island incl. both disjoint circles.

Spec: docs/superpowers/specs/2026-05-31-forge-incise-only-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 8: Flip to ready when CI is green**

Run: `gh pr ready` (after CI passes).

---

## Self-Review (run by the plan author, completed)

- **Spec coverage:** §1 classification → Task 1; §2 phantom-filter → Task 1; §3 gate/validation → Task 4; §4 calibration → Task 2; §5 panels/labels → Task 5; §6 copy → Task 5; §7 output unchanged + comment cleanup → Task 7; success criterion (circles) → Task 6; testing → Tasks 1/2/6; changelog → Task 8; browser verification → Task 9. No gaps.
- **Placeholder scan:** every code step shows full code; the only "fill-in" is Task 6 Step 3, which is an explicit *contingency* with concrete diagnosis steps (not a placeholder for required work).
- **Type consistency:** `targets`/`preserved` (ParsedXcs), `hasGeometry` (XcsObject), `modeClass: …|"score"|…`, worker `targetIds`/`preservedIds`, and `State.ready.targetIds`/`preservedIds` are used identically across Tasks 1, 3, 4, 5, 6. `classify` exported in Task 1 and consumed by its test. `calibrateMmPerUnit(p, incise)` signature unchanged (Task 2).
