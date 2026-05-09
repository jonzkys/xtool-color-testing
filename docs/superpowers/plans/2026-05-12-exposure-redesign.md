# Exposure Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the exposure page on top of PR #82 — delete the left rail, move material/axis controls into a top toolbar (with the SVG axis labels also click-to-open the same picker), make the filter panel an on-demand column between chart and right rail, collapse the right rail back to one column with a redesigned six-tile + detail-card neighbours panel, and add per-row filter buttons to the focused recipe.

**Architecture:** Five new components (`ExposureToolbar`, `ExposureAxisPicker`, `ExposureNeighboursStrip`, `ExposureNeighbourDetail`, plus `recipeDelta` pure helper) + targeted edits to four existing files. State machinery (ActiveFilters reducer, applyFilters, URL sync) is unchanged from PR #82 — this is a layout/presentation pass.

**Tech Stack:** React 18 + TypeScript + Tailwind v4 + vitest + @testing-library/react. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-12-exposure-redesign-design.md`

**Branch hygiene:** This plan executes on `feat/exposure-redesign`, branched off `feat/exposure-rail-filters`. Once PR #82 merges, rebase onto main.

---

## File structure

**New (web/src/components/exposure/):**
- `recipeDelta.ts` — pure helper computing per-param deltas between focused row and a neighbour.
- `ExposureAxisPicker.tsx` — popover content (radio list + log toggle). Used from two trigger sites.
- `ExposureToolbar.tsx` — top toolbar (Material `<select>` + Mode toggle + X/Y axis pills + Filters button).
- `ExposureNeighboursStrip.tsx` — six-tile horizontal swatch strip with selection state lifted to props.
- `ExposureNeighbourDetail.tsx` — detail card showing recipe deltas + Jump-to / Filter-from action buttons.
- Tests for each of the above.

**Modified:**
- `web/src/components/exposure/ExposureFocusedCard.tsx` — recipe rows gain per-row filter buttons + active-tint background.
- `web/src/components/exposure/ExposureNeighboursPanel.tsx` — internal list rendering replaced by strip + detail; sort toggle preserved.
- `web/src/components/exposure/ExposureScatter.tsx` — SVG X/Y axis labels become click-to-open triggers for `ExposureAxisPicker`.
- `web/src/pages/ExposurePage.tsx` — drop left rail; mount toolbar; restructure body row; collapse right rail to single column; conditional filter panel; new callbacks for per-row + filter-from-recipe.

**Modified — changelog:**
- `changelog/2026-05-13-exposure-redesign.md`.

---

### Task 1: `recipeDelta.ts` — pure helper

Pure function that computes per-param deltas between two `ExposureRow`s. Used by `ExposureNeighbourDetail` for the inline `+5%` / `-5%` / `+1` annotations.

**Files:**
- Create: `web/src/components/exposure/recipeDelta.ts`
- Create: `web/src/components/exposure/recipeDelta.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/exposure/recipeDelta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { recipeDelta } from "./recipeDelta";
import type { ExposureRow } from "./exposureCorrelations";

function row(params: Record<string, number | string>): ExposureRow {
  return {
    id: 0, hex: "#000", lab: [0, 0, 0],
    indices: {
      pulse_spacing_mm: 0, line_spacing_mm: 0,
      pulse_energy_index: 0, pulse_intensity_index: 0,
      total_exposure_index: 0, ablation_aggression_index: 0,
      delivery_smoothness_index: 0,
      formula_version: 3, density_model: "lpc",
      power_model: "controller_percent",
    },
    params,
  };
}

describe("recipeDelta", () => {
  it("returns null pct for identical values", () => {
    const a = row({ power: 14.6 });
    const b = row({ power: 14.6 });
    expect(recipeDelta(a, b, "power")).toEqual({
      value: 14.6, pct: 0, abs: 0,
    });
  });

  it("returns positive pct when neighbour is greater", () => {
    const a = row({ speed: 800 });
    const b = row({ speed: 840 });
    const d = recipeDelta(a, b, "speed");
    expect(d.value).toBe(840);
    expect(d.abs).toBe(40);
    expect(d.pct).toBeCloseTo(5, 1);
  });

  it("returns negative pct when neighbour is smaller", () => {
    const a = row({ frequency: 100 });
    const b = row({ frequency: 90 });
    const d = recipeDelta(a, b, "frequency");
    expect(d.pct).toBeCloseTo(-10, 1);
  });

  it("returns null pct when reference is 0", () => {
    const a = row({ passes: 0 });
    const b = row({ passes: 1 });
    const d = recipeDelta(a, b, "passes");
    expect(d.value).toBe(1);
    expect(d.abs).toBe(1);
    expect(d.pct).toBeNull();
  });

  it("returns null pct + null abs when neighbour value is missing", () => {
    const a = row({ power: 14.6 });
    const b = row({});
    const d = recipeDelta(a, b, "power");
    expect(d.value).toBeNull();
    expect(d.abs).toBeNull();
    expect(d.pct).toBeNull();
  });

  it("returns null pct + null abs when reference value is missing", () => {
    const a = row({});
    const b = row({ power: 14.6 });
    const d = recipeDelta(a, b, "power");
    expect(d.value).toBe(14.6);
    expect(d.abs).toBeNull();
    expect(d.pct).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/exposure/recipeDelta.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `recipeDelta.ts`**

```ts
import type { ExposureRow } from "./exposureCorrelations";
import type { FilterableParam } from "./exposureFilters";

export interface Delta {
  /** The neighbour's value of this param (null when missing). */
  value: number | null;
  /** Neighbour − reference, in raw units. NULL when either value is missing. */
  abs: number | null;
  /** Percentage delta vs reference (positive when neighbour is greater).
   *  NULL when reference is 0 or either value is missing. */
  pct: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function recipeDelta(
  reference: ExposureRow,
  neighbour: ExposureRow,
  param: FilterableParam,
): Delta {
  const ref = num(reference.params?.[param]);
  const val = num(neighbour.params?.[param]);
  if (val == null) return { value: null, abs: null, pct: null };
  if (ref == null) return { value: val, abs: null, pct: null };
  const abs = val - ref;
  const pct = ref === 0 ? null : (abs / ref) * 100;
  return { value: val, abs, pct };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/components/exposure/recipeDelta.test.ts
```

Expected: PASS for all 6 cases.

- [ ] **Step 5: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/recipeDelta.ts \
        web/src/components/exposure/recipeDelta.test.ts
git commit -m "$(cat <<'EOF'
feat(exposure): recipeDelta pure helper

Computes per-param deltas (value, abs, pct) between a reference row
and a neighbour. NULL-safe: handles missing values and zero
reference. Used by the upcoming ExposureNeighbourDetail to render
inline +5%/-10%/+1 annotations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ExposureAxisPicker.tsx` — popover content

The popover that lets a user change the X or Y axis. Used from two sites (toolbar pill, SVG axis label) so it lives as its own component.

**Files:**
- Create: `web/src/components/exposure/ExposureAxisPicker.tsx`
- Create: `web/src/components/exposure/ExposureAxisPicker.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `web/src/components/exposure/ExposureAxisPicker.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureAxisPicker } from "./ExposureAxisPicker";

describe("ExposureAxisPicker", () => {
  it("renders all 7 index options in bivariate mode", () => {
    render(
      <ExposureAxisPicker
        axis="x" mode="bivariate"
        currentKey="total_exposure_index" scale="log"
        onKeyChange={() => undefined}
        onScaleChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/Pulse Spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/Line Spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/Pulse Energy/i)).toBeInTheDocument();
    expect(screen.getByText(/Pulse Intensity/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Exposure/i)).toBeInTheDocument();
    expect(screen.getByText(/Ablation Aggression/i)).toBeInTheDocument();
    expect(screen.getByText(/Delivery Smoothness/i)).toBeInTheDocument();
  });

  it("renders 5 channel options when axis=y and mode=univariate", () => {
    render(
      <ExposureAxisPicker
        axis="y" mode="univariate"
        currentKey="L" scale="linear"
        onKeyChange={() => undefined}
        onScaleChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/L\*/)).toBeInTheDocument();
    expect(screen.getByText(/a\*/)).toBeInTheDocument();
    expect(screen.getByText(/b\*/)).toBeInTheDocument();
    expect(screen.getByText(/Hue/i)).toBeInTheDocument();
    expect(screen.getByText(/Chroma/i)).toBeInTheDocument();
  });

  it("calls onKeyChange when a different option is clicked", () => {
    const onKeyChange = vi.fn();
    render(
      <ExposureAxisPicker
        axis="x" mode="bivariate"
        currentKey="total_exposure_index" scale="log"
        onKeyChange={onKeyChange}
        onScaleChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText(/Pulse Energy Index/i));
    expect(onKeyChange).toHaveBeenCalledWith("pulse_energy_index");
  });

  it("calls onScaleChange when log toggle is clicked", () => {
    const onScaleChange = vi.fn();
    render(
      <ExposureAxisPicker
        axis="x" mode="bivariate"
        currentKey="total_exposure_index" scale="log"
        onKeyChange={() => undefined}
        onScaleChange={onScaleChange}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText(/log scale/i));
    expect(onScaleChange).toHaveBeenCalledWith("linear");
  });

  it("hides log toggle when picking a channel (univariate Y)", () => {
    render(
      <ExposureAxisPicker
        axis="y" mode="univariate"
        currentKey="L" scale="linear"
        onKeyChange={() => undefined}
        onScaleChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByLabelText(/log scale/i)).toBeNull();
  });

  it("calls onClose when Esc is pressed", () => {
    const onClose = vi.fn();
    render(
      <ExposureAxisPicker
        axis="x" mode="bivariate"
        currentKey="total_exposure_index" scale="log"
        onKeyChange={() => undefined}
        onScaleChange={() => undefined}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/exposure/ExposureAxisPicker.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureAxisPicker.tsx`**

```tsx
import { useEffect } from "react";
import {
  CHANNEL_COLS, INDEX_ROWS,
  type ChannelCol, type IndexRow,
} from "./exposureCorrelations";
import type { ScaleKind, ScatterMode } from "./ExposureScatter";

interface Props {
  axis: "x" | "y";
  mode: ScatterMode;
  currentKey: IndexRow | ChannelCol;
  scale: ScaleKind;
  onKeyChange: (k: IndexRow | ChannelCol) => void;
  onScaleChange: (s: ScaleKind) => void;
  onClose: () => void;
}

const INDEX_LABELS: Record<IndexRow, string> = {
  pulse_spacing_mm: "Pulse Spacing (mm)",
  line_spacing_mm: "Line Spacing (mm)",
  pulse_energy_index: "Pulse Energy Index",
  pulse_intensity_index: "Pulse Intensity Index",
  total_exposure_index: "Total Exposure",
  ablation_aggression_index: "Ablation Aggression",
  delivery_smoothness_index: "Delivery Smoothness",
};

const CHANNEL_LABELS: Record<ChannelCol, string> = {
  L: "L*",
  a: "a*",
  b: "b*",
  hue: "Hue°",
  chroma: "Chroma",
};

export function ExposureAxisPicker({
  axis, mode, currentKey, scale,
  onKeyChange, onScaleChange, onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Y axis in univariate mode shows channels; everywhere else shows indices.
  const showsChannels = axis === "y" && mode === "univariate";
  const options: { key: string; label: string }[] = showsChannels
    ? CHANNEL_COLS.map((k) => ({ key: k, label: CHANNEL_LABELS[k] }))
    : INDEX_ROWS.map((k) => ({ key: k, label: INDEX_LABELS[k] }));

  return (
    <div
      role="dialog"
      className="font-mono px-2 py-2 flex flex-col gap-1"
      style={{ width: 220 }}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[color:var(--color-ink-subtle)] mb-1">
        {axis.toUpperCase()} AXIS
      </div>
      <div className="flex flex-col gap-0.5">
        {options.map((opt) => {
          const active = opt.key === currentKey;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onKeyChange(opt.key as IndexRow | ChannelCol)}
              className={
                "text-left px-2 py-1 text-[10.5px] rounded-sm transition-colors " +
                (active
                  ? "bg-[color:var(--color-surface-elevated)] text-[color:var(--color-primary)] font-semibold border-l-2 border-[color:var(--color-primary)]"
                  : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]")
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {!showsChannels && (
        <label className="flex items-center gap-2 mt-1 px-2 py-1 text-[10.5px] border-t border-[color:var(--color-border)] pt-2">
          <input
            type="checkbox"
            checked={scale === "log"}
            onChange={(e) => onScaleChange(e.target.checked ? "log" : "linear")}
            aria-label="log scale"
          />
          log scale
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/exposure/ExposureAxisPicker.test.tsx
```

Expected: PASS for all 6 cases.

- [ ] **Step 5: Typecheck + commit**

```bash
cd web && npx tsc --noEmit
git add web/src/components/exposure/ExposureAxisPicker.tsx \
        web/src/components/exposure/ExposureAxisPicker.test.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): ExposureAxisPicker popover content

Radio list of seven indices (or five channels for univariate Y) plus
a log-scale checkbox (hidden for channels). Used by both the toolbar
X/Y pills and the SVG axis labels in ExposureScatter — same component,
two trigger sites. Esc closes; click outside is handled by the host
portal in the trigger.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `ExposureToolbar.tsx` — top toolbar

Material dropdown + Mode toggle + X/Y axis pills + Filters button.

**Files:**
- Create: `web/src/components/exposure/ExposureToolbar.tsx`
- Create: `web/src/components/exposure/ExposureToolbar.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `web/src/components/exposure/ExposureToolbar.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureToolbar } from "./ExposureToolbar";
import type { Material } from "../../library";

const MATERIALS: Material[] = [
  { id: 1, name: "SS Tag", notes: "", created_at: "", owner_id: 0,
    visibility: "private", shape: null, diameter_mm: null,
    width_mm: null, height_mm: null, is_default: false,
    calibration: { wb_supported: false, clean_pass_params: null } } as Material,
  { id: 2, name: "Circular tag" } as Material,
];

const NOOP = () => undefined;
const STD_PROPS = {
  materials: MATERIALS, materialId: 1, onMaterialChange: NOOP,
  mode: "bivariate" as const, onModeChange: NOOP,
  xKey: "total_exposure_index" as const,
  yKey: "pulse_intensity_index" as const,
  xScale: "log" as const, yScale: "log" as const,
  onXKeyChange: NOOP, onYKeyChange: NOOP,
  onXScaleChange: NOOP, onYScaleChange: NOOP,
  filtersOpen: false, onToggleFilters: NOOP,
  activeFilterCount: 0,
};

describe("ExposureToolbar", () => {
  it("renders the material select with current value selected", () => {
    render(<ExposureToolbar {...STD_PROPS} />);
    const select = screen.getByLabelText(/material/i) as HTMLSelectElement;
    expect(select.value).toBe("1");
  });

  it("calls onMaterialChange when a different material is picked", () => {
    const onMaterialChange = vi.fn();
    render(<ExposureToolbar {...STD_PROPS} onMaterialChange={onMaterialChange} />);
    const select = screen.getByLabelText(/material/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2" } });
    expect(onMaterialChange).toHaveBeenCalledWith(2);
  });

  it("renders univariate / bivariate toggle reflecting current mode", () => {
    render(<ExposureToolbar {...STD_PROPS} mode="univariate" />);
    const uni = screen.getByText(/univariate/i);
    const bivar = screen.getByText(/bivariate/i);
    expect(uni).toBeInTheDocument();
    expect(bivar).toBeInTheDocument();
  });

  it("renders the X axis pill with the current label", () => {
    render(<ExposureToolbar {...STD_PROPS} />);
    expect(screen.getByText(/Total Exposure/)).toBeInTheDocument();
  });

  it("clicking the X pill opens the picker (visible role=dialog)", () => {
    render(<ExposureToolbar {...STD_PROPS} />);
    const xPill = screen.getByText(/Total Exposure/).closest("button")!;
    fireEvent.click(xPill);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("FILTERS button shows the active count when > 0", () => {
    render(<ExposureToolbar {...STD_PROPS} activeFilterCount={3} />);
    expect(screen.getByText(/FILTERS · 3/i)).toBeInTheDocument();
  });

  it("FILTERS button hides the count when 0", () => {
    render(<ExposureToolbar {...STD_PROPS} activeFilterCount={0} />);
    expect(screen.queryByText(/FILTERS · 0/i)).toBeNull();
    expect(screen.getByText(/FILTERS/i)).toBeInTheDocument();
  });

  it("clicking FILTERS calls onToggleFilters", () => {
    const onToggleFilters = vi.fn();
    render(<ExposureToolbar {...STD_PROPS} onToggleFilters={onToggleFilters} />);
    fireEvent.click(screen.getByText(/FILTERS/i));
    expect(onToggleFilters).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/exposure/ExposureToolbar.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureToolbar.tsx`**

```tsx
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Material } from "../../library";
import type { ChannelCol, IndexRow } from "./exposureCorrelations";
import type { ScaleKind, ScatterMode } from "./ExposureScatter";
import { ExposureAxisPicker } from "./ExposureAxisPicker";

interface Props {
  materials: readonly Material[];
  materialId: number | null;
  onMaterialChange: (id: number) => void;
  mode: ScatterMode;
  onModeChange: (m: ScatterMode) => void;
  xKey: IndexRow;
  yKey: ChannelCol | IndexRow;
  xScale: ScaleKind;
  yScale: ScaleKind;
  onXKeyChange: (k: IndexRow) => void;
  onYKeyChange: (k: ChannelCol | IndexRow) => void;
  onXScaleChange: (s: ScaleKind) => void;
  onYScaleChange: (s: ScaleKind) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
}

const INDEX_PRETTY: Record<IndexRow, string> = {
  pulse_spacing_mm: "Pulse Spacing (mm)",
  line_spacing_mm: "Line Spacing (mm)",
  pulse_energy_index: "Pulse Energy",
  pulse_intensity_index: "Pulse Intensity",
  total_exposure_index: "Total Exposure",
  ablation_aggression_index: "Ablation Aggression",
  delivery_smoothness_index: "Delivery Smoothness",
};

const CHANNEL_PRETTY: Record<ChannelCol, string> = {
  L: "L*", a: "a*", b: "b*", hue: "Hue°", chroma: "Chroma",
};

function placePopover(
  anchor: HTMLElement,
  size: { width: number; height: number },
): { left: number; top: number } {
  const a = anchor.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = a.left;
  if (left + size.width + margin > vw) left = vw - size.width - margin;
  if (left < margin) left = margin;
  // Prefer below; flip above if it'd clip.
  let top = a.bottom + 6;
  if (top + size.height + margin > vh) {
    top = a.top - size.height - 6;
  }
  if (top < margin) top = margin;
  return { left, top };
}

interface AxisPillProps {
  axis: "x" | "y";
  mode: ScatterMode;
  currentKey: IndexRow | ChannelCol;
  scale: ScaleKind;
  pretty: string;
  onKeyChange: (k: IndexRow | ChannelCol) => void;
  onScaleChange: (s: ScaleKind) => void;
}

function AxisPill({
  axis, mode, currentKey, scale, pretty,
  onKeyChange, onScaleChange,
}: AxisPillProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

  const onClickOutside = (e: MouseEvent) => {
    if (!ref.current) return;
    if (e.target instanceof Node && !ref.current.contains(e.target)) {
      const tip = document.querySelector('[data-axis-picker]');
      if (tip && tip.contains(e.target as Node)) return;
      setOpen(false);
    }
  };

  // Listen while open.
  if (typeof window !== "undefined") {
    if (open) {
      window.addEventListener("mousedown", onClickOutside, { once: true });
    }
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          "px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] " +
          "rounded-sm border transition-colors " +
          (open
            ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]"
            : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-ink)]")
        }
      >
        {axis.toUpperCase()}: {pretty} ▾
      </button>
      {open && ref.current && typeof document !== "undefined" && createPortal(
        <div
          data-axis-picker
          className="fixed z-[1000] rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] shadow-lg"
          style={placePopover(ref.current, { width: 220, height: 280 })}
        >
          <ExposureAxisPicker
            axis={axis}
            mode={mode}
            currentKey={currentKey}
            scale={scale}
            onKeyChange={onKeyChange}
            onScaleChange={onScaleChange}
            onClose={() => setOpen(false)}
          />
        </div>,
        document.body,
      )}
    </>
  );
}

export function ExposureToolbar({
  materials, materialId, onMaterialChange,
  mode, onModeChange,
  xKey, yKey, xScale, yScale,
  onXKeyChange, onYKeyChange, onXScaleChange, onYScaleChange,
  filtersOpen, onToggleFilters, activeFilterCount,
}: Props) {
  const yPretty = mode === "univariate"
    ? CHANNEL_PRETTY[yKey as ChannelCol]
    : INDEX_PRETTY[yKey as IndexRow];

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="text-[color:var(--color-ink-subtle)]" id="material-label">Material</span>
        <select
          aria-label="material"
          aria-labelledby="material-label"
          value={materialId ?? ""}
          onChange={(e) => onMaterialChange(Number(e.target.value))}
          className="font-mono text-[11px] px-2 py-1 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
        >
          {materials.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </label>

      <div className="inline-flex border border-[color:var(--color-border)] rounded-sm overflow-hidden" role="tablist" aria-label="scatter mode">
        {(["univariate", "bivariate"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === mode}
            onClick={() => onModeChange(m)}
            className={
              "px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] " +
              (m === mode
                ? "bg-[color:var(--color-primary)] text-white"
                : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]")
            }
          >
            {m}
          </button>
        ))}
      </div>

      <AxisPill
        axis="x" mode={mode}
        currentKey={xKey} scale={xScale} pretty={INDEX_PRETTY[xKey]}
        onKeyChange={(k) => onXKeyChange(k as IndexRow)}
        onScaleChange={onXScaleChange}
      />
      <AxisPill
        axis="y" mode={mode}
        currentKey={yKey} scale={yScale} pretty={yPretty}
        onKeyChange={onYKeyChange}
        onScaleChange={onYScaleChange}
      />

      <button
        type="button"
        onClick={onToggleFilters}
        className={
          "ml-auto px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] " +
          "rounded-sm border transition-colors " +
          (filtersOpen || activeFilterCount > 0
            ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]"
            : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)]")
        }
      >
        ⚙ FILTERS{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/exposure/ExposureToolbar.test.tsx
```

Expected: PASS for all 8 cases.

- [ ] **Step 5: Typecheck + commit**

```bash
cd web && npx tsc --noEmit
git add web/src/components/exposure/ExposureToolbar.tsx \
        web/src/components/exposure/ExposureToolbar.test.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): ExposureToolbar with material/mode/axis pills/filters

Top toolbar replacing the deleted left rail. Material vanilla select +
Mode toggle (UNI | BIVAR) + X/Y axis pills (each opens an
ExposureAxisPicker popover via portal) + Filters button with active
count chip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `ExposureNeighboursStrip.tsx` — six-tile swatch strip

**Files:**
- Create: `web/src/components/exposure/ExposureNeighboursStrip.tsx`
- Create: `web/src/components/exposure/ExposureNeighboursStrip.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `web/src/components/exposure/ExposureNeighboursStrip.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ExposureNeighboursStrip } from "./ExposureNeighboursStrip";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string): ExposureRow {
  return {
    id, hex, lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0, line_spacing_mm: 0,
      pulse_energy_index: 0, pulse_intensity_index: 0,
      total_exposure_index: 0, ablation_aggression_index: 0,
      delivery_smoothness_index: 0,
      formula_version: 3, density_model: "lpc",
      power_model: "controller_percent",
    },
  };
}

const FOCUSED = row(1, "#888888");
const NEIGHBOURS = [
  { row: row(2, "#aaaaaa"), deltaE: 13.5 },
  { row: row(3, "#bbbbbb"), deltaE: 15.5 },
  { row: row(4, "#cccccc"), deltaE: 16.0 },
];

describe("ExposureNeighboursStrip", () => {
  it("renders nothing when focused is null", () => {
    const { container } = render(
      <ExposureNeighboursStrip
        focused={null} neighbours={[]}
        selectedId={null} onSelect={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 1 + N tiles (focused + neighbours)", () => {
    const { container } = render(
      <ExposureNeighboursStrip
        focused={FOCUSED} neighbours={NEIGHBOURS}
        selectedId={null} onSelect={() => undefined}
      />,
    );
    expect(container.querySelectorAll('[data-role="strip-tile"]').length).toBe(4);
  });

  it("focused tile has data-focused=true", () => {
    const { container } = render(
      <ExposureNeighboursStrip
        focused={FOCUSED} neighbours={NEIGHBOURS}
        selectedId={null} onSelect={() => undefined}
      />,
    );
    const tiles = container.querySelectorAll('[data-role="strip-tile"]');
    expect(tiles[0].getAttribute("data-focused")).toBe("true");
  });

  it("clicking a tile calls onSelect with the row id", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ExposureNeighboursStrip
        focused={FOCUSED} neighbours={NEIGHBOURS}
        selectedId={null} onSelect={onSelect}
      />,
    );
    const secondTile = container.querySelectorAll('[data-role="strip-tile"]')[1];
    fireEvent.click(secondTile);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("selected tile has data-selected=true", () => {
    const { container } = render(
      <ExposureNeighboursStrip
        focused={FOCUSED} neighbours={NEIGHBOURS}
        selectedId={3} onSelect={() => undefined}
      />,
    );
    const tiles = container.querySelectorAll('[data-role="strip-tile"]');
    // tiles[0] is focused, tiles[1]=id 2, tiles[2]=id 3, tiles[3]=id 4
    expect(tiles[2].getAttribute("data-selected")).toBe("true");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/exposure/ExposureNeighboursStrip.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureNeighboursStrip.tsx`**

```tsx
import type { ExposureRow } from "./exposureCorrelations";

export interface NeighbourEntry {
  row: ExposureRow;
  deltaE: number;
}

interface Props {
  focused: ExposureRow | null;
  neighbours: readonly NeighbourEntry[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

interface TileProps {
  row: ExposureRow;
  isFocused: boolean;
  isSelected: boolean;
  caption: string;
  onClick: () => void;
}

function Tile({ row, isFocused, isSelected, caption, onClick }: TileProps) {
  return (
    <button
      type="button"
      data-role="strip-tile"
      data-focused={isFocused ? "true" : "false"}
      data-selected={isSelected ? "true" : "false"}
      onClick={onClick}
      title={caption}
      className="flex-1 h-8 cursor-pointer transition-shadow"
      style={{
        background: row.hex,
        outline: isSelected
          ? "2px solid var(--color-primary)"
          : isFocused
            ? "2px solid var(--color-ink)"
            : "none",
        outlineOffset: "-2px",
      }}
    />
  );
}

export function ExposureNeighboursStrip({
  focused, neighbours, selectedId, onSelect,
}: Props) {
  if (!focused) return null;
  const effectiveSelected = selectedId ?? focused.id;

  return (
    <div className="flex gap-px">
      <Tile
        row={focused}
        isFocused={true}
        isSelected={effectiveSelected === focused.id}
        caption={`focused · ${focused.hex}`}
        onClick={() => onSelect(focused.id)}
      />
      {neighbours.map((n) => (
        <Tile
          key={n.row.id}
          row={n.row}
          isFocused={false}
          isSelected={effectiveSelected === n.row.id}
          caption={`${n.row.hex} · ΔE ${n.deltaE.toFixed(1)}`}
          onClick={() => onSelect(n.row.id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests + commit**

```bash
cd web && npx vitest run src/components/exposure/ExposureNeighboursStrip.test.tsx
cd web && npx tsc --noEmit
git add web/src/components/exposure/ExposureNeighboursStrip.tsx \
        web/src/components/exposure/ExposureNeighboursStrip.test.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): ExposureNeighboursStrip swatch tiles

1 + N tiles: focused entry on the left + up to 5 nearest neighbours.
Selection state lifted to props. Focused tile always shows with an
ink outline; the user-selected tile gets the primary outline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `ExposureNeighbourDetail.tsx` — detail card with deltas + actions

**Files:**
- Create: `web/src/components/exposure/ExposureNeighbourDetail.tsx`
- Create: `web/src/components/exposure/ExposureNeighbourDetail.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `web/src/components/exposure/ExposureNeighbourDetail.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureNeighbourDetail } from "./ExposureNeighbourDetail";
import type { ExposureRow } from "./exposureCorrelations";

function makeRow(id: number, hex: string, params: Record<string, number>): ExposureRow {
  return {
    id, hex, lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0, line_spacing_mm: 0,
      pulse_energy_index: 0, pulse_intensity_index: 0,
      total_exposure_index: 0, ablation_aggression_index: 0,
      delivery_smoothness_index: 0,
      formula_version: 3, density_model: "lpc",
      power_model: "controller_percent",
    },
    params,
  };
}

const FOCUSED = makeRow(1, "#888", {
  power: 14.6, speed: 800, frequency: 125,
  pulse_width: 200, density: 5000, passes: 1,
});

describe("ExposureNeighbourDetail", () => {
  it("renders the neighbour hex and ΔE", () => {
    const neighbour = makeRow(2, "#cac0a9", {
      power: 14.6, speed: 840, frequency: 125,
      pulse_width: 200, density: 5000, passes: 1,
    });
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={neighbour} deltaE={13.5}
        onJumpTo={() => undefined} onFilterFrom={() => undefined}
      />,
    );
    expect(screen.getByText(/#CAC0A9/i)).toBeInTheDocument();
    expect(screen.getByText(/ΔE.*13\.5/)).toBeInTheDocument();
  });

  it("annotates differing params with delta", () => {
    const neighbour = makeRow(2, "#aaa", {
      power: 14.6, speed: 840, frequency: 125,
      pulse_width: 200, density: 5000, passes: 1,
    });
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={neighbour} deltaE={5}
        onJumpTo={() => undefined} onFilterFrom={() => undefined}
      />,
    );
    // speed delta: +40 abs, +5%
    expect(screen.getByText(/\+5/)).toBeInTheDocument();
  });

  it("hides ΔE and disables actions when selected === focused", () => {
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={FOCUSED} deltaE={null}
        onJumpTo={() => undefined} onFilterFrom={() => undefined}
      />,
    );
    expect(screen.queryByText(/ΔE/)).toBeNull();
    const jumpBtn = screen.getByText(/Jump to/i) as HTMLButtonElement;
    const filterBtn = screen.getByText(/Filter from/i) as HTMLButtonElement;
    expect(jumpBtn.disabled).toBe(true);
    expect(filterBtn.disabled).toBe(true);
  });

  it("Jump to calls onJumpTo with neighbour id", () => {
    const neighbour = makeRow(99, "#aaa", { power: 50 });
    const onJumpTo = vi.fn();
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={neighbour} deltaE={5}
        onJumpTo={onJumpTo} onFilterFrom={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText(/Jump to/i));
    expect(onJumpTo).toHaveBeenCalledWith(99);
  });

  it("Filter from calls onFilterFrom with the neighbour row", () => {
    const neighbour = makeRow(99, "#aaa", { power: 50 });
    const onFilterFrom = vi.fn();
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={neighbour} deltaE={5}
        onJumpTo={() => undefined} onFilterFrom={onFilterFrom}
      />,
    );
    fireEvent.click(screen.getByText(/Filter from/i));
    expect(onFilterFrom).toHaveBeenCalledWith(neighbour);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/exposure/ExposureNeighbourDetail.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureNeighbourDetail.tsx`**

```tsx
import type { ExposureRow } from "./exposureCorrelations";
import { FILTERABLE_PARAMS, type FilterableParam } from "./exposureFilters";
import { recipeDelta } from "./recipeDelta";

interface Props {
  focused: ExposureRow;
  selected: ExposureRow;
  deltaE: number | null;
  onJumpTo: (id: number) => void;
  onFilterFrom: (row: ExposureRow) => void;
}

const PARAM_LABEL: Record<FilterableParam, string> = {
  power: "POWER", speed: "SPEED", frequency: "FREQUENCY",
  pulse_width: "PULSE_WIDTH", density: "DENSITY", passes: "PASSES",
};

const PARAM_SUFFIX: Record<FilterableParam, string> = {
  power: "%", speed: "", frequency: "", pulse_width: "", density: "", passes: "",
};

function fmtDelta(abs: number | null, pct: number | null): string {
  if (abs == null || abs === 0) return "";
  if (pct == null) {
    const sign = abs > 0 ? "+" : "";
    return `${sign}${abs}`;
  }
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

export function ExposureNeighbourDetail({
  focused, selected, deltaE, onJumpTo, onFilterFrom,
}: Props) {
  const isFocused = selected.id === focused.id;

  return (
    <div className="flex flex-col gap-2 rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-2">
      <div className="flex items-center justify-between font-mono text-[11px]">
        <span className="uppercase tracking-[0.16em] font-semibold text-[color:var(--color-ink)]">
          {selected.hex.toUpperCase()}
        </span>
        {!isFocused && deltaE != null && (
          <span className="text-[color:var(--color-primary)] font-semibold tabular-nums">
            ΔE {deltaE.toFixed(1)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px]">
        {FILTERABLE_PARAMS.map((p) => {
          const d = recipeDelta(focused, selected, p);
          if (d.value == null) return null;
          const deltaText = fmtDelta(d.abs, d.pct);
          return (
            <div key={p} className="flex items-baseline gap-1">
              <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.14em]">
                {PARAM_LABEL[p]}
              </span>
              <span className="tabular-nums text-[color:var(--color-ink)]">
                {d.value}{PARAM_SUFFIX[p]}
              </span>
              {deltaText && (
                <span className="tabular-nums text-[color:var(--color-primary)] text-[9px]">
                  {deltaText}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-1.5 pt-1 border-t border-[color:var(--color-border)]">
        <button
          type="button"
          disabled={isFocused}
          onClick={() => onJumpTo(selected.id)}
          className={
            "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
            (isFocused
              ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed"
              : "border-[color:var(--color-primary)] text-[color:var(--color-primary)] hover:bg-[color:var(--color-surface)]")
          }
        >
          → Jump to
        </button>
        <button
          type="button"
          disabled={isFocused}
          onClick={() => onFilterFrom(selected)}
          className={
            "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
            (isFocused
              ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed"
              : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]")
          }
        >
          Filter from
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests + commit**

```bash
cd web && npx vitest run src/components/exposure/ExposureNeighbourDetail.test.tsx
cd web && npx tsc --noEmit
git add web/src/components/exposure/ExposureNeighbourDetail.tsx \
        web/src/components/exposure/ExposureNeighbourDetail.test.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): ExposureNeighbourDetail with recipe deltas + actions

Detail card for the strip-selected neighbour. Header has hex + ΔE,
body has the six raw params with +/- delta annotations vs focused,
and a Jump-to / Filter-from action row. Buttons disable when the
selected tile is the focused entry itself.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `ExposureFocusedCard` — per-row filter buttons

**Files:**
- Modify: `web/src/components/exposure/ExposureFocusedCard.tsx`
- Modify: `web/src/components/exposure/ExposureFocusedCard.test.tsx`

- [ ] **Step 1: Write failing test**

Append to `web/src/components/exposure/ExposureFocusedCard.test.tsx`:

```tsx
import { fireEvent } from "@testing-library/react";

describe("ExposureFocusedCard per-row filter buttons", () => {
  it("clicking a recipe row's filter button calls onTogglePerParamFilter", () => {
    const onToggle = vi.fn();
    // Reuse whichever test helper renders ExposureFocusedCard with a row
    // that has params {power: 14.6, speed: 800, ...}. Existing tests in
    // this file will have a fixture; reuse it, passing onTogglePerParamFilter
    // and activeParamFilters props.
    render(
      <ExposureFocusedCard
        rows={[/* row with params */]}
        focusedId={/* row id */}
        highlightIndex="total_exposure_index"
        onDiscHover={() => undefined}
        onDiscLeave={() => undefined}
        onDiscClick={() => undefined}
        activeParamFilters={new Set()}
        onTogglePerParamFilter={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText(/filter to power/i));
    expect(onToggle).toHaveBeenCalledWith("power", 14.6);
  });

  it("active param filter shows the row with a tint and a check", () => {
    render(
      <ExposureFocusedCard
        rows={[/* same fixture */]}
        focusedId={/* row id */}
        highlightIndex="total_exposure_index"
        onDiscHover={() => undefined}
        onDiscLeave={() => undefined}
        onDiscClick={() => undefined}
        activeParamFilters={new Set(["power"])}
        onTogglePerParamFilter={() => undefined}
      />,
    );
    const row = screen.getByText(/Power/i).closest("[data-role='recipe-row']")!;
    expect(row.getAttribute("data-active")).toBe("true");
  });
});
```

(The existing test file's render fixtures must be reused; if the file uses `_seed_test_row()` or similar, adapt the calls. Read the file first.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/exposure/ExposureFocusedCard.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Update `ExposureFocusedCard.tsx`**

Read the file. The interface `Props` currently doesn't have `activeParamFilters` or `onTogglePerParamFilter`. Add them:

```tsx
import { type FilterableParam } from "./exposureFilters";

interface Props {
  // ... existing props ...
  activeParamFilters?: ReadonlySet<FilterableParam>;
  onTogglePerParamFilter?: (param: FilterableParam, value: number) => void;
}
```

The recipe row JSX currently looks like:

```tsx
<div className="flex justify-between items-baseline font-mono text-[11.5px]">
  <span className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
    {field.label}
  </span>
  <span className="tabular-nums text-[color:var(--color-ink)]">
    {String(v)}
    {field.suffix ?? ""}
  </span>
</div>
```

Replace with:

```tsx
{(() => {
  const param = field.key as FilterableParam;
  const isFilterableParam = (
    ["power", "speed", "frequency", "pulse_width", "density", "passes"] as const
  ).includes(param as never);
  const isActive = isFilterableParam &&
    (activeParamFilters?.has(param) ?? false);
  return (
    <div
      key={field.key}
      data-role="recipe-row"
      data-active={isActive ? "true" : "false"}
      className={
        "flex justify-between items-baseline font-mono text-[11.5px] px-1 py-0.5 rounded-sm " +
        (isActive ? "bg-[color:var(--color-surface-elevated)]" : "")
      }
    >
      <span className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
        {field.label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="tabular-nums text-[color:var(--color-ink)]">
          {String(v)}
          {field.suffix ?? ""}
        </span>
        {isFilterableParam && onTogglePerParamFilter && typeof v === "number" && (
          <button
            type="button"
            aria-label={`filter to ${field.label.toLowerCase()} = ${v}`}
            onClick={() => onTogglePerParamFilter(param, v)}
            title={
              isActive
                ? `Clear ${field.label.toLowerCase()} filter`
                : `Filter to ${field.label.toLowerCase()} = ${v}${field.suffix ?? ""}`
            }
            className={
              "font-mono text-[9px] px-1 py-0 rounded-sm border transition-colors " +
              (isActive
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-transparent text-[color:var(--color-ink-subtle)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]")
            }
          >
            {isActive ? "✓" : "⚲"}
          </button>
        )}
      </div>
    </div>
  );
})()}
```

(`⚲` is U+26B2 / use whichever filter glyph reads in the project's font; if it doesn't render, use `⌂` or just `+`.)

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/exposure/ExposureFocusedCard.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
cd web && npx tsc --noEmit
git add web/src/components/exposure/ExposureFocusedCard.tsx \
        web/src/components/exposure/ExposureFocusedCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(focused card): per-row filter buttons + active tint

Each recipe row gains a small filter glyph button that, on click,
toggles an exact-match range filter on that param at the row's value.
Filtered rows get a subtle background tint + the button shows a check.

New props are optional; existing call-sites still work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ExposureNeighboursPanel` — replace 5-row list with strip + detail

**Files:**
- Modify: `web/src/components/exposure/ExposureNeighboursPanel.tsx`
- Modify: `web/src/components/exposure/ExposureNeighboursPanel.test.tsx` (if it exists; otherwise just run after the rewrite)

- [ ] **Step 1: Read current file**

```bash
cat web/src/components/exposure/ExposureNeighboursPanel.tsx
```

Note its current props and the sort-mode toggle implementation.

- [ ] **Step 2: Rewrite to use strip + detail**

Replace the whole file with:

```tsx
import { useEffect, useState } from "react";
import {
  nearestByDeltaE, nearestByRegime, type Neighbour,
} from "./exposureNeighbours";
import type { ExposureRow } from "./exposureCorrelations";
import { ExposureNeighboursStrip, type NeighbourEntry } from "./ExposureNeighboursStrip";
import { ExposureNeighbourDetail } from "./ExposureNeighbourDetail";

interface Props {
  anchor: ExposureRow;
  candidates: readonly ExposureRow[];
  onSelectNeighbour: (id: number) => void;
  onFilterFromNeighbour?: (neighbour: ExposureRow) => void;
  n?: number;
}

type SortMode = "colour" | "regime";

export const ExposureNeighboursPanel: React.FC<Props> = ({
  anchor, candidates, onSelectNeighbour, onFilterFromNeighbour, n = 5,
}) => {
  const [sortMode, setSortMode] = useState<SortMode>("colour");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Reset selection whenever the focused entry changes.
  useEffect(() => { setSelectedId(null); }, [anchor.id]);

  const neighbours: Neighbour[] = sortMode === "colour"
    ? nearestByDeltaE(anchor, candidates, n)
    : nearestByRegime(anchor, candidates, n);

  const stripEntries: NeighbourEntry[] = neighbours.map((n) => ({
    row: n.row,
    deltaE: n.delta,
  }));

  const effectiveSelected = selectedId ?? (neighbours[0]?.row.id ?? anchor.id);
  const selectedRow = effectiveSelected === anchor.id
    ? anchor
    : (neighbours.find((nh) => nh.row.id === effectiveSelected)?.row ?? anchor);
  const selectedDeltaE = selectedRow.id === anchor.id
    ? null
    : (neighbours.find((nh) => nh.row.id === selectedRow.id)?.delta ?? null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {(["colour", "regime"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSortMode(m)}
            className={
              "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
              (m === sortMode
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
          >
            similar {m}
          </button>
        ))}
      </div>

      <ExposureNeighboursStrip
        focused={anchor}
        neighbours={stripEntries}
        selectedId={effectiveSelected}
        onSelect={(id) => setSelectedId(id)}
      />

      <ExposureNeighbourDetail
        focused={anchor}
        selected={selectedRow}
        deltaE={selectedDeltaE}
        onJumpTo={(id) => onSelectNeighbour(id)}
        onFilterFrom={(row) => onFilterFromNeighbour?.(row)}
      />
    </div>
  );
};
```

- [ ] **Step 3: Update tests**

Read `ExposureNeighboursPanel.test.tsx` (if it exists). Update assertions to match the new strip + detail rendering. The strip element selector is `[data-role="strip-tile"]`; the detail card text + Jump to / Filter from buttons should be present.

If the test file is small or trivially adaptable, rewrite it; if it's pretty integration-y, keep the spirit and verify smoke behaviour.

- [ ] **Step 4: Run tests + commit**

```bash
cd web && npx vitest run src/components/exposure/ExposureNeighboursPanel.test.tsx
cd web && npx tsc --noEmit
git add web/src/components/exposure/ExposureNeighboursPanel.tsx \
        web/src/components/exposure/ExposureNeighboursPanel.test.tsx
git commit -m "$(cat <<'EOF'
refactor(neighbours): strip + detail layout replaces 5-row list

Replaces the cramped truncated-row list with a 6-tile horizontal
swatch strip + a single full-recipe detail card showing deltas vs
focused. SIMILAR COLOUR / SIMILAR REGIME mode toggle preserved.

New optional onFilterFromNeighbour prop wires the detail card's
Filter-from action up to the page's filter state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `ExposureScatter` — SVG axis labels open the same picker

**Files:**
- Modify: `web/src/components/exposure/ExposureScatter.tsx`

- [ ] **Step 1: Identify the axis-label JSX**

The X and Y axis labels are wrapped in `<HelpTip>` (from PR #82). Each is an HTML overlay (not SVG `<text>`) sitting beside the chart. They have the existing two-line label content.

Add `cursor-pointer` styling and a click handler that opens an `ExposureAxisPicker` popover anchored to the label.

- [ ] **Step 2: Add picker state**

In `ExposureScatter.tsx`, near the top of the component:

```tsx
import { ExposureAxisPicker } from "./ExposureAxisPicker";
import { createPortal } from "react-dom";
// ... other existing imports ...

interface Props {
  // ... existing props ...
  onXKeyChange?: (k: IndexRow) => void;
  onYKeyChange?: (k: ChannelCol | IndexRow) => void;
  onXScaleChange?: (s: ScaleKind) => void;
  onYScaleChange?: (s: ScaleKind) => void;
}
```

Add inside the component body:

```tsx
const xLabelRef = useRef<HTMLDivElement | null>(null);
const yLabelRef = useRef<HTMLDivElement | null>(null);
const [xPickerOpen, setXPickerOpen] = useState(false);
const [yPickerOpen, setYPickerOpen] = useState(false);

useEffect(() => {
  const onClickOutside = (e: MouseEvent) => {
    if (e.target instanceof Node) {
      const t = e.target;
      if (xLabelRef.current?.contains(t)) return;
      if (yLabelRef.current?.contains(t)) return;
      const tip = document.querySelector('[data-axis-picker]');
      if (tip && tip.contains(t)) return;
      setXPickerOpen(false);
      setYPickerOpen(false);
    }
  };
  if (xPickerOpen || yPickerOpen) {
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }
}, [xPickerOpen, yPickerOpen]);
```

- [ ] **Step 3: Wire the labels**

Find the X-axis label `<HelpTip>` invocation. Wrap its inner `<div>` with `ref={xLabelRef}` and add `onClick={(e) => { e.stopPropagation(); setXPickerOpen(true); }}` plus `cursor-pointer` and a dotted underline class. Same for Y. Render the picker portal from the component body when `xPickerOpen` (or `yPickerOpen`) is true:

```tsx
{xPickerOpen && xLabelRef.current && typeof document !== "undefined" && createPortal(
  <div
    data-axis-picker
    className="fixed z-[1000] rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] shadow-lg"
    style={(() => {
      const a = xLabelRef.current.getBoundingClientRect();
      const margin = 8;
      const vh = window.innerHeight;
      // X label is below the chart; prefer ABOVE so we don't cover the data.
      const w = 220, h = 280;
      let top = a.top - h - 6;
      if (top < margin) top = a.bottom + 6;
      let left = a.left + a.width / 2 - w / 2;
      if (left < margin) left = margin;
      if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
      return { left, top };
    })()}
  >
    <ExposureAxisPicker
      axis="x" mode={mode}
      currentKey={xKey} scale={xScale}
      onKeyChange={(k) => onXKeyChange?.(k as IndexRow)}
      onScaleChange={(s) => onXScaleChange?.(s)}
      onClose={() => setXPickerOpen(false)}
    />
  </div>,
  document.body,
)}
```

(Same for Y with adjusted placement — Y label is on the left of the chart; prefer to the RIGHT of the label, sitting in the chart's left padding area. Compute placement to favor right-side anchoring.)

- [ ] **Step 4: Add the dotted-underline visual cue**

The HTML overlay's two-line content gets `cursor-pointer` and `border-b border-dotted border-[color:var(--color-ink-subtle)]` on the heading line. Tooltip pre-existing on hover from `HelpTip` is preserved.

- [ ] **Step 5: Run tests + commit**

```bash
cd web && npx vitest run src/components/exposure/ExposureScatter.test.tsx
cd web && npx tsc --noEmit
git add web/src/components/exposure/ExposureScatter.tsx
git commit -m "$(cat <<'EOF'
feat(scatter): SVG axis labels open ExposureAxisPicker on click

The X / Y axis labels (HTML overlays from PR #82) get cursor-pointer
+ dotted underline, and a click opens the same ExposureAxisPicker
popover the toolbar pills use. Placement prefers the gap above the
X label and to the right of the Y label so the chart's data area
stays visible while the picker is open.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `ExposurePage` — page restructure

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Add imports and helpers**

Near the top of the file:

```tsx
import { ExposureToolbar } from "../components/exposure/ExposureToolbar";
import { FILTERABLE_PARAMS, type FilterableParam } from "../components/exposure/exposureFilters";
```

Add this helper function near the top:

```ts
function activeParamFilterKeys(filters: ActiveFilters): ReadonlySet<FilterableParam> {
  const out = new Set<FilterableParam>();
  for (const k of FILTERABLE_PARAMS) {
    const r = filters.paramRanges[k];
    if (r && (r.min != null || r.max != null)) out.add(k);
  }
  return out;
}

function countActiveFilters(filters: ActiveFilters): number {
  let n = 0;
  if (!setsEqual(filters.sources, DEFAULT_FILTERS.sources)) n++;
  if (filters.validatedOnly) n++;
  if (filters.testId != null) n++;
  if (filters.testKind !== "all") n++;
  if (filters.family) n++;
  if (filters.brushRange) n++;
  for (const k of FILTERABLE_PARAMS) {
    const r = filters.paramRanges[k];
    if (r && (r.min != null || r.max != null)) n++;
  }
  return n;
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
```

- [ ] **Step 2: Add filtersOpen state + toggle/per-row callbacks**

```tsx
const [filtersOpen, setFiltersOpen] = useState(false);

const handleTogglePerParamFilter = useCallback(
  (param: FilterableParam, value: number) => {
    setFilters((prev) => {
      const r = prev.paramRanges[param];
      const exact = r != null && r.min === value && r.max === value;
      if (exact) {
        const next = { ...prev.paramRanges };
        delete next[param];
        return { ...prev, paramRanges: next };
      }
      return {
        ...prev,
        paramRanges: { ...prev.paramRanges, [param]: { min: value, max: value } },
      };
    });
  },
  [],
);

const handleFilterFromNeighbour = useCallback(
  (row: ExposureRow) => {
    setFilters((prev) => {
      const next = { ...prev.paramRanges };
      for (const k of FILTERABLE_PARAMS) {
        const v = row.params?.[k];
        if (typeof v === "number" && Number.isFinite(v)) {
          next[k] = { min: v, max: v };
        }
      }
      return { ...prev, paramRanges: next };
    });
  },
  [],
);
```

- [ ] **Step 3: Restructure the JSX**

DELETE the entire LEFT rail `<aside>` block.

REPLACE the page-level layout. The new structure:

```tsx
return (
  <div className="flex flex-col h-full">
    <ExposureToolbar
      materials={materials}
      materialId={materialId}
      onMaterialChange={setMaterialId}
      mode={mode}
      onModeChange={setMode}
      xKey={xKey}
      yKey={mode === "univariate" ? yKeyUni : yKeyBi}
      xScale={xScale}
      yScale={yScale}
      onXKeyChange={setXKey}
      onYKeyChange={(k) => {
        if (mode === "univariate") setYKeyUni(k as ChannelCol);
        else setYKeyBi(k as IndexRow);
      }}
      onXScaleChange={setXScale}
      onYScaleChange={setYScale}
      filtersOpen={filtersOpen}
      onToggleFilters={() => setFiltersOpen((v) => !v)}
      activeFilterCount={countActiveFilters(filters)}
    />

    <ExposureFilterPills
      filters={filters}
      entryCount={displayRows.length}
      onClearOne={handleClearOne}
      onClearAll={() => setFilters(DEFAULT_FILTERS)}
    />

    <div className="flex flex-1 min-h-0 gap-4 px-4 py-4">
      <main className="flex-1 min-w-0 flex flex-col gap-3">
        {/* scatter card */}
        <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)] p-4">
          <ExposureScatter
            rows={displayRows}
            mode={mode}
            xKey={xKey}
            yKey={mode === "univariate" ? yKeyUni : yKeyBi}
            xScale={xScale}
            yScale={yScale}
            focusedId={focusedId}
            onHover={handleHover}
            onLeave={handleLeave}
            onClick={handleClick}
            dimRange={filters.brushRange}
            family={focusedFamily ?? undefined}
            trimOutliers={filters.trimOutliers}
            onXKeyChange={setXKey}
            onYKeyChange={(k) => {
              if (mode === "univariate") setYKeyUni(k as ChannelCol);
              else setYKeyBi(k as IndexRow);
            }}
            onXScaleChange={setXScale}
            onYScaleChange={setYScale}
          />
        </div>

        {/* Hue ribbon + correlations matrix + range brush stay where they are */}
        <div className="flex gap-4 items-start">
          {/* … existing hue-ribbon + correlations layout, unchanged … */}
        </div>

        <ExposureRangeBrush
          rows={displayRows}
          range={filters.brushRange}
          onRangeChange={(r) =>
            setFilters((prev) => ({ ...prev, brushRange: r }))}
        />
      </main>

      {filtersOpen && (
        <aside
          style={{ width: 240 }}
          className="shrink-0 flex flex-col gap-4 border-l border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 overflow-y-auto"
        >
          <ExposureFilterPanel
            filters={filters}
            onChange={setFilters}
            tests={tests}
            dataRanges={ranges}
          />
        </aside>
      )}

      {/* Right rail — single column */}
      <aside
        style={{ width: 240 }}
        className="shrink-0 flex flex-col gap-4 border-l border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 overflow-y-auto"
      >
        <section>
          <RailHeading>Stats</RailHeading>
          <MetalBar variant="soft" className="mb-3" />
          {/* … existing Stats hero + sub-stats grid + bivariate caption … */}
        </section>

        <section>
          <div className="flex items-center justify-between mb-1.5">
            <RailHeading>
              {pinnedFocusId != null ? "Pinned" : "Focused"}
            </RailHeading>
            {focusedId != null && (
              <button type="button" onClick={handleBackgroundClear}
                className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink-muted)]"
              >
                clear
              </button>
            )}
          </div>
          <MetalBar variant="soft" className="mb-3" />
          <ExposureFocusedCard
            rows={displayRows}
            focusedId={focusedId}
            highlightIndex={xKey}
            onDiscHover={handleHover}
            onDiscLeave={handleLeave}
            onDiscClick={handleClick}
            dimRange={filters.brushRange}
            focusedFamily={focusedFamily}
            availableFamilies={focusedAvailableFamilies}
            activeFilterAxis={filters.family?.axis ?? null}
            onSetFilter={(axis, anchorRowId) =>
              setFilters((prev) => ({ ...prev, family: { axis, anchorRowId } }))}
            onClearFilter={() =>
              setFilters((prev) => ({ ...prev, family: null }))}
            activeParamFilters={activeParamFilterKeys(filters)}
            onTogglePerParamFilter={handleTogglePerParamFilter}
          />
        </section>

        <section>
          <RailHeading>Neighbours</RailHeading>
          <MetalBar variant="soft" className="mb-3" />
          {focusedRow ? (
            <ExposureNeighboursPanel
              anchor={focusedRow}
              candidates={displayRows}
              onSelectNeighbour={(id) => {
                setTransientFocusId(null);
                setPinnedFocusId(id);
              }}
              onFilterFromNeighbour={handleFilterFromNeighbour}
            />
          ) : (
            <p className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)]">
              Focus an entry to see its neighbours.
            </p>
          )}
        </section>

        <section>
          <RailHeading>Indices</RailHeading>
          <MetalBar variant="soft" className="mb-3" />
          <ExposureFocusedIndices row={focusedRow} />
        </section>
      </aside>
    </div>
  </div>
);
```

(The hue ribbon + correlation matrix block from PR #82 stays — copy that JSX verbatim into the slot indicated. Same for whatever wrapper around the existing Stats hero + sub-stat grid.)

- [ ] **Step 4: Run all frontend tests**

```bash
cd web && npm test -- --run
cd web && npx tsc --noEmit
cd web && npm run build > /dev/null 2>&1 && echo build-ok
```

Expected: PASS for all. The page test should still pass; the layout DOM is different but the test mostly drives via the API.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ExposurePage.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): workbench redesign — toolbar, on-demand filters, slim rail

Removes the left rail entirely. Mounts ExposureToolbar above the pill
bar (Material select + Mode toggle + X/Y axis pills + Filters button).
The filter panel becomes a 240px column conditionally rendered
between chart and right rail, toggled by the toolbar's Filters button.
Right rail collapses to a single column with sections: Stats / Focused
(now with per-row filter buttons) / Neighbours (strip + detail) /
Indices.

Wires handleTogglePerParamFilter and handleFilterFromNeighbour into
the focused card and neighbours panel respectively.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Browser verification + changelog + push

- [ ] **Step 1: Reseed prod data + restart dev server**

```bash
pkill -f 'xcs-gen serve' 2>&1 || true
sleep 1
uv run --active python scripts/seed_from_prod.py --api-key fsp9KYfD7zRUL507 --wipe
sqlite3 ~/.xcs-gen/app.db "UPDATE materials SET owner_id=0; UPDATE tests SET owner_id=0; UPDATE palette_entries SET owner_id=0;"
cd web && npm run build > /dev/null 2>&1 && echo build-ok
cd /Users/jonzky/Documents/XTools/Reverse
XCSGEN_LOG=WARNING uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 4
curl -s -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:8017/
```

- [ ] **Step 2: Browser walk-through on `#/exposure/1`**

Verify:
1. No left rail.
2. Top toolbar with Material dropdown, Mode toggle, X/Y pills, Filters button.
3. Click X pill → popover with seven indices + log toggle. Click an option → chart updates live; popover stays open.
4. Click outside or Esc → popover closes.
5. Click the SVG X-axis label → same popover, anchored above the chart.
6. Click `⚙ FILTERS` → 240 px panel slides in between chart and right rail.
7. Toggle a filter in the panel → chart updates; pill bar appears.
8. In the focused card, click the filter glyph next to a recipe row → that row gets a check + tint; URL updates with the param range pill.
9. Click again → filter clears.
10. In neighbours, click a tile → detail card swaps to that neighbour's recipe with deltas.
11. Click `Filter from` on a neighbour → all six param ranges set to the neighbour's exact values; pill bar shows multiple pills.
12. Click `Jump to` on a neighbour → focused entry updates; strip selection resets.

If any step fails, fix and re-verify.

- [ ] **Step 3: Author the changelog**

Create `changelog/2026-05-13-exposure-redesign.md`:

```markdown
---
id: 2026-05-13-exposure-redesign
date: 2026-05-13
level: major
title: Exposure — workbench redesign
summary: Toolbar replaces left rail; filters open on demand; neighbours panel becomes a swatch strip with a full-recipe detail card.
---

The exposure page has been rebuilt around the chart. The biggest
visible changes:

- **Top toolbar.** Material picker, mode toggle, X/Y axis pickers, and
  a Filters button all live in a single 40 px row above the chart.
  The left rail is gone.
- **Click an axis label to change it.** The chart's own X / Y labels
  are now click-to-edit; the same popover opens from the toolbar pills.
  Chart updates live as you click options.
- **Filters are on-demand.** A Filters button toggles a 240 px panel
  that slides in between the chart and right rail. Closed by default
  so the chart gets full width on first load.
- **Per-row filters on the focused recipe.** Each param row in the
  focused entry's recipe (Power · 14.6%) has a small filter glyph;
  click to instantly filter the chart to that exact value. Click
  again to clear.
- **Neighbours panel rebuilt.** Six swatch tiles (focused + 5 nearest
  neighbours) on top, with a full detail card below showing the
  selected tile's recipe with +/- deltas vs focused, plus
  Jump-to / Filter-from action buttons. The cramped 5-row
  truncated list is gone.

The right rail consolidates to a single column: Stats, Focused,
Neighbours, Indices. The hue ribbon, correlations matrix, and range
brush stay below the chart unchanged.

If you previously found things in the left rail — material, axis
pickers, sources/validated checkboxes — they all live in the toolbar
or the on-demand filter panel now.
```

- [ ] **Step 4: Commit changelog**

```bash
git add changelog/2026-05-13-exposure-redesign.md
git commit -m "$(cat <<'EOF'
changelog: exposure workbench redesign

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Final pre-PR checks + push**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
cd web && npm run build > /dev/null 2>&1 && echo build-ok
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q 2>&1 | tail -5
git push -u origin feat/exposure-redesign
gh pr create --draft --title "feat: exposure workbench redesign" --body "$(cat <<'EOF'
## Summary
Rebuilds the exposure page on top of PR #82:

- Left rail deleted; new ExposureToolbar (Material select + Mode toggle + X/Y axis pills + Filters button) sits above the pill bar.
- Axis pills AND clickable SVG axis labels both open the same ExposureAxisPicker popover. Chart updates live; popover stays open until explicit close.
- Filter panel becomes an on-demand 240px column between chart and right rail (closed by default).
- Right rail collapses to a single column: Stats / Focused / Neighbours / Indices.
- Focused-card recipe rows gain per-row filter buttons (exact-match toggle).
- Neighbours panel rebuilt: 6-tile swatch strip + full-recipe detail card with deltas + Jump-to / Filter-from actions.

Spec: `docs/superpowers/specs/2026-05-12-exposure-redesign-design.md`
Plan: `docs/superpowers/plans/2026-05-12-exposure-redesign.md`

## Test plan
- [x] `cd web && npm test` — full vitest suite (existing + new component tests) passes
- [x] `cd web && npx tsc --noEmit` — clean
- [x] `cd web && npm run build` — succeeds
- [x] `uv run --active pytest tests/ -q` — backend green
- [x] Browser walk-through on `#/exposure/1` after seeding 1049 prod entries

## Branch hygiene
Branched off feat/exposure-rail-filters. Once PR #82 merges, this rebases onto main.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

Expected: PR opened. Note its number and watch CI.

---

## Self-review

**Spec coverage:**
- Top toolbar with material/mode/axes/filters → Task 3. ✓
- Axis picker popover from toolbar AND SVG labels → Tasks 2, 8. ✓
- On-demand filter panel as middle column → Task 9. ✓
- Single-column right rail with Stats/Focused/Neighbours/Indices → Task 9. ✓
- Per-row filter buttons on focused card → Task 6. ✓
- Strip + detail neighbours redesign → Tasks 4, 5, 7. ✓
- recipeDelta helper → Task 1. ✓
- Below-chart panels untouched → Task 9 (preserved verbatim). ✓
- Hue-ribbon vertical-jitter fix already in `feat/exposure-rail-filters` (commit `235cdfe`) — rides along when this branch merges.
- Changelog → Task 10. ✓

**Placeholder scan:** the `ExposureFocusedCard` test step (Task 6) says "reuse the existing test fixture" without showing the fixture inline. Acceptable — the fixture exists in the file already and copying it would balloon the plan; the implementer reads the test file first.

**Type consistency:** `ExposureToolbar` uses the `ScaleKind` and `ScatterMode` types exported by `ExposureScatter`. `recipeDelta` returns `Delta` matching what `ExposureNeighbourDetail` consumes. `NeighbourEntry` is exported from `ExposureNeighboursStrip` and consumed by `ExposureNeighboursPanel`. `FilterableParam` is the same union from `exposureFilters.ts`. The `activeParamFilters?: ReadonlySet<FilterableParam>` prop on `ExposureFocusedCard` matches `activeParamFilterKeys()` return type.
