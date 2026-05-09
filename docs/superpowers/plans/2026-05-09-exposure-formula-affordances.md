# Exposure Formula Affordances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every exposure-side index discoverable: a plain-words formula always visible under each scatter axis, plus stability-style hover-cards on scatter axes, left-rail picker buttons, palette-indices chips, and correlation-matrix row labels.

**Architecture:** Generalise `StabilityHelpTip` into a body-agnostic `HelpTip<Body, Help>` and reuse the portal/hover/a11y machinery on the exposure side. Author one `exposureHelpCopy.ts` (7 indices + 5 channels + 6 raw params), three small body components (`IndexCardBody`, `ChannelCardBody`, `RawParamCardBody`), and a 5-family `ExposureHelpSchematic`. Refactor the scatter's SVG `<text>` axis titles into absolutely-positioned HTML overlays so they can be `HelpTip` wrappers and carry a two-line "name + words formula" layout. Wire the matching cards into the matrix row labels (via a new `renderRowLabel` render prop), the rail pickers, and the chips.

**Tech Stack:** React 18 + TypeScript + Tailwind v4 + vitest + @testing-library/react. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-09-exposure-formula-affordances-design.md`

---

## File structure

**New:**
- `web/src/components/HelpTip.tsx` — generic, renamed from `StabilityHelpTip.tsx`; accepts a `Body: ComponentType<{ help: H }>` prop.
- `web/src/components/StabilityHelpCardBody.tsx` — extracted from current `StabilityHelpTip.tsx`.
- `web/src/components/exposure/exposureHelpCopy.ts` — `EXPOSURE_INDEX_HELP`, `EXPOSURE_CHANNEL_HELP`, `EXPOSURE_RAW_PARAM_HELP`, plus the shapes.
- `web/src/components/exposure/ExposureHelpSchematic.tsx` — five family schematics: `dot_pitch`, `line_pitch`, `pulse_shape`, `accumulation`, `combination`.
- `web/src/components/exposure/ExposureHelpCardBody.tsx` — exports `IndexCardBody`, `ChannelCardBody`, `RawParamCardBody`.
- Tests for each new file.

**Modified:**
- `web/src/components/StabilityHelpTip.tsx` → one-line shim re-exporting `HelpTip` with `StabilityHelpCardBody` pre-bound (keeps stability call-sites untouched).
- `web/src/components/StabilityHelpTip.test.tsx` → renamed to `HelpTip.test.tsx`; imports adjusted.
- `web/src/components/exposure/ExposureCorrelationMatrix.tsx` — adds optional `renderRowLabel` render-prop so call-sites can wrap labels in `HelpTip`.
- `web/src/components/exposure/ExposureScatter.tsx` — axis titles move from SVG `<text>` to HTML overlays inside a `position: relative` wrapper; `PADB` shrinks (the second formula line lives in the overlay, not the SVG).
- `web/src/pages/ExposurePage.tsx` — wraps left-rail X/Y axis pickers in `HelpTip`; supplies `renderRowLabel` to both correlation matrices.
- `web/src/components/PaletteIndicesChips.tsx` — wraps each `Chip` in `HelpTip`.

---

### Task 1: Extract `StabilityHelpCardBody` (no behaviour change)

The current `StabilityHelpTip.tsx` contains both the portal/hover machinery and the stability-specific card body (`HelpCardBody`). We pull the body into its own file first so Task 2 can refactor only the wrapper.

**Files:**
- Create: `web/src/components/StabilityHelpCardBody.tsx`
- Modify: `web/src/components/StabilityHelpTip.tsx`

- [ ] **Step 1: Create `StabilityHelpCardBody.tsx`**

```tsx
import type { AxisHelp } from "./stabilityHelpCopy";
import { StabilityHelpSchematic } from "./StabilityHelpSchematic";

/* Stability-side help card body. Lifted out of StabilityHelpTip so the
 * tip wrapper itself can become content-agnostic in a follow-up refactor.
 * Render contract is unchanged from the original `HelpCardBody`. */
export function StabilityHelpCardBody({ help }: { help: AxisHelp }) {
  return (
    <div className="px-3.5 py-3 flex flex-col gap-3" style={{ width: 340 }}>
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
        {help.heading}
      </div>
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <StabilityHelpSchematic schematic={help.schematic} />
        </div>
        <div className="flex flex-col gap-2.5 min-w-0 flex-1">
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
              Definition
            </div>
            <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink)] m-0">
              {help.definition}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
              How to read it
            </div>
            <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink-muted)] m-0">
              {help.guide}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace inline `HelpCardBody` in `StabilityHelpTip.tsx`**

In `StabilityHelpTip.tsx`:
- Add `import { StabilityHelpCardBody } from "./StabilityHelpCardBody";` near the existing imports.
- Delete the `function HelpCardBody({ help }: { help: AxisHelp }) { ... }` block at the bottom of the file (lines ~255–286 in the current source).
- In `HelpTipPortal`, replace `<HelpCardBody help={help} />` with `<StabilityHelpCardBody help={help} />`.

- [ ] **Step 3: Run stability tests**

```bash
cd web && npx vitest run src/components/StabilityHelpTip.test.tsx
```

Expected: PASS (no behaviour change).

- [ ] **Step 4: Run typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/StabilityHelpCardBody.tsx \
        web/src/components/StabilityHelpTip.tsx
git commit -m "refactor(stability): extract StabilityHelpCardBody from StabilityHelpTip

Pure code move ahead of the body-agnostic HelpTip refactor. No behaviour
change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Make `HelpTip` body-agnostic (with stability shim)

Rename `StabilityHelpTip.tsx` → `HelpTip.tsx` and add a `Body` prop. The original module becomes a one-line shim so stability's call-sites keep working unchanged.

**Files:**
- Create: `web/src/components/HelpTip.tsx`
- Create: `web/src/components/HelpTip.test.tsx`
- Modify: `web/src/components/StabilityHelpTip.tsx` (becomes shim)
- Delete: `web/src/components/StabilityHelpTip.test.tsx` (renamed in step 4 below)

- [ ] **Step 1: Write the failing test for the generic HelpTip**

Create `web/src/components/HelpTip.test.tsx`:

```tsx
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HelpTip } from "./HelpTip";

interface FakeHelp {
  heading: string;
  body: string;
}
const FAKE: FakeHelp = { heading: "FAKE HEAD", body: "fake body sentence" };
function FakeBody({ help }: { help: FakeHelp }) {
  return (
    <div>
      <span>{help.heading}</span>
      <span>{help.body}</span>
    </div>
  );
}

function advance(ms: number): void {
  act(() => { vi.advanceTimersByTime(ms); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe("HelpTip (generic)", () => {
  it("renders its Body prop with the supplied help payload", () => {
    render(
      <HelpTip help={FAKE} Body={FakeBody}>
        <button type="button">TRIGGER</button>
      </HelpTip>,
    );
    fireEvent.pointerEnter(screen.getByText("TRIGGER"));
    advance(500);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("FAKE HEAD");
    expect(tip.textContent).toContain("fake body sentence");
  });

  it("does not render the body before the open delay", () => {
    render(
      <HelpTip help={FAKE} Body={FakeBody}>
        <button type="button">TRIGGER</button>
      </HelpTip>,
    );
    fireEvent.pointerEnter(screen.getByText("TRIGGER"));
    advance(200);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
cd web && npx vitest run src/components/HelpTip.test.tsx
```

Expected: FAIL — `HelpTip` import resolves to a non-existent file.

- [ ] **Step 3: Create `HelpTip.tsx`**

Move the entirety of `web/src/components/StabilityHelpTip.tsx` into a new file `web/src/components/HelpTip.tsx`, with these edits applied during the move:

1. Replace the `import type { AxisHelp } from "./stabilityHelpCopy";` line with: nothing (the generic doesn't need it).
2. Replace `import { StabilityHelpCardBody } from "./StabilityHelpCardBody";` with: nothing (generic doesn't need a default body).
3. Replace the `HelpTipProps` interface with the generic version below.
4. Make `HelpTip` generic and pass `Body` through to `HelpTipPortal`.
5. Make `HelpTipPortal` accept `Body` and `help` instead of just `help`, and render `<Body help={help} />` in place of `<StabilityHelpCardBody help={help} />`.

```tsx
// HelpTipProps becomes generic
export interface HelpTipProps<H> {
  help: H;
  Body: React.ComponentType<{ help: H }>;
  children: ReactElement;
  className?: string;
}

export function HelpTip<H>({ help, Body, children, className }: HelpTipProps<H>) {
  // ... existing useState/useRef/timer logic unchanged ...
  // In the JSX, replace the HelpTipPortal call's prop list with:
  //   <HelpTipPortal id={tipId} closing={closing} help={help} Body={Body}
  //                  anchor={wrapperRef.current!}
  //                  onPointerEnter={cancelClose} onPointerLeave={scheduleClose} />
}

interface PortalProps<H> {
  id: string;
  closing: boolean;
  help: H;
  Body: React.ComponentType<{ help: H }>;
  anchor: HTMLElement;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

function HelpTipPortal<H>({
  id, closing, help, Body, anchor, onPointerEnter, onPointerLeave,
}: PortalProps<H>) {
  // ... existing useRef/useLayoutEffect placement logic unchanged ...
  return createPortal(
    <div
      id={id}
      ref={ref}
      role="tooltip"
      data-help-tip={id}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={
        "fixed z-[1000] rounded-[8px] border border-[color:var(--color-border-strong)] " +
        "bg-[color:var(--color-surface-elevated)] shadow-lg"
      }
      style={{
        left: placement.left,
        top: placement.top,
        pointerEvents: "auto",
        opacity: closing ? 0 : 1,
        transition: closing
          ? `opacity ${FADE_OUT_MS}ms ease-out`
          : "opacity 80ms ease-out",
      }}
    >
      <Body help={help} />
    </div>,
    document.body,
  );
}
```

Keep the constants (`OPEN_DELAY_MS`, `LEAVE_DELAY_MS`, `FADE_OUT_MS`) and the `__testing__` re-export at the bottom of the file unchanged.

- [ ] **Step 4: Replace the old test file with the renamed one**

```bash
git rm web/src/components/StabilityHelpTip.test.tsx
```

(The replacement test file `HelpTip.test.tsx` from Step 1 already covers the generic. The stability-specific card body is now exercised through Task 1's already-passing structure plus the shim test in Step 6 below.)

- [ ] **Step 5: Convert `StabilityHelpTip.tsx` into a shim**

Replace the entire contents of `web/src/components/StabilityHelpTip.tsx` with:

```tsx
/* Backwards-compat shim. Stability's existing call-sites import HelpTip
 * from this file; the implementation has moved to ./HelpTip.tsx with a
 * body-agnostic API. We bind the stability body here so the public API
 * (`<HelpTip help={...}>`) is identical for those call-sites. */

import * as React from "react";
import { HelpTip as GenericHelpTip } from "./HelpTip";
import { StabilityHelpCardBody } from "./StabilityHelpCardBody";
import type { AxisHelp } from "./stabilityHelpCopy";

export interface HelpTipProps {
  help: AxisHelp;
  children: React.ReactElement;
  className?: string;
}

export function HelpTip({ help, children, className }: HelpTipProps) {
  return (
    <GenericHelpTip<AxisHelp>
      help={help}
      Body={StabilityHelpCardBody}
      className={className}
    >
      {children}
    </GenericHelpTip>
  );
}

export { __testing__ } from "./HelpTip";
```

- [ ] **Step 6: Add a smoke test for the shim**

Append to `web/src/components/HelpTip.test.tsx`:

```tsx
import { HelpTip as StabilityShim } from "./StabilityHelpTip";
import { TOOLBAR_HELP } from "./stabilityHelpCopy";

describe("StabilityHelpTip shim", () => {
  it("renders the stability body via the shim", () => {
    render(
      <StabilityShim help={TOOLBAR_HELP.mode}>
        <button type="button">SHIM</button>
      </StabilityShim>,
    );
    fireEvent.pointerEnter(screen.getByText("SHIM"));
    advance(500);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.heading);
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.definition);
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.guide);
  });
});
```

- [ ] **Step 7: Run all stability tests + new generic test**

```bash
cd web && npx vitest run src/components/HelpTip.test.tsx src/pages/StabilityPage.test.tsx
```

Expected: PASS for both files.

- [ ] **Step 8: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A web/src/components/HelpTip.tsx \
        web/src/components/HelpTip.test.tsx \
        web/src/components/StabilityHelpTip.tsx \
        web/src/components/StabilityHelpTip.test.tsx
git commit -m "refactor(helptip): generalise HelpTip with a Body prop

Stability's HelpTip becomes a one-line shim that pre-binds
StabilityHelpCardBody. Generic HelpTip<H> accepts any
ComponentType<{help: H}> as Body so the exposure side can plug in its
own card variants without forking the portal/hover machinery.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Author `exposureHelpCopy.ts`

Concrete copy for 7 indices, 5 channels, 6 raw params. All string content lifted from the spec.

**Files:**
- Create: `web/src/components/exposure/exposureHelpCopy.ts`
- Create: `web/src/components/exposure/exposureHelpCopy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/exposureHelpCopy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EXPOSURE_INDEX_HELP,
  EXPOSURE_CHANNEL_HELP,
  EXPOSURE_RAW_PARAM_HELP,
} from "./exposureHelpCopy";
import { INDEX_ROWS, CHANNEL_COLS, RAW_PARAM_ROWS } from "./exposureCorrelations";

describe("exposureHelpCopy", () => {
  it("has an entry for every IndexRow", () => {
    for (const k of INDEX_ROWS) {
      expect(EXPOSURE_INDEX_HELP[k]).toBeDefined();
      expect(EXPOSURE_INDEX_HELP[k].heading.length).toBeGreaterThan(0);
      expect(EXPOSURE_INDEX_HELP[k].definition.length).toBeGreaterThan(0);
      expect(EXPOSURE_INDEX_HELP[k].guide.length).toBeGreaterThan(0);
      expect(EXPOSURE_INDEX_HELP[k].formula.length).toBeGreaterThan(0);
      expect(EXPOSURE_INDEX_HELP[k].inputs.length).toBeGreaterThan(0);
    }
  });

  it("has an entry for every ChannelCol", () => {
    for (const k of CHANNEL_COLS) {
      expect(EXPOSURE_CHANNEL_HELP[k]).toBeDefined();
      expect(EXPOSURE_CHANNEL_HELP[k].heading.length).toBeGreaterThan(0);
    }
  });

  it("has an entry for every RawParamRow", () => {
    for (const k of RAW_PARAM_ROWS) {
      expect(EXPOSURE_RAW_PARAM_HELP[k]).toBeDefined();
      expect(EXPOSURE_RAW_PARAM_HELP[k].definition.length).toBeGreaterThan(0);
    }
  });

  it("references every input name in the formula string", () => {
    for (const k of INDEX_ROWS) {
      const help = EXPOSURE_INDEX_HELP[k];
      for (const input of help.inputs) {
        expect(
          help.formula,
          `formula for ${k} should mention input "${input.name}"`,
        ).toContain(input.name);
      }
    }
  });

  it("uses no single-letter input names (full words required)", () => {
    for (const k of INDEX_ROWS) {
      for (const input of EXPOSURE_INDEX_HELP[k].inputs) {
        expect(input.name.length, `${k} input ${input.name}`).toBeGreaterThan(1);
      }
    }
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
cd web && npx vitest run src/components/exposure/exposureHelpCopy.test.ts
```

Expected: FAIL (module does not exist).

- [ ] **Step 3: Create `exposureHelpCopy.ts`**

Create `web/src/components/exposure/exposureHelpCopy.ts`:

```ts
import type { ChannelCol, IndexRow, RawParamRow } from "./exposureCorrelations";
import type { SchematicId as StabilitySchematicId } from "../stabilityHelpCopy";

/* ─── Exposure help copy ──────────────────────────────────────────────────
 *
 * Three card variants live here:
 *   - IndexHelp     — full card: heading + unit + definition + formula
 *                     + inputs + guide + schematic
 *   - ChannelHelp   — definition + guide + schematic only (CIELab basics)
 *   - RawParamHelp  — heading + unit + one-line definition only
 *
 * Plain words throughout — no Greek, no single-letter abbreviations. */

export type ExposureSchematicId =
  | "dot_pitch"
  | "line_pitch"
  | "pulse_shape"
  | "accumulation"
  | "combination";

export interface ExposureIndexHelp {
  heading: string;
  unit: string;
  definition: string;
  formula: string;
  inputs: ReadonlyArray<{ name: string; unit: string }>;
  guide: string;
  schematic: ExposureSchematicId;
}

export interface ExposureChannelHelp {
  heading: string;
  definition: string;
  guide: string;
  schematic: StabilitySchematicId;
}

export interface ExposureRawParamHelp {
  heading: string;
  unit: string;
  definition: string;
}

export const EXPOSURE_INDEX_HELP: Record<IndexRow, ExposureIndexHelp> = {
  pulse_spacing_mm: {
    heading: "Pulse spacing",
    unit: "mm",
    definition:
      "Physical distance between successive laser pulses along a scan line.",
    formula: "speed ÷ (frequency × 1000)",
    inputs: [
      { name: "speed", unit: "mm/s" },
      { name: "frequency", unit: "kHz" },
    ],
    guide:
      "Smaller is denser coverage along the scan direction. Once spacing falls below the spot diameter, pulses start to overlap and the burn behaves as a continuous mark — bigger gains in colour from there usually mean more passes, not denser pulses.",
    schematic: "dot_pitch",
  },
  line_spacing_index: {
    heading: "Line spacing",
    unit: "dimensionless",
    definition:
      "Inverse of the controller's density setting — how far apart adjacent scan lines sit, in opaque controller units.",
    formula: "1 ÷ density",
    inputs: [
      { name: "density", unit: "controller value (opaque)" },
    ],
    guide:
      "Higher means lines further apart, lower means denser hatching. xTool's density mapping isn't physical, so this stays opaque — calibration upgrades it to mm later.",
    schematic: "line_pitch",
  },
  pulse_energy_index: {
    heading: "Pulse energy",
    unit: "dimensionless",
    definition:
      "Energy delivered per pulse — controller power divided by repetition rate.",
    formula: "power ÷ frequency",
    inputs: [
      { name: "power", unit: "% controller setting" },
      { name: "frequency", unit: "kHz" },
    ],
    guide:
      "Higher means more energy in each individual pulse. Pair it against L* to see how a single pulse's energy maps to lightness; sustained increase here at fixed total exposure usually means deeper, more thermally-affected marks.",
    schematic: "pulse_shape",
  },
  pulse_intensity_index: {
    heading: "Pulse intensity",
    unit: "dimensionless",
    definition:
      "Peak intensity of a pulse — energy concentrated by the pulse-width compression.",
    formula: "power ÷ (frequency × pulse_width)",
    inputs: [
      { name: "power", unit: "% controller setting" },
      { name: "frequency", unit: "kHz" },
      { name: "pulse_width", unit: "ns" },
    ],
    guide:
      "Higher intensity ablates rather than heats. The same energy delivered in a shorter pulse hits harder. Plotting against ΔE often separates ablation-driven colours (high here) from thermal-driven ones (low here).",
    schematic: "pulse_shape",
  },
  total_exposure_index: {
    heading: "Total exposure",
    unit: "dimensionless",
    definition:
      "Cumulative energy delivered per unit area across the burn.",
    formula: "power × density × passes ÷ speed",
    inputs: [
      { name: "power", unit: "% controller setting" },
      { name: "density", unit: "controller value (opaque)" },
      { name: "passes", unit: "count" },
      { name: "speed", unit: "mm/s" },
    ],
    guide:
      "The dose dial. Plotted against L*, this is usually the cleanest axis — burns get darker as exposure climbs. Plateaus or kinks mark the regime where colour stops responding to more dose and you need to vary something else.",
    schematic: "accumulation",
  },
  ablation_aggression_index: {
    heading: "Ablation aggression",
    unit: "dimensionless",
    definition:
      "Total exposure scaled by pulse intensity — high when both lots of energy AND sharp peaks are delivered.",
    formula:
      "(power × density × passes ÷ speed) × (power ÷ (frequency × pulse_width))",
    inputs: [
      { name: "power", unit: "% controller setting" },
      { name: "density", unit: "controller value (opaque)" },
      { name: "passes", unit: "count" },
      { name: "speed", unit: "mm/s" },
      { name: "frequency", unit: "kHz" },
      { name: "pulse_width", unit: "ns" },
    ],
    guide:
      "A combined indicator of how aggressive the burn is. Two recipes can share the same total exposure but differ wildly here — high aggression means the same dose is delivered as fewer, harder hits. Pair it against ΔE or chroma to spot regimes where aggression buys colour.",
    schematic: "combination",
  },
  delivery_smoothness_index: {
    heading: "Delivery smoothness",
    unit: "dimensionless",
    definition:
      "Total exposure divided by pulse intensity — high when energy is spread across many gentle pulses rather than few sharp ones.",
    formula:
      "(power × density × passes ÷ speed) ÷ (power ÷ (frequency × pulse_width))",
    inputs: [
      { name: "power", unit: "% controller setting" },
      { name: "density", unit: "controller value (opaque)" },
      { name: "passes", unit: "count" },
      { name: "speed", unit: "mm/s" },
      { name: "frequency", unit: "kHz" },
      { name: "pulse_width", unit: "ns" },
    ],
    guide:
      "Power cancels out, so this captures delivery pattern alone — same dose, smoother or spikier. High smoothness tends toward thermal/diffusion-driven colours; low smoothness toward ablation-driven ones.",
    schematic: "combination",
  },
};

export const EXPOSURE_CHANNEL_HELP: Record<ChannelCol, ExposureChannelHelp> = {
  L: {
    heading: "Lightness L*",
    definition: "CIE Lab lightness — 0 black, 100 white.",
    guide:
      "The cleanest axis to plot against total exposure. A monotonic descent says dose translates straight into darkness; a knee or plateau marks the regime where the burn stops responding.",
    schematic: "residual",
  },
  a: {
    heading: "Red–green a*",
    definition:
      "CIE Lab red–green axis — positive is red, negative is green.",
    guide:
      "On stainless burns, sustained positive a* across a sweep often means a warm cast. Pair it against pulse intensity to see whether the warmth is energy-driven or delivery-driven.",
    schematic: "residual",
  },
  b: {
    heading: "Yellow–blue b*",
    definition:
      "CIE Lab yellow–blue axis — positive is yellow, negative is blue.",
    guide:
      "Char and scorching usually push b* positive. A diagonal trend against pulse energy often points at the regime where blues drop off the palette.",
    schematic: "residual",
  },
  hue: {
    heading: "Hue h°",
    definition: "Hue angle of the measured colour, 0–360°.",
    guide:
      "Plot hue against an exposure index to see how dose rotates the palette. Stable bands across the sweep mark hues your burn delivers reliably.",
    schematic: "wheel",
  },
  chroma: {
    heading: "Chroma C*",
    definition: "Distance from the neutral axis in CIE Lab — saturation.",
    guide:
      "High chroma with low total exposure flags efficient colour-per-dose; low chroma at high exposure usually means the burn has saturated to grey.",
    schematic: "magnitude",
  },
};

export const EXPOSURE_RAW_PARAM_HELP: Record<RawParamRow, ExposureRawParamHelp> = {
  power: {
    heading: "Power",
    unit: "% controller setting",
    definition:
      "Controller power percentage. Maps to wall-plug watts in an opaque, model-specific way.",
  },
  speed: {
    heading: "Speed",
    unit: "mm/s",
    definition: "Linear speed of the laser head along a scan line.",
  },
  frequency: {
    heading: "Frequency",
    unit: "kHz",
    definition: "MOPA pulse repetition rate.",
  },
  density: {
    heading: "Density",
    unit: "controller value (opaque)",
    definition:
      "Controller density setting. Inversely related to scan-line spacing; mapping is non-physical.",
  },
  passes: {
    heading: "Passes",
    unit: "count",
    definition:
      "Number of times the burn pattern is repeated over the same area.",
  },
  pulse_width: {
    heading: "Pulse width",
    unit: "ns",
    definition: "Duration of each laser pulse, in nanoseconds.",
  },
};
```

- [ ] **Step 4: Run test and verify it passes**

```bash
cd web && npx vitest run src/components/exposure/exposureHelpCopy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/exposureHelpCopy.ts \
        web/src/components/exposure/exposureHelpCopy.test.ts
git commit -m "feat(exposure): help copy for indices, channels, raw params

Source of truth for the upcoming hover-card content. Plain-words
formulas, every input named in full, units alongside.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ExposureHelpSchematic` — five family schematics

**Files:**
- Create: `web/src/components/exposure/ExposureHelpSchematic.tsx`
- Create: `web/src/components/exposure/ExposureHelpSchematic.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureHelpSchematic.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  ExposureHelpSchematic,
  EXPOSURE_SCHEMATIC_IDS,
} from "./ExposureHelpSchematic";

describe("ExposureHelpSchematic", () => {
  it("exports five distinct schematic ids", () => {
    expect(new Set(EXPOSURE_SCHEMATIC_IDS).size).toBe(5);
  });

  for (const id of [
    "dot_pitch",
    "line_pitch",
    "pulse_shape",
    "accumulation",
    "combination",
  ] as const) {
    it(`renders the "${id}" family with a 140x80 viewBox`, () => {
      const { container } = render(<ExposureHelpSchematic schematic={id} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 140 80");
      expect(svg?.getAttribute("aria-hidden")).not.toBeNull();
    });
  }
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
cd web && npx vitest run src/components/exposure/ExposureHelpSchematic.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureHelpSchematic.tsx`**

```tsx
import type { ExposureSchematicId } from "./exposureHelpCopy";

/* ─── Inline schematics for the exposure-side help cards ──────────────────
 *
 * Five family illustrations matching the exposure register. All
 * 140×80 px viewBox, primary stroke at 80 % opacity over a faint
 * border background — same conventions as StabilityHelpSchematic so
 * the two card stacks read as a family.
 *
 *   dot_pitch     → discrete dots along a horizontal line
 *   line_pitch    → stacked parallel hatch lines
 *   pulse_shape   → one pulse waveform with area + peak markers
 *   accumulation  → multiple overlapping passes building density
 *   combination   → two-arrow split (multiplicative or ratio)
 */

const VB_W = 140;
const VB_H = 80;
const STROKE = "var(--color-primary)";
const STROKE_OP = 0.8;
const FAINT = "var(--color-border)";
const LABEL = "var(--color-ink-subtle)";

export const EXPOSURE_SCHEMATIC_IDS: readonly ExposureSchematicId[] = [
  "dot_pitch",
  "line_pitch",
  "pulse_shape",
  "accumulation",
  "combination",
];

interface Props {
  schematic: ExposureSchematicId;
}

export function ExposureHelpSchematic({ schematic }: Props) {
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width="140"
      height="80"
      className="block"
      aria-hidden
    >
      <rect
        x={0.5}
        y={0.5}
        width={VB_W - 1}
        height={VB_H - 1}
        rx={4}
        ry={4}
        fill="transparent"
        stroke={FAINT}
        strokeOpacity={0.6}
      />
      {renderBody(schematic)}
    </svg>
  );
}

function renderBody(id: ExposureSchematicId) {
  switch (id) {
    case "dot_pitch":    return <DotPitch />;
    case "line_pitch":   return <LinePitch />;
    case "pulse_shape":  return <PulseShape />;
    case "accumulation": return <Accumulation />;
    case "combination":  return <Combination />;
  }
}

function DotPitch() {
  // Six evenly-spaced dots along a horizontal line, with the gap labelled.
  const cy = 42;
  const dx = 18;
  const x0 = 22;
  return (
    <g>
      <line
        x1={x0 - 6}
        y1={cy}
        x2={x0 + dx * 5 + 6}
        y2={cy}
        stroke={FAINT}
        strokeWidth={1}
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle
          key={i}
          cx={x0 + i * dx}
          cy={cy}
          r={3}
          fill={STROKE}
          fillOpacity={STROKE_OP}
        />
      ))}
      <line
        x1={x0}
        y1={cy + 12}
        x2={x0 + dx}
        y2={cy + 12}
        stroke={STROKE}
        strokeOpacity={STROKE_OP}
        strokeWidth={1}
      />
      <text
        x={x0 + dx / 2}
        y={cy + 24}
        fontFamily="var(--font-mono)"
        fontSize={9}
        fill={LABEL}
        textAnchor="middle"
        letterSpacing="0.16em"
      >
        SPACING
      </text>
    </g>
  );
}

function LinePitch() {
  // Five horizontal hatch lines with vertical pitch labelled.
  const x0 = 22;
  const x1 = 118;
  const y0 = 18;
  const dy = 11;
  return (
    <g>
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={x0}
          y1={y0 + i * dy}
          x2={x1}
          y2={y0 + i * dy}
          stroke={STROKE}
          strokeOpacity={STROKE_OP}
          strokeWidth={1.5}
        />
      ))}
      <text
        x={70}
        y={75}
        fontFamily="var(--font-mono)"
        fontSize={9}
        fill={LABEL}
        textAnchor="middle"
        letterSpacing="0.16em"
      >
        LINE PITCH
      </text>
    </g>
  );
}

function PulseShape() {
  // A single pulse: triangle with shaded area plus a peak dot.
  const baseY = 56;
  const peakX = 70;
  const peakY = 18;
  const w = 28;
  const path = `M ${peakX - w} ${baseY} L ${peakX} ${peakY} L ${peakX + w} ${baseY} Z`;
  return (
    <g>
      <line
        x1={20}
        y1={baseY}
        x2={120}
        y2={baseY}
        stroke={FAINT}
        strokeWidth={1}
      />
      <path d={path} fill={STROKE} fillOpacity={0.18} stroke={STROKE} strokeOpacity={STROKE_OP} strokeWidth={1.5} />
      <circle cx={peakX} cy={peakY} r={2.5} fill={STROKE} fillOpacity={STROKE_OP} />
      <text
        x={70}
        y={75}
        fontFamily="var(--font-mono)"
        fontSize={9}
        fill={LABEL}
        textAnchor="middle"
        letterSpacing="0.16em"
      >
        ENERGY · PEAK
      </text>
    </g>
  );
}

function Accumulation() {
  // Three stacked, overlapping rectangles of increasing fill — passes
  // building density.
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={28 + i * 14}
          y={20 + i * 4}
          width={70}
          height={30 - i * 4}
          rx={2}
          ry={2}
          fill={STROKE}
          fillOpacity={0.18 + i * 0.18}
          stroke={STROKE}
          strokeOpacity={STROKE_OP}
          strokeWidth={1}
        />
      ))}
      <text
        x={70}
        y={75}
        fontFamily="var(--font-mono)"
        fontSize={9}
        fill={LABEL}
        textAnchor="middle"
        letterSpacing="0.16em"
      >
        PASSES STACK
      </text>
    </g>
  );
}

function Combination() {
  // Two arrows: one horizontal (dose), one vertical (intensity), meeting
  // at a node — visualises the product/ratio combination.
  const cx = 70;
  const cy = 42;
  return (
    <g>
      {/* horizontal arrow */}
      <line x1={26} y1={cy} x2={cx - 4} y2={cy} stroke={STROKE} strokeOpacity={STROKE_OP} strokeWidth={1.5} />
      <polygon
        points={`${cx - 4},${cy - 4} ${cx},${cy} ${cx - 4},${cy + 4}`}
        fill={STROKE}
        fillOpacity={STROKE_OP}
      />
      {/* vertical arrow */}
      <line x1={cx} y1={70} x2={cx} y2={cy + 4} stroke={STROKE} strokeOpacity={STROKE_OP} strokeWidth={1.5} />
      <polygon
        points={`${cx - 4},${cy + 4} ${cx},${cy} ${cx + 4},${cy + 4}`}
        fill={STROKE}
        fillOpacity={STROKE_OP}
      />
      <circle cx={cx} cy={cy} r={3.5} fill={STROKE} fillOpacity={STROKE_OP} />
      <text
        x={42}
        y={cy - 6}
        fontFamily="var(--font-mono)"
        fontSize={8}
        fill={LABEL}
        letterSpacing="0.16em"
      >
        DOSE
      </text>
      <text
        x={cx + 4}
        y={66}
        fontFamily="var(--font-mono)"
        fontSize={8}
        fill={LABEL}
        letterSpacing="0.16em"
      >
        INTENSITY
      </text>
    </g>
  );
}
```

- [ ] **Step 4: Run test and verify it passes**

```bash
cd web && npx vitest run src/components/exposure/ExposureHelpSchematic.test.tsx
```

Expected: PASS — all 6 cases (1 export check + 5 family renders).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureHelpSchematic.tsx \
        web/src/components/exposure/ExposureHelpSchematic.test.tsx
git commit -m "feat(exposure): five-family help schematic SVGs

dot_pitch, line_pitch, pulse_shape, accumulation, combination — same
140×80 viewBox and stroke conventions as StabilityHelpSchematic so the
two card stacks read as a family.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `ExposureHelpCardBody.tsx` — three body components

**Files:**
- Create: `web/src/components/exposure/ExposureHelpCardBody.tsx`
- Create: `web/src/components/exposure/ExposureHelpCardBody.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureHelpCardBody.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  IndexCardBody,
  ChannelCardBody,
  RawParamCardBody,
} from "./ExposureHelpCardBody";
import {
  EXPOSURE_INDEX_HELP,
  EXPOSURE_CHANNEL_HELP,
  EXPOSURE_RAW_PARAM_HELP,
} from "./exposureHelpCopy";

describe("IndexCardBody", () => {
  it("shows heading, unit, definition, guide, formula, and inputs", () => {
    const help = EXPOSURE_INDEX_HELP.total_exposure_index;
    render(<IndexCardBody help={help} />);
    expect(screen.getByText(help.heading)).toBeTruthy();
    expect(screen.getByText(help.unit)).toBeTruthy();
    expect(screen.getByText(help.definition)).toBeTruthy();
    expect(screen.getByText(help.guide)).toBeTruthy();
    expect(screen.getByText(help.formula)).toBeTruthy();
    for (const input of help.inputs) {
      // input rows render `name · unit` so query by the name only.
      expect(screen.getAllByText(new RegExp(input.name)).length).toBeGreaterThan(0);
    }
  });
});

describe("ChannelCardBody", () => {
  it("shows heading + definition + guide and omits formula/inputs", () => {
    const help = EXPOSURE_CHANNEL_HELP.L;
    const { container } = render(<ChannelCardBody help={help} />);
    expect(screen.getByText(help.heading)).toBeTruthy();
    expect(screen.getByText(help.definition)).toBeTruthy();
    expect(screen.getByText(help.guide)).toBeTruthy();
    expect(container.textContent).not.toMatch(/INPUTS/i);
    expect(container.textContent).not.toMatch(/FORMULA/i);
  });
});

describe("RawParamCardBody", () => {
  it("shows heading, unit, and definition only", () => {
    const help = EXPOSURE_RAW_PARAM_HELP.power;
    const { container } = render(<RawParamCardBody help={help} />);
    expect(screen.getByText(help.heading)).toBeTruthy();
    expect(screen.getByText(help.unit)).toBeTruthy();
    expect(screen.getByText(help.definition)).toBeTruthy();
    // No schematic SVG in this variant.
    expect(container.querySelector("svg")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
cd web && npx vitest run src/components/exposure/ExposureHelpCardBody.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureHelpCardBody.tsx`**

```tsx
import type {
  ExposureChannelHelp,
  ExposureIndexHelp,
  ExposureRawParamHelp,
} from "./exposureHelpCopy";
import { ExposureHelpSchematic } from "./ExposureHelpSchematic";
import { StabilityHelpSchematic } from "../StabilityHelpSchematic";

const CARD_WIDTH = 340;

function HeaderStrip({
  heading,
  unit,
}: {
  heading: string;
  unit?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
        {heading}
      </div>
      {unit ? (
        <span
          className="font-mono text-[8.5px] tracking-[0.18em] uppercase px-1.5 py-0.5 rounded-sm border border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]"
        >
          {unit}
        </span>
      ) : null}
    </div>
  );
}

function DefinitionGuide({
  definition,
  guide,
}: {
  definition: string;
  guide: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 min-w-0 flex-1">
      <div className="flex flex-col gap-1">
        <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          Definition
        </div>
        <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink)] m-0">
          {definition}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          How to read it
        </div>
        <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink-muted)] m-0">
          {guide}
        </p>
      </div>
    </div>
  );
}

export function IndexCardBody({ help }: { help: ExposureIndexHelp }) {
  return (
    <div
      className="px-3.5 py-3 flex flex-col gap-3"
      style={{ width: CARD_WIDTH }}
    >
      <HeaderStrip heading={help.heading} unit={help.unit} />

      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <ExposureHelpSchematic schematic={help.schematic} />
        </div>
        <DefinitionGuide definition={help.definition} guide={help.guide} />
      </div>

      <div className="flex flex-col gap-1.5 pt-1 border-t border-[color:var(--color-border)]">
        <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          Formula
        </div>
        <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink)] m-0">
          {help.formula}
        </p>
        <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)] mt-1">
          Inputs
        </div>
        <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
          {help.inputs.map((i) => (
            <li
              key={i.name}
              className="font-mono text-[10.5px] leading-relaxed text-[color:var(--color-ink-muted)]"
            >
              {i.name} · {i.unit}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ChannelCardBody({ help }: { help: ExposureChannelHelp }) {
  return (
    <div
      className="px-3.5 py-3 flex flex-col gap-3"
      style={{ width: CARD_WIDTH }}
    >
      <HeaderStrip heading={help.heading} />
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <StabilityHelpSchematic schematic={help.schematic} />
        </div>
        <DefinitionGuide definition={help.definition} guide={help.guide} />
      </div>
    </div>
  );
}

export function RawParamCardBody({ help }: { help: ExposureRawParamHelp }) {
  return (
    <div
      className="px-3.5 py-3 flex flex-col gap-2"
      style={{ width: CARD_WIDTH }}
    >
      <HeaderStrip heading={help.heading} unit={help.unit} />
      <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink)] m-0">
        {help.definition}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test and verify it passes**

```bash
cd web && npx vitest run src/components/exposure/ExposureHelpCardBody.test.tsx
```

Expected: PASS for all three describes.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureHelpCardBody.tsx \
        web/src/components/exposure/ExposureHelpCardBody.test.tsx
git commit -m "feat(exposure): three-variant help-card body components

IndexCardBody (full), ChannelCardBody (no formula/inputs),
RawParamCardBody (heading + unit + definition only). Header strip
and definition+guide blocks are shared so the card stack reads
consistently across variants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `ExposureCorrelationMatrix` — add `renderRowLabel` render prop

We don't want to couple the matrix to the help-card variants; the page owns that decision. Add an optional render prop.

**Files:**
- Modify: `web/src/components/exposure/ExposureCorrelationMatrix.tsx`
- Modify: `web/src/components/exposure/ExposureCorrelationMatrix.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/exposure/ExposureCorrelationMatrix.test.tsx`:

```tsx
  it("invokes renderRowLabel for each row when supplied, with rowKey + label", () => {
    const rendered: { rowKey: string; label: string }[] = [];
    render(
      <ExposureCorrelationMatrix<IndexRow>
        matrix={matrix}
        rowKeys={INDEX_ROWS}
        rowLabels={INDEX_ROW_LABELS}
        selectedRowKey="total_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
        renderRowLabel={(rowKey, label) => {
          rendered.push({ rowKey, label });
          return <span data-testid={`hooked-${rowKey}`}>{label}</span>;
        }}
      />,
    );
    expect(rendered).toHaveLength(7);
    expect(rendered.map((r) => r.rowKey)).toEqual([...INDEX_ROWS]);
  });
```

- [ ] **Step 2: Run test and verify it fails**

```bash
cd web && npx vitest run src/components/exposure/ExposureCorrelationMatrix.test.tsx
```

Expected: FAIL — `renderRowLabel` prop unrecognised.

- [ ] **Step 3: Add the prop and use it**

In `web/src/components/exposure/ExposureCorrelationMatrix.tsx`:

Add to `Props<RowKey>`:

```ts
  /** Optional override for how a row's label is rendered. Defaults
   *  to a plain styled <div>. Receives the rowKey and the resolved
   *  label string from rowLabels. */
  renderRowLabel?: (rowKey: RowKey, label: string) => React.ReactNode;
```

Replace the existing row-label `<div>` (the `data-role="row-label"` div around `{rowLabels[idx]}`) with:

```tsx
            <div
              data-role="row-label"
              className={[
                "text-[10px] uppercase tracking-[0.16em] pr-2 self-center text-right",
                idx === selectedRowKey
                  ? "text-[color:var(--color-primary)] font-semibold"
                  : "text-[color:var(--color-ink-subtle)]",
              ].join(" ")}
            >
              {renderRowLabel
                ? renderRowLabel(idx, rowLabels[idx])
                : rowLabels[idx]}
            </div>
```

Add `renderRowLabel` to the destructured `Props` argument list.

- [ ] **Step 4: Run test and verify it passes**

```bash
cd web && npx vitest run src/components/exposure/ExposureCorrelationMatrix.test.tsx
```

Expected: PASS for all (existing + new).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureCorrelationMatrix.tsx \
        web/src/components/exposure/ExposureCorrelationMatrix.test.tsx
git commit -m "feat(exposure): renderRowLabel render-prop on correlation matrix

Lets the call-site wrap row labels in HelpTip without baking the help
data into the matrix itself.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire `HelpTip` into the matrix row labels (page level)

`ExposurePage` mounts both matrix variants. Supply `renderRowLabel` on each.

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Wire the index-matrix labels**

Near the top of `web/src/pages/ExposurePage.tsx`, alongside the other exposure imports, add:

```tsx
import { HelpTip } from "../components/HelpTip";
import {
  EXPOSURE_INDEX_HELP,
  EXPOSURE_CHANNEL_HELP,
  EXPOSURE_RAW_PARAM_HELP,
} from "../components/exposure/exposureHelpCopy";
import {
  IndexCardBody,
  ChannelCardBody,
  RawParamCardBody,
} from "../components/exposure/ExposureHelpCardBody";
```

In the JSX where the index `ExposureCorrelationMatrix` is rendered (around line 648), add the prop:

```tsx
                      <ExposureCorrelationMatrix<IndexRow>
                        matrix={correlationMatrix}
                        rowKeys={INDEX_ROWS}
                        rowLabels={INDEX_LABELS_MATRIX}
                        selectedRowKey={xKey}
                        selectedChannel={mode === "univariate" ? yKeyUni : "L"}
                        onSelect={(idx, ch) => {
                          setXKey(idx);
                          if (mode === "univariate") setYKeyUni(ch);
                        }}
                        renderRowLabel={(rowKey, label) => (
                          <HelpTip
                            help={EXPOSURE_INDEX_HELP[rowKey]}
                            Body={IndexCardBody}
                          >
                            <span className="cursor-help">{label}</span>
                          </HelpTip>
                        )}
                      />
```

- [ ] **Step 2: Wire the raw-param-matrix labels**

In the `else` branch (raw-param matrix), add the same prop with the raw-param card:

```tsx
                      <ExposureCorrelationMatrix<RawParamRow>
                        matrix={correlationMatrix}
                        rowKeys={RAW_PARAM_ROWS}
                        rowLabels={RAW_PARAM_LABELS}
                        selectedRowKey={null}
                        selectedChannel={null}
                        onSelect={null}
                        renderRowLabel={(rowKey, label) => (
                          <HelpTip
                            help={EXPOSURE_RAW_PARAM_HELP[rowKey]}
                            Body={RawParamCardBody}
                          >
                            <span className="cursor-help">{label}</span>
                          </HelpTip>
                        )}
                      />
```

- [ ] **Step 3: Run all tests**

```bash
cd web && npx vitest run
```

Expected: PASS for the entire web test suite.

- [ ] **Step 4: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ExposurePage.tsx
git commit -m "feat(exposure): hover help cards on correlation matrix row labels

Both matrix variants (indices, raw params) now expose definitions on
hover. Row labels keep their cryptic 3-letter abbreviations (TEx, AAg,
…) but get a discoverability path via the HelpTip render-prop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire `HelpTip` into the left-rail axis pickers

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Wrap the X-axis picker buttons**

Locate the X-axis picker block (around line 402 in `ExposurePage.tsx`):

```tsx
              {INDEX_ROWS.map((k) => (
                <RailPickerButton
                  key={k}
                  active={k === xKey}
                  onClick={() => setXKey(k)}
                  small
                >
                  {INDEX_LABELS[k]}
                </RailPickerButton>
              ))}
```

Replace with:

```tsx
              {INDEX_ROWS.map((k) => (
                <HelpTip
                  key={k}
                  help={EXPOSURE_INDEX_HELP[k]}
                  Body={IndexCardBody}
                >
                  <RailPickerButton
                    active={k === xKey}
                    onClick={() => setXKey(k)}
                    small
                  >
                    {INDEX_LABELS[k]}
                  </RailPickerButton>
                </HelpTip>
              ))}
```

- [ ] **Step 2: Wrap the Y-axis picker buttons (both variants)**

Locate the Y-axis picker block (around line 427):

```tsx
              {mode === "univariate"
                ? CHANNEL_COLS.map((k) => (
                    <RailPickerButton
                      key={k}
                      active={k === yKeyUni}
                      onClick={() => setYKeyUni(k)}
                      small
                    >
                      {CHANNEL_LABELS[k]}
                    </RailPickerButton>
                  ))
                : INDEX_ROWS.map((k) => (
                    <RailPickerButton
                      key={k}
                      active={k === yKeyBi}
                      onClick={() => setYKeyBi(k)}
                      small
                    >
                      {INDEX_LABELS[k]}
                    </RailPickerButton>
                  ))}
```

Replace with:

```tsx
              {mode === "univariate"
                ? CHANNEL_COLS.map((k) => (
                    <HelpTip
                      key={k}
                      help={EXPOSURE_CHANNEL_HELP[k]}
                      Body={ChannelCardBody}
                    >
                      <RailPickerButton
                        active={k === yKeyUni}
                        onClick={() => setYKeyUni(k)}
                        small
                      >
                        {CHANNEL_LABELS[k]}
                      </RailPickerButton>
                    </HelpTip>
                  ))
                : INDEX_ROWS.map((k) => (
                    <HelpTip
                      key={k}
                      help={EXPOSURE_INDEX_HELP[k]}
                      Body={IndexCardBody}
                    >
                      <RailPickerButton
                        active={k === yKeyBi}
                        onClick={() => setYKeyBi(k)}
                        small
                      >
                        {INDEX_LABELS[k]}
                      </RailPickerButton>
                    </HelpTip>
                  ))}
```

- [ ] **Step 3: Run page tests**

```bash
cd web && npx vitest run src/pages/ExposurePage.test.tsx
```

Expected: PASS — wrapping in HelpTip is non-disruptive (the `<span>` wrapper preserves the underlying button's onClick, and the existing tests don't gate on absence of HelpTip).

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ExposurePage.tsx
git commit -m "feat(exposure): hover help cards on left-rail axis pickers

Both X and Y axis pickers now surface the same hover content as the
correlation matrix. Univariate Y uses the channel variant; bivariate Y
uses the index variant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Wire `HelpTip` into `PaletteIndicesChips`

**Files:**
- Modify: `web/src/components/PaletteIndicesChips.tsx`
- Modify: `web/src/components/PaletteIndicesChips.test.tsx`

- [ ] **Step 1: Add a regression test that the chips still render the same values**

Append to `web/src/components/PaletteIndicesChips.test.tsx`:

```tsx
import { fireEvent, screen, act } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe("PaletteIndicesChips hover help", () => {
  it("opens an exposure help card on chip hover", () => {
    const indices = {
      pulse_spacing_mm: 0.05,
      line_spacing_index: 0.083,
      line_spacing_mm: null,
      pulse_energy_index: 0.5,
      pulse_intensity_index: 0.0025,
      total_exposure_index: 6.0,
      ablation_aggression_index: 0.015,
      delivery_smoothness_index: 2400,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    };
    render(<PaletteIndicesChips indices={indices} />);
    fireEvent.pointerEnter(screen.getByText("Total exposure"));
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole("tooltip").textContent).toContain(
      "power × density × passes ÷ speed",
    );
  });
});
```

(If `PaletteIndicesChips.test.tsx` doesn't yet import `render`, add the import; if `PaletteIndicesChips` isn't already imported under that name, do that too.)

- [ ] **Step 2: Run test and verify it fails**

```bash
cd web && npx vitest run src/components/PaletteIndicesChips.test.tsx
```

Expected: FAIL — chips don't have hover-cards yet.

- [ ] **Step 3: Wrap each chip in HelpTip**

In `web/src/components/PaletteIndicesChips.tsx`:

Add at the top:

```tsx
import { HelpTip } from "./HelpTip";
import {
  EXPOSURE_INDEX_HELP,
} from "./exposure/exposureHelpCopy";
import { IndexCardBody } from "./exposure/ExposureHelpCardBody";
import type { IndexRow } from "./exposure/exposureCorrelations";
```

Build a small helper that maps each chip slot to its `IndexRow` key (line_spacing_mm has no help entry — it's a derived display, so it stays untouched):

```tsx
const CHIP_INDEX_KEY: Record<string, IndexRow | null> = {
  "Pulse spacing": "pulse_spacing_mm",
  "Line spacing index": "line_spacing_index",
  "Line spacing (mm)": null,
  "Pulse energy": "pulse_energy_index",
  "Pulse intensity": "pulse_intensity_index",
  "Total exposure": "total_exposure_index",
  "Ablation aggression": "ablation_aggression_index",
  "Delivery smoothness": "delivery_smoothness_index",
};
```

Wrap the existing `Chip` instances. The cleanest way is to introduce a thin `HelpfulChip` wrapper inline:

```tsx
const HelpfulChip: React.FC<ChipProps> = (props) => {
  const indexKey = CHIP_INDEX_KEY[props.label] ?? null;
  if (indexKey === null) return <Chip {...props} />;
  return (
    <HelpTip help={EXPOSURE_INDEX_HELP[indexKey]} Body={IndexCardBody}>
      <span className="contents">
        <Chip {...props} />
      </span>
    </HelpTip>
  );
};
```

Replace the eight `<Chip ... />` usages inside the `PaletteIndicesChips` component's grid with `<HelpfulChip ... />`. Leave the trailing `<div>` (the formula-version footer) as-is.

- [ ] **Step 4: Run test and verify it passes**

```bash
cd web && npx vitest run src/components/PaletteIndicesChips.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PaletteIndicesChips.tsx \
        web/src/components/PaletteIndicesChips.test.tsx
git commit -m "feat(palette): hover help cards on indices chips

The chips on test detail / palette pages now share the same hover
content as the exposure scatter and matrix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `ExposureScatter` — HTML axis labels with two-line layout + HelpTip

The largest single edit. We replace the SVG `<text>` axis titles with absolutely-positioned HTML overlays so they can host two lines of content and act as `HelpTip` triggers.

**Files:**
- Modify: `web/src/components/exposure/ExposureScatter.tsx`
- Modify: `web/src/components/exposure/ExposureScatter.test.tsx`

- [ ] **Step 1: Inspect the existing test and update its expectations**

Open `web/src/components/exposure/ExposureScatter.test.tsx` and find tests that query the X- or Y-axis title text (typically `getByText(/TOTAL EXPOSURE/)` or similar). Note them — they should keep passing because the text content is unchanged, only the host element type changes (SVG `<text>` → HTML `<div>`).

Append a new test that locks in the two-line layout and HelpTip wiring:

```tsx
import { fireEvent, act } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";

describe("ExposureScatter axis labels", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("renders the X-axis name and the words formula on a second line", () => {
    const rows = makeRows(); // existing test helper from this file
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="univariate"
        xKey="total_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
      />,
    );
    expect(container.textContent).toContain("TOTAL EXPOSURE");
    expect(container.textContent).toContain("power × density × passes ÷ speed");
  });

  it("opens the index help card when the X axis label is hovered", () => {
    const rows = makeRows();
    render(
      <ExposureScatter
        rows={rows}
        mode="univariate"
        xKey="total_exposure_index"
        yKey="L"
        xScale="linear"
        yScale="linear"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
      />,
    );
    const trigger = screen.getByText("TOTAL EXPOSURE");
    fireEvent.pointerEnter(trigger);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole("tooltip").textContent).toContain(
      "power × density × passes ÷ speed",
    );
  });
});
```

(If `makeRows`, `render`, or `screen` aren't already imported in this test file, add them. If `makeRows` doesn't exist, build a minimal stub: `function makeRows(): readonly ExposureRow[] { return [{ id: 1, hex: "#000", lab: [50, 0, 0], indices: { total_exposure_index: 5, ... full LaserIndices }, params: {}, test_id: null }]; }` — fill all required `LaserIndices` fields with finite numbers.)

- [ ] **Step 2: Run the new tests and verify they fail**

```bash
cd web && npx vitest run src/components/exposure/ExposureScatter.test.tsx
```

Expected: the two new tests FAIL (no second-line content, no tooltip on hover).

- [ ] **Step 3: Refactor `ExposureScatter.tsx`**

Apply the following edits to `web/src/components/exposure/ExposureScatter.tsx`:

A. Add imports near the top:

```tsx
import { HelpTip } from "../HelpTip";
import {
  EXPOSURE_INDEX_HELP,
  EXPOSURE_CHANNEL_HELP,
  type ExposureChannelHelp,
  type ExposureIndexHelp,
} from "./exposureHelpCopy";
import {
  ChannelCardBody,
  IndexCardBody,
} from "./ExposureHelpCardBody";
```

B. Below the existing `xLabel` / `yLabel` helpers, add resolvers for the help payload + body:

```tsx
function xHelp(key: IndexRow): ExposureIndexHelp {
  return EXPOSURE_INDEX_HELP[key];
}

function yHelpIndex(key: IndexRow): ExposureIndexHelp {
  return EXPOSURE_INDEX_HELP[key];
}

function yHelpChannel(key: ChannelCol): ExposureChannelHelp {
  return EXPOSURE_CHANNEL_HELP[key];
}
```

C. Reduce `PADB` so the SVG no longer reserves space for a second axis line that's now in the overlay. Change:

```ts
const PADB = 60;
```

to:

```ts
const PADB = 36;
```

D. Remove the existing SVG axis-title `<text>` blocks (the two `<text>` elements at the bottom of the returned `<svg>` — currently in the `Axis titles — instrument register` comment block, lines ~408–433). Delete both of them.

E. Wrap the returned `<svg>` in a `position: relative` `<div>` and append the two HTML overlays after the SVG. The replacement of the JSX returned by `ExposureScatter` looks like (pseudocode showing only the wrapping diff — keep the full SVG body and props from the existing implementation):

```tsx
  const xLabelTop = INDEX_PRETTY[xKey];
  const xFormula = EXPOSURE_INDEX_HELP[xKey].formula;
  const yIsChannel = mode === "univariate";
  const yLabelTop = yIsChannel
    ? CHANNEL_PRETTY[yKey as ChannelCol]
    : INDEX_PRETTY[yKey as IndexRow];
  const yFormula = yIsChannel
    ? null
    : EXPOSURE_INDEX_HELP[yKey as IndexRow].formula;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto"
        aria-label="exposure scatter"
      >
        {/* existing body — dots, axis lines, ticks, family trace, halo, regression — unchanged */}
      </svg>

      {/* X axis label overlay — two lines */}
      <HelpTip help={xHelp(xKey)} Body={IndexCardBody}>
        <div
          className="absolute left-0 right-0 bottom-0 flex flex-col items-center pointer-events-auto cursor-help"
          style={{ paddingBottom: 4 }}
        >
          <div className="font-mono uppercase tracking-[0.18em] text-[10px] font-semibold text-[color:var(--color-ink-subtle)]">
            {xScale === "log" ? `LOG₁₀ ${xLabelTop}` : xLabelTop}
          </div>
          <div className="font-mono text-[9px] text-[color:var(--color-ink-subtle)] opacity-70">
            {xFormula}
          </div>
        </div>
      </HelpTip>

      {/* Y axis label overlay — rotated, two lines */}
      <HelpTip
        help={yIsChannel ? yHelpChannel(yKey as ChannelCol) : yHelpIndex(yKey as IndexRow)}
        Body={yIsChannel ? ChannelCardBody : IndexCardBody}
      >
        <div
          className="absolute left-1 top-0 bottom-0 flex items-center pointer-events-auto cursor-help"
          style={{ width: 24 }}
        >
          <div
            className="flex flex-col items-center"
            style={{ transform: "rotate(-90deg)", transformOrigin: "center", whiteSpace: "nowrap" }}
          >
            <div className="font-mono uppercase tracking-[0.18em] text-[10px] font-semibold text-[color:var(--color-ink-subtle)]">
              {yScale === "log" ? `LOG₁₀ ${yLabelTop}` : yLabelTop}
            </div>
            {yFormula ? (
              <div className="font-mono text-[9px] text-[color:var(--color-ink-subtle)] opacity-70">
                {yFormula}
              </div>
            ) : null}
          </div>
        </div>
      </HelpTip>
    </div>
  );
```

F. Inside the SVG, also raise `PADL` from 64 to 72 if needed so the rotated Y label doesn't overlap the leftmost ticks. Adjust by trial: open the dev server (Task 12) and visually verify alignment; if labels collide, bump `PADL` by 8 and re-test.

- [ ] **Step 4: Run scatter tests**

```bash
cd web && npx vitest run src/components/exposure/ExposureScatter.test.tsx
```

Expected: PASS for the new and existing tests.

- [ ] **Step 5: Run typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/ExposureScatter.tsx \
        web/src/components/exposure/ExposureScatter.test.tsx
git commit -m "feat(exposure): two-line axis labels with hover help cards

Axis titles move from SVG <text> to HTML overlays inside a relative
wrapper. Two lines: the existing index/channel name on top, the
plain-words formula on a quieter second line. Each label hosts a
HelpTip triggering the matching IndexCardBody / ChannelCardBody.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full build + browser verification

The TypeScript test suite verifies correctness, not feature behaviour. Per CLAUDE.md, run a real-browser pass before declaring done.

- [ ] **Step 1: Full vitest run**

```bash
cd web && npm test
```

Expected: PASS for all suites.

- [ ] **Step 2: Build into `web/dist/`**

```bash
cd web && npm run build > /dev/null 2>&1
```

Expected: build succeeds (exit 0). The backend serves `web/dist/` directly; without this step the page loads the previous bundle.

- [ ] **Step 3: Start the dev server**

```bash
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017
```

Expected: server starts, prints `Uvicorn running on http://127.0.0.1:8017`.

- [ ] **Step 4: Browser walk-through**

Open `http://127.0.0.1:8017/#/exposure` in a real browser and verify:

1. Pick a material with palette entries.
2. The X axis shows `TOTAL EXPOSURE` on top and `power × density × passes ÷ speed` underneath.
3. Hover the X axis label — after ~450 ms a card appears with heading, schematic, definition, "How to read it", formula, and inputs list.
4. Move into the card; it stays open.
5. Switch to bivariate mode; the Y axis now also shows a formula sub-line (`pulse intensity` etc.).
6. Hover an axis picker pill in the left rail; the same card appears.
7. In univariate mode, hover a CIELab Y-axis picker (`L*`); a thinner card appears (no formula/inputs block).
8. Hover the `TEx`, `AAg`, `DSm` row labels in the indices correlation matrix — full index cards appear.
9. Click "Raw params" toggle; hover `PWR`, `SPD`, etc. — light-variant cards (heading + unit chip + one-line definition).
10. Open the test detail page for any palette entry. Hover the `Total exposure` chip — full index card.
11. Press `Esc` — the open card closes.

If any of the above fails, fix in place before continuing.

- [ ] **Step 5: Stop the dev server**

`Ctrl-C` in the server terminal.

---

### Task 12: Changelog entry (major)

A user-visible feature — the page genuinely changes shape. Per CLAUDE.md this needs a major entry with a screenshot.

**Files:**
- Create: `changelog/2026-05-09-exposure-formula-affordances.md`
- Optional: `changelog/images/exposure-formula-card.png`

- [ ] **Step 1: Take a screenshot of the new hover card**

While the dev server is running (or restart per Task 11), capture an image of the exposure page with a help card open over the scatter. Save to `changelog/images/exposure-formula-card.png`.

If a screenshot pass isn't available right now, omit the `images:` block and the file reference; copy can ship without an image and a follow-up commit can add one.

- [ ] **Step 2: Author the changelog entry**

Create `changelog/2026-05-09-exposure-formula-affordances.md`:

```markdown
---
id: 2026-05-09-exposure-formula-affordances
date: 2026-05-09
level: major
title: Exposure — formula affordances and hover help cards
summary: Every index now shows its formula on the chart and reveals a definition card on hover.
images:
  - src: exposure-formula-card.png
    caption: A hover card explaining Total Exposure, with formula and inputs.
---

The exposure page used to assume you knew what `Total exposure` and
`Ablation aggression` were. Now it tells you.

Every scatter axis carries a two-line label: the index name on top,
the formula in plain words underneath — `power × density × passes ÷
speed`, not `P × D × R / S`. Hover the axis (or any of the axis
picker pills, palette indices chips, or correlation matrix row
labels) and a card appears with the index's definition, a small
schematic, the formula, the inputs (with units), and a few sentences
on how to read it.

The card matches the stability page's register, because that's
already how you learn what a metric means in this tool.
```

- [ ] **Step 3: Commit**

```bash
git add changelog/2026-05-09-exposure-formula-affordances.md \
        changelog/images/exposure-formula-card.png
git commit -m "changelog: exposure formula affordances + hover help cards

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Drop the `changelog/images/...` arg if no screenshot was captured.)

---

### Task 13: Final pre-PR checks

- [ ] **Step 1: Full backend + frontend test run**

```bash
uv run --active pytest tests/ -q
cd web && npm test
```

Expected: both PASS.

- [ ] **Step 2: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Build**

```bash
cd web && npm run build > /dev/null 2>&1
```

Expected: build succeeds.

- [ ] **Step 4: Push branch**

```bash
git push
```

Expected: pushes to `feat/exposure-indices-exploration` (or successor branch).

- [ ] **Step 5: PR readiness**

Decide whether to bundle into existing PR #79 (still open) or open a new branch + PR. If bundling: PR #79 already covers phase 2.5a/b plus fixes; this affordance work is a natural follow-up but doubles the PR's surface. **Recommended:** open a new branch off the current head (`feat/exposure-formula-affordances`), open PR #80 against it. Confirm with the user before pushing.

---

## Self-review

**Spec coverage:**
- Two-line axis labels (always-visible) → Task 10. ✓
- Generic HelpTip refactor → Tasks 1, 2. ✓
- Three card-body variants → Task 5. ✓
- 7 index + 5 channel + 6 raw-param copy → Task 3. ✓
- Five-family schematic library → Task 4. ✓
- Trigger sites: scatter axes (Task 10), rail pickers (Task 8), matrix row labels (Tasks 6, 7), palette chips (Task 9). ✓
- Tests: every new module has a test task. ✓
- Files-touched list: every entry mapped to a task. ✓
- Browser verification step → Task 11. ✓
- Changelog entry → Task 12. ✓

**Placeholders:** No `TBD`/`TODO`. The `makeRows` test helper is described concretely. Screenshot is marked optional with explicit fallback.

**Type consistency:** `ExposureSchematicId` declared in Task 3, used in Task 4. `ExposureIndexHelp` / `ExposureChannelHelp` / `ExposureRawParamHelp` declared in Task 3, used in Task 5 and onwards. `IndexRow` / `ChannelCol` / `RawParamRow` are existing exports from `exposureCorrelations.ts`. The `renderRowLabel` prop signature in Task 6 matches its usage in Task 7. The shim re-export in Task 2 keeps stability's public type stable.
