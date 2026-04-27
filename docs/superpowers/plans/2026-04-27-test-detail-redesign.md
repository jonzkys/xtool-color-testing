# Test Detail Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long-scrolling 3-column TestDetailPage with a fixed-height 2-column layout — tabbed editor on the left (Test / Sweep / Base params / Registration), compact preview + scrollable results panel on the right.

**Architecture:** Five frontend files touched plus one new tabs UI primitive. Each tab in the editor is a small section-component extracted from the existing `ParamTestEditor` (no field-implementation changes). The page-level layout switches from `PageContainer` natural-flow to viewport-flex with internal scroll regions. Visual polish (tab bar treatment, scrollbar styling, disabled-when-swept field appearance, compact preview frame) is delegated to the **frontend-design** agent at the end as a single dispatch.

**Tech Stack:** React + TypeScript + Tailwind v4. Vitest for tests. No backend changes.

**Spec:** `docs/superpowers/specs/2026-04-27-test-detail-redesign-design.md`

**Branch:** `feat/spectrum-tweaks-batch` (already has the small spectrum-strip fix at SHA `d2be3a9` plus the spec at `66f06db`). The redesign is large enough that splitting into its own PR is recommended at commit time — see Task 9. For now, work on the same branch.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `web/src/ui/Tabs.tsx` | **Create** | Small headless tabs primitive: `<Tabs items={...} value={...} onChange={...} />`. Renders the bar only; the active tab's content is rendered by the parent. |
| `web/src/ui/Tabs.test.tsx` | **Create** | Vitest covering all-items-render, click-changes-active. |
| `web/src/ui/index.ts` | **Modify** | Export Tabs. |
| `web/src/components/ParamTestEditor.tsx` | **Refactor** | Extract the 6 existing `<Section>` blocks into 4 internal section components (Test / Sweep / Base params / Registration). Add a new `tab` prop that selects which section to render. Move Material into the Test tab as a new field. Move Rows into the Sweep tab. Add disabled-when-swept logic to Base params fields. |
| `web/src/components/TestPreview.tsx` | **Modify** | Add a `compact?: boolean` prop. When compact, skip tall hero treatment and target a fixed-height (~160 px) box that scales to fit via object-contain. |
| `web/src/components/ResultsPanel.tsx` | **Modify** | Wrap inner content in a `flex-1 overflow-y-auto` container so the panel scrolls internally regardless of how many results it holds. |
| `web/src/pages/TestDetailPage.tsx` | **Refactor** | Replace the natural-flow PageContainer + 3-col grid with a viewport-flex wrapper + 2-col body grid. Lift tab-selection state. Drop the standalone Material `<Field>` (now in the Test tab). |

`web/src/components/TestPreview.test.ts` may need a small update to cover the compact mode if it asserts on dimensions (verify at implementation time).

---

## Task 1: Tabs UI primitive

**Files:**
- Create: `/Users/jonzky/Documents/XTools/Reverse/web/src/ui/Tabs.tsx`
- Create: `/Users/jonzky/Documents/XTools/Reverse/web/src/ui/Tabs.test.tsx`
- Modify: `/Users/jonzky/Documents/XTools/Reverse/web/src/ui/index.ts`

### 1.1: Write the failing test

Create `/Users/jonzky/Documents/XTools/Reverse/web/src/ui/Tabs.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";

const items = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

describe("Tabs", () => {
  it("renders all items", () => {
    render(<Tabs items={items} value="a" onChange={() => {}} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("marks the active tab via aria-selected", () => {
    render(<Tabs items={items} value="b" onChange={() => {}} />);
    expect(screen.getByText("Beta").closest("button"))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Alpha").closest("button"))
      .toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByText("Gamma"));
    expect(onChange).toHaveBeenCalledWith("c");
  });
});
```

### 1.2: Run, expect FAIL

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/ui/Tabs.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `Tabs` doesn't exist.

### 1.3: Implement Tabs

Create `/Users/jonzky/Documents/XTools/Reverse/web/src/ui/Tabs.tsx`:

```tsx
import { cn } from "./cn";

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Optional extra className for the outer bar container. */
  className?: string;
}

/**
 * Headless tabs primitive — renders the tab bar only. The active
 * tab's content is rendered by the parent (this component does NOT
 * own the panel content).
 *
 * Workshop-instrument register: JetBrains Mono uppercase tracking,
 * MetalBar-style underline on the active tab. Visual treatment is
 * intentionally minimal here so frontend-design can refine later.
 */
export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-stretch border-b border-[color:var(--color-border)]",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative px-4 py-2.5",
              "font-mono text-[10.5px] tracking-[0.18em] uppercase font-semibold",
              "transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/50 focus-visible:ring-inset",
              active
                ? "text-[color:var(--color-primary)]"
                : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
            )}
          >
            {item.label}
            {active && (
              <span
                aria-hidden
                className="absolute left-3 right-3 bottom-[-1px] h-[2px] bg-[color:var(--color-primary)] rounded-full"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
```

### 1.4: Add to ui index

In `/Users/jonzky/Documents/XTools/Reverse/web/src/ui/index.ts`, add:

```ts
export { Tabs, type TabItem, type TabsProps } from "./Tabs";
```

(Place it alphabetically with other exports if the file is alphabetical; otherwise just append.)

### 1.5: Run tests

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: tsc clean, vitest 95+ passed (the existing 95 + 3 new). If npm test runs them all by default and there's no exclude pattern, the new file is picked up automatically.

### 1.6: Stage

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/ui/Tabs.tsx web/src/ui/Tabs.test.tsx web/src/ui/index.ts
git status --short
```

Expected: 3 staged paths. NO commit yet (Task 9 batches commits).

---

## Task 2: Compact mode for TestPreview

**Files:**
- Modify: `/Users/jonzky/Documents/XTools/Reverse/web/src/components/TestPreview.tsx`

### 2.1: Read the existing component

```bash
sed -n '1,40p' /Users/jonzky/Documents/XTools/Reverse/web/src/components/TestPreview.tsx
```

Note the current sizing approach. The component computes a viewBox from `spec` and renders an SVG; the existing usage expects natural sizing.

### 2.2: Add `compact` prop

Modify the component's prop interface and outer container to accept and apply `compact: boolean`. The fixed compact size: full width of parent × **160 px tall**, with the inner SVG scaled via `preserveAspectRatio="xMidYMid meet"` (object-contain semantics).

In `/Users/jonzky/Documents/XTools/Reverse/web/src/components/TestPreview.tsx`, find the props interface (likely lines 1–20) and add `compact?: boolean`. Then locate the outermost wrapper element of the rendered preview and conditionally apply a fixed-height class when `compact` is true:

```tsx
interface Props {
  spec: TestSpec;
  testId: number | null;
  /** Render in compact mode: 160 px tall, full width of parent, content
   *  scaled to fit via object-contain. Used by TestDetailPage's right
   *  column where the preview is a quick visual safety check, not a
   *  primary content area. */
  compact?: boolean;
}
```

In the JSX, wrap the existing preview content in a container that switches sizing based on `compact`:

```tsx
return (
  <div
    className={cn(
      "rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] overflow-hidden",
      compact ? "h-[160px] w-full" : "",
    )}
  >
    {/* existing preview SVG / content here */}
  </div>
);
```

The existing content may already render in a sized container; the change is to wrap it with the conditional class. Adapt to the actual code structure — the goal is "compact mode = fixed 160 px tall, full width, content scales to fit". If the existing preview already uses `viewBox` + `preserveAspectRatio="xMidYMid meet"` on its SVG, it will scale to fit the new container automatically.

### 2.3: Run tsc + vitest

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: clean. Existing TestPreview test (`TestPreview.test.ts`) still passes — the compact prop is additive with a default of `undefined` (falsy).

### 2.4: Stage

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/TestPreview.tsx
git status --short
```

Expected: 4 staged paths total.

---

## Task 3: Scrollable wrapper for ResultsPanel

**Files:**
- Modify: `/Users/jonzky/Documents/XTools/Reverse/web/src/components/ResultsPanel.tsx`

### 3.1: Inspect the outer structure

```bash
sed -n '155,180p' /Users/jonzky/Documents/XTools/Reverse/web/src/components/ResultsPanel.tsx
```

Find the outermost return JSX. Currently it's likely a div containing multiple `<Section>` blocks (uploads, averaged swatches sub-section). The goal: this outermost div should be `flex flex-col h-full` and the inner scrollable area should be `flex-1 overflow-y-auto`.

### 3.2: Wrap the content in a scrollable container

In the existing return JSX, change the root container to `flex h-full flex-col` and wrap the content (Section blocks) in a single `flex-1 overflow-y-auto pr-1` container. The `pr-1` gives the scrollbar a tiny gutter so it doesn't crowd the rightmost content.

The exact edit depends on the existing structure. The simplest path:

Find the outermost return JSX (likely line 155–170) and modify:

```tsx
return (
  <div className="flex h-full flex-col">
    <div className="flex-1 overflow-y-auto pr-1">
      {/* existing content (uploads, averaged swatches sub-section, etc.) */}
    </div>
  </div>
);
```

If the existing root has padding (e.g. `p-4`), preserve it on the inner content wrapper rather than the outer flex container — otherwise the scrollbar appears outside the padded area which looks broken.

### 3.3: Run tsc + tests

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: clean. The existing tests (if any) on ResultsPanel still pass — behaviour is unchanged, only the wrapper.

### 3.4: Stage

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/ResultsPanel.tsx
git status --short
```

Expected: 5 staged paths total.

---

## Task 4: Refactor ParamTestEditor into 4 tab-aware sections

This is the largest task — the existing 6 `<Section>` blocks regroup into 4 tabs with field rearrangement (Material in, Rows moves to Sweep). The component takes a new `tab` prop that selects which section renders.

**Files:**
- Modify: `/Users/jonzky/Documents/XTools/Reverse/web/src/components/ParamTestEditor.tsx`

### 4.1: Read the current structure

```bash
grep -n "<Section\|export function" /Users/jonzky/Documents/XTools/Reverse/web/src/components/ParamTestEditor.tsx | head -10
```

Confirms current sections at lines: 101 (X axis), 152 (Y axis), 209 (Layout), 318 (Engraving direction), 336 (Passes multi-pass angle), 357 (Registration marker). BaseParamsSection function around line 538.

### 4.2: Add a Material prop + new prop interface

Modify the component's existing `Props` interface to add `tab` and `materials` + `materialId` + `onMaterialChange`. Find the `interface Props` declaration near the top of the file. Replace with:

```tsx
import type { Material } from "../library";

export type ParamTestEditorTab = "test" | "sweep" | "base" | "registration";

interface Props {
  spec: TestSpec;
  onChange: (next: TestSpec) => void;
  locked: boolean;
  /** Which tab to render. Caller (TestDetailPage) owns the selection. */
  tab: ParamTestEditorTab;
  /** Material picker lives in the Test tab — the parent passes its
   *  options + current value + handler so the editor stays a leaf. */
  materials: Material[];
  materialId: number | null;
  onMaterialChange: (id: number) => void;
}
```

(Add the `Material` import to the existing import block at the top of the file.)

### 4.3: Extract the section JSX into 4 tab branches

Inside the component body, replace the existing `return (<div>...all sections stacked...</div>)` with a `switch (tab)` that renders only the relevant section's JSX. The actual JSX content moves verbatim from the current `<Section>` blocks — only the wrapping changes.

Find the existing return statement (around line 100). Replace:

```tsx
  return (
    <div className="flex flex-col gap-5 p-4">
      <Section title="X axis (required)">{/* ... */}</Section>
      <Section title="Y axis (optional)">{/* ... */}</Section>
      <Section title="Layout">{/* ... */}</Section>
      <BaseParamsSection {/* ... */} />
      <Section title="Engraving direction">{/* ... */}</Section>
      <Section title="Passes (multi-pass angle)">{/* ... */}</Section>
      <Section title="Registration marker">{/* ... */}</Section>
    </div>
  );
```

with:

```tsx
  return (
    <div className="flex flex-col gap-5 p-4">
      {tab === "test" && (
        <>
          <Section title="Material">
            <Field label="Material">
              <Select
                value={materialId ?? ""}
                onChange={(e) => onMaterialChange(Number(e.target.value))}
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>
          <Section title="Layout">
            {/* existing Layout section content from ~line 209-305, MINUS the Rows field */}
            {/* paste the existing JSX here, then remove the <NumberField label="Rows"> block */}
          </Section>
        </>
      )}
      {tab === "sweep" && (
        <>
          <Section title="X axis (required)">
            {/* existing X axis JSX from ~line 101-150 */}
          </Section>
          <Section title="Y axis (optional)">
            {/* existing Y axis JSX from ~line 152-207 */}
          </Section>
          <Section title="Rows">
            <NumberField
              label="Rows (wrapping)"
              value={t.rows}
              integer
              min={1}
              onChange={(v) => updateSpec({ rows: v })}
              disabled={locked}
            />
          </Section>
        </>
      )}
      {tab === "base" && (
        <>
          <BaseParamsSection
            machine={machine}
            currentMode={currentMode}
            base_params={t.base_params}
            updateBase={updateBase}
            // ...other props as in current invocation
          />
          <Section title="Engraving direction">
            {/* existing JSX from ~line 318-334 */}
          </Section>
          <Section title="Passes (multi-pass angle)">
            {/* existing JSX from ~line 336-355 */}
          </Section>
        </>
      )}
      {tab === "registration" && (
        <Section title="Registration marker">
          {/* existing JSX from ~line 357-end */}
        </Section>
      )}
    </div>
  );
```

**Concrete extraction approach:** instead of copy-pasting JSX (which is error-prone), refactor the existing JSX into per-section function components. Add inside the file:

```tsx
function TestTab({ t, updateSpec, locked, materials, materialId, onMaterialChange }: {
  t: TestSpec;
  updateSpec: (patch: Partial<TestSpec>) => void;
  locked: boolean;
  materials: Material[];
  materialId: number | null;
  onMaterialChange: (id: number) => void;
}) {
  return (
    <>
      <Section title="Material">
        <Field label="Material">
          <Select
            value={materialId ?? ""}
            onChange={(e) => onMaterialChange(Number(e.target.value))}
          >
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </Section>
      {/* Layout section content, minus Rows */}
    </>
  );
}

function SweepTab({ t, updateSpec, locked, ...findIssue / mode probes }: {/* ... */}) {
  return (
    <>
      {/* X axis section */}
      {/* Y axis section */}
      <Section title="Rows">
        <NumberField
          label="Rows (wrapping)"
          value={t.rows}
          integer
          min={1}
          onChange={(v) => updateSpec({ rows: v })}
          disabled={locked}
        />
      </Section>
    </>
  );
}

function BaseTab({ ... }) { return <>{/* BaseParamsSection + Engraving direction + Passes multi-pass */}</>; }

function RegistrationTab({ ... }) { return <Section title="Registration marker">{/* ... */}</Section>; }
```

Then the main component switches on `tab` and renders one of these.

When extracting, **preserve every prop and event handler exactly as-is**. The disabled-when-swept logic is added in Task 5 — for now, just extract verbatim.

### 4.4: Update existing call site

`TestDetailPage.tsx` currently invokes `<ParamTestEditor spec={...} onChange={...} locked={...} />`. After this task it requires the new props (`tab`, `materials`, `materialId`, `onMaterialChange`). Task 7 wires those in. For now, the call site is broken — that's OK because Task 4 is staged-not-committed, and Task 7 will land the call-site fix before any commit.

### 4.5: Run tsc

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit 2>&1 | tail -10
```

Expected: errors at the existing `TestDetailPage.tsx` call site complaining about missing props. **That's acceptable for this staged-only task** — Task 7 adds the props.

If there are any OTHER tsc errors (e.g., a typo in the extracted JSX), fix them.

### 4.6: Stage

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/ParamTestEditor.tsx
git status --short
```

Expected: 6 staged paths total.

---

## Task 5: Disabled-when-swept logic in Base params

When `spec.x_param === "power"`, the Power field in Base params renders disabled with a small caption explaining why. Same for `y_param`.

**Files:**
- Modify: `/Users/jonzky/Documents/XTools/Reverse/web/src/components/ParamTestEditor.tsx` (the BaseParamsSection function around line 538 + new helper)

### 5.1: Add a helper

At the top of the file (next to the existing `defaultAggregatorFor`, `AGGREGATOR_LABELS` etc.), add:

```tsx
/** Map of swept-able fields → their human-readable name for the
 *  "Overridden by …" caption. Note: laser is not swept; it's a
 *  fixed enum, not a numeric range. */
const SWEPTABLE_FIELDS = new Set([
  "power", "speed", "frequency", "density",
  "passes", "pulse_width", "scan_angle",
] as const);

type SweptableField = typeof SWEPTABLE_FIELDS extends Set<infer T> ? T : never;

/** If the given base-param field is overridden by the X or Y sweep,
 *  return the "Overridden by …" caption. Otherwise return null. */
function sweptByCaption(
  field: SweptableField,
  spec: TestSpec,
): string | null {
  if (spec.x_param === field) return "Overridden by X-axis sweep";
  if (spec.y_param === field) return "Overridden by Y-axis sweep";
  return null;
}
```

### 5.2: Apply to each base param NumberField

Locate the `BaseParamsSection` function (around line 538). Inside it, find each `<NumberField>` for the swept-able fields (power, speed, frequency, density, passes, pulse_width, scan_angle). Wrap the field with the caption logic.

For example, for the Power field:

```tsx
{(() => {
  const caption = sweptByCaption("power", spec);
  return (
    <div>
      <NumberField
        label="Power %"
        value={base_params.power}
        onChange={(v) => updateBase({ power: v })}
        disabled={locked || caption !== null}
      />
      {caption && (
        <p className="mt-1 text-[10.5px] text-[color:var(--color-ink-subtle)] italic">
          {caption}
        </p>
      )}
    </div>
  );
})()}
```

(The `BaseParamsSection` likely receives `spec` already; if not, add it to the props.)

Repeat for Speed, Frequency, Density, Passes, Pulse width, Scan angle. Skip Laser (not swept).

### 5.3: Add a vitest

Append to a vitest file for ParamTestEditor (create one if absent at `web/src/components/ParamTestEditor.test.tsx`):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParamTestEditor } from "./ParamTestEditor";

const baseSpec: any = {
  x_param: "power",
  x_min: 10, x_max: 50, x_steps: 5,
  y_param: null,
  rows: 1,
  width_mm: 30, height_mm: 30, gap_mm: 0.5,
  cell_shape: "rect", square_cells: true,
  angle_mode: "fixed", unidirectional: false, hide_axis_labels: false,
  base_params: {
    power: 25, speed: 1000, frequency: 60,
    density: 200, passes: 1, pulse_width: 200,
    laser: "red", scan_angle: 90,
  },
  registration: { mode: "on" },
};

describe("ParamTestEditor disabled-when-swept", () => {
  it("disables the Power field on the Base tab when x_param is power", () => {
    render(
      <ParamTestEditor
        spec={baseSpec}
        onChange={() => {}}
        locked={false}
        tab="base"
        materials={[]}
        materialId={null}
        onMaterialChange={() => {}}
      />,
    );
    const power = screen.getByLabelText(/power %/i) as HTMLInputElement;
    expect(power.disabled).toBe(true);
    expect(screen.getByText(/overridden by x-axis sweep/i)).toBeInTheDocument();
  });

  it("does NOT disable Power when x_param is something else", () => {
    render(
      <ParamTestEditor
        spec={{ ...baseSpec, x_param: "speed" }}
        onChange={() => {}}
        locked={false}
        tab="base"
        materials={[]}
        materialId={null}
        onMaterialChange={() => {}}
      />,
    );
    const power = screen.getByLabelText(/power %/i) as HTMLInputElement;
    expect(power.disabled).toBe(false);
  });
});
```

### 5.4: Run tsc + the new test

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit 2>&1 | tail -10
cd /Users/jonzky/Documents/XTools/Reverse/web && npx vitest run src/components/ParamTestEditor.test.tsx 2>&1 | tail -10
```

Expected: tsc still has the broken-call-site errors at TestDetailPage.tsx (Task 7 fixes them). The new vitest passes.

### 5.5: Stage

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/ParamTestEditor.tsx web/src/components/ParamTestEditor.test.tsx
git status --short
```

Expected: 6 paths total (the test file is new but ParamTestEditor.tsx was already staged).

---

## Task 6: TestDetailPage layout refactor

Replace the natural-flow PageContainer + 3-col grid with a viewport-flex wrapper + 2-col body grid. Add tab-selection state. Wire up the new `<Tabs>` primitive and pass `tab`/`materials`/`materialId`/`onMaterialChange` to `ParamTestEditor`. Drop the standalone Material `<Field>` (now in the Test tab). Use `compact` mode on `TestPreview`.

**Files:**
- Modify: `/Users/jonzky/Documents/XTools/Reverse/web/src/pages/TestDetailPage.tsx`

### 6.1: Imports

Add at the top:

```tsx
import { Tabs } from "../ui";
import type { ParamTestEditorTab } from "../components/ParamTestEditor";
```

Remove the standalone `<Field>` and `<Select>` imports if they're no longer used elsewhere on this page.

### 6.2: Add tab state

Inside the `TestDetailPage` component body, near the existing `useState` calls:

```tsx
  const [activeTab, setActiveTab] = useState<ParamTestEditorTab>("test");
```

### 6.3: Replace the body layout

Locate the existing return JSX (near the end of the component). Find the `<PageContainer>` wrapper and the 3-column grid (`<div className="grid grid-cols-[360px_minmax(0,1fr)_360px] gap-5">`).

Replace the body grid with the new fixed-height layout:

```tsx
return (
  <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
    {/* Existing header — keep as-is, it stays at the top */}
    <header className="shrink-0 px-6 pt-4 pb-3 flex items-center justify-between gap-4 border-b border-[color:var(--color-border)]">
      {/* existing header content (test name input, badges, action buttons) */}
    </header>

    {error && (
      <div className="shrink-0 mx-6 mt-3 rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
        {error}
      </div>
    )}

    {/* BODY: 2-column grid filling remaining viewport height */}
    <div className="flex-1 min-h-0 grid grid-cols-[58fr_42fr] gap-5 px-6 py-4">
      {/* LEFT: tabbed editor */}
      <div className="flex flex-col min-h-0 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden">
        <Tabs
          items={[
            { id: "test", label: "Test" },
            { id: "sweep", label: "Sweep" },
            { id: "base", label: "Base params" },
            { id: "registration", label: "Registration" },
          ]}
          value={activeTab}
          onChange={(id) => setActiveTab(id as ParamTestEditorTab)}
        />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ParamTestEditor
            spec={spec}
            onChange={setSpec}
            locked={test?.locked ?? false}
            tab={activeTab}
            materials={materials}
            materialId={materialId}
            onMaterialChange={setMaterialId}
          />
        </div>
      </div>

      {/* RIGHT: preview + scrollable results */}
      <div className="flex flex-col min-h-0 gap-3">
        <div className="shrink-0">
          <TestPreview spec={spec} testId={test?.id ?? null} compact />
        </div>
        <div className="flex-1 min-h-0 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden">
          {test ? (
            <ResultsPanel testId={test.id} locked={test.locked} />
          ) : (
            <EmptyState
              title="Save first"
              description="Upload and ingest palette swatches after the test is saved."
            />
          )}
        </div>
      </div>
    </div>
  </div>
);
```

The `h-[calc(100vh-56px)]` assumes the global TopBar is ~56 px tall. Verify by checking the TopBar's actual height; adjust the offset accordingly. If you can't easily measure it, use `h-screen` on a wrapper and let the TopBar take its space above — depends on how the routing layout is structured. Reasonable safe values: `h-[calc(100vh-56px)]` or `h-[calc(100vh-72px)]`.

### 6.4: Remove the standalone Material Field

Delete the `<Field label="Material">` block from above the editor (currently around lines 273–290 of the existing file). Material is now inside the Test tab.

### 6.5: Run tsc + tests

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit 2>&1 | tail -5
cd /Users/jonzky/Documents/XTools/Reverse/web && npm test 2>&1 | tail -5
```

Expected: tsc clean (Task 4's broken call-site is now resolved). All vitest pass.

### 6.6: Stage

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/pages/TestDetailPage.tsx
git status --short
```

Expected: 7 staged paths total.

---

## Task 7: Frontend-design polish pass

Single dispatch to the `frontend-design` skill with all visual surfaces covered: tab bar treatment, compact preview frame, scrollbar styling, disabled-when-swept field appearance.

### 7.1: Dispatch frontend-design

The implementer subagent invokes the `frontend-design` skill via the `Skill` tool with this brief:

```
Polish the visual treatment of the redesigned test detail page at
/Users/jonzky/Documents/XTools/Reverse/web/src/pages/TestDetailPage.tsx
and its supporting components.

Project register reference (read these to absorb the existing
vocabulary):
- web/src/components/ResultDetailDialog.tsx (the AggregatorControlBar
  function — same visual family as the new tabs)
- web/src/components/TopBar.tsx (the existing pill buttons)
- web/src/ui/Badge.tsx (warning palette tokens)
- web/src/ui/theme.css (colour tokens)

Surfaces to refine:

1. Tab bar in web/src/ui/Tabs.tsx
   Current: tracking-uppercase mono labels with a 2px primary
   underline on the active tab. Reasonable but spartan. Consider:
   - Should the inactive tabs have a subtle hover state beyond colour
     change?
   - Is the underline the right register, or does a metal-bar style
     accent fit better?
   - Spacing between tabs — currently px-4 py-2.5; refine if needed.

2. Compact preview frame in web/src/components/TestPreview.tsx (when
   compact prop is true)
   Current: 160 px tall, full width, basic border. Add the lab-notebook
   crop marks at the corners (TickMark pattern from
   ResultDetailDialog.tsx). Possibly a small "PREVIEW" caption in the
   top-left corner so users understand it's not full-detail.

3. Results panel scroll affordance in web/src/components/ResultsPanel.tsx
   The outer container is now `flex-1 overflow-y-auto pr-1`. Add a
   custom scrollbar style that matches the codebase's border palette
   (thin, muted, not the browser default). Optionally a subtle fade
   gradient at the top + bottom of the scroll region so content
   continuation is visible.

4. Disabled-when-swept fields in
   web/src/components/ParamTestEditor.tsx (BaseParamsSection)
   Current: native disabled <input> with a small italic caption below
   reading "Overridden by X-axis sweep". Refine the visual treatment:
   - The disabled state should clearly read as "intentionally
     unavailable", not "broken". Consider a subtle striped background,
     a chevron/arrow indicating "swept", or just a more refined
     disabled colour.
   - The caption could be in the muted-foreground colour with a small
     icon (Sliders or ArrowDown from lucide).

For each surface, return: the updated TSX (or CSS/Tailwind utility
changes) ready to drop in. Don't change props or behaviour — visual
refinement only.
```

### 7.2: Apply the returned styles

The implementer pastes the returned TSX/CSS into the relevant files. Run tsc + npm test after each surface application to catch any typos.

### 7.3: Stage

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/ui/Tabs.tsx web/src/components/TestPreview.tsx web/src/components/ResultsPanel.tsx web/src/components/ParamTestEditor.tsx
git status --short
```

Expected: same 7 paths (frontend-design refines existing files).

---

## Task 8: Build, manual checks, commits, draft PR

### 8.1: Full sweep

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: tsc clean, all vitest pass.

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npm run build > /tmp/build.log 2>&1 && echo "build exit: $?"
```

Expected: exit 0.

### 8.2: Browser smoke check

```bash
cd /Users/jonzky/Documents/XTools/Reverse
pkill -f "xcs-gen serve" 2>/dev/null; sleep 1
uv run --active xcs-gen serve --host 127.0.0.1 --port 8019 > /tmp/xcs.log 2>&1 &
sleep 2
curl -s -o /dev/null -w "boot=%{http_code}\n" http://127.0.0.1:8019/
curl -s http://127.0.0.1:8019/ | grep -c "/assets/"
pkill -f "xcs-gen serve" 2>/dev/null
```

Expected: 200, at least 1 asset reference. Then **manually** open `http://127.0.0.1:8019/#/tests/9` (or any test with results) in a browser and confirm:

- Page does not scroll (window scrollbar absent).
- 4 tabs render in the left column; clicking each switches the content.
- Material selector is in the Test tab.
- Rows is in the Sweep tab.
- Base params shows the recipe fields plus engraving direction + multi-pass angle.
- Registration tab shows the marker config.
- TestPreview is visibly compact (160 px tall) at the top of the right column.
- Results panel below the preview scrolls internally when there are many results — open a test with 100+ results and verify.
- On the Sweep tab, change x_param to "power"; switch to Base params; the Power field renders disabled with the "Overridden by X-axis sweep" caption.

### 8.3: Commit (split into logical units)

The implementation touches multiple files with distinct concerns. Split into 4 commits inside this branch:

```bash
cd /Users/jonzky/Documents/XTools/Reverse

# Commit 1: Tabs primitive
git reset web/src/ui/Tabs.tsx web/src/ui/Tabs.test.tsx web/src/ui/index.ts
git add web/src/ui/Tabs.tsx web/src/ui/Tabs.test.tsx web/src/ui/index.ts
git commit -m "$(cat <<'EOF'
feat(ui): headless Tabs primitive

Renders the bar only — active tab's content is rendered by the parent.
Workshop-instrument register: JetBrains Mono uppercase tracking,
primary-colour underline on the active tab. Visual treatment refined
later by the frontend-design pass on the test-detail-redesign branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

# Commit 2: ParamTestEditor refactor + disabled-when-swept
git add web/src/components/ParamTestEditor.tsx web/src/components/ParamTestEditor.test.tsx
git commit -m "$(cat <<'EOF'
refactor(web): ParamTestEditor takes a tab prop, regroups sections

Six existing Section blocks regroup into 4 tab branches selected by a
new `tab` prop:
- Test: Material + Layout (minus Rows) + Aggregator + cell options
- Sweep: X axis + Y axis + Rows
- Base params: BaseParamsSection + Engraving direction + Passes
  multi-pass angle
- Registration: marker config

Material moves IN as a new field on the Test tab. Rows moves OUT of
Layout into Sweep. No field-implementation changes — only grouping
and the new tab gate.

Adds disabled-when-swept logic in Base params: when spec.x_param or
spec.y_param matches a swept-able base field (power/speed/frequency/
density/passes/pulse_width/scan_angle), the field renders disabled
with an "Overridden by …-axis sweep" caption. Prevents confusion
about why edits to a swept field don't take effect on burn cells.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

# Commit 3: TestPreview compact + ResultsPanel scrollable + TestDetailPage layout
git add web/src/components/TestPreview.tsx web/src/components/ResultsPanel.tsx web/src/pages/TestDetailPage.tsx
git commit -m "$(cat <<'EOF'
feat(web): fixed-height test detail page with tabbed editor

Replaces the long-scrolling 3-column grid with a viewport-fitting
2-column layout:
- Header (test name + status + actions) stays sticky at top.
- Left column (~58%): 4-tab parameter editor.
- Right column (~42%): compact 160-px-tall preview pinned at top,
  scrollable results panel filling the rest.

Tests with hundreds of results no longer drive page-level scroll —
only the results panel scrolls internally. The preview + form stay
in view.

TestPreview gains a compact prop (fixed 160 px tall, full width of
parent, content scaled via object-contain). ResultsPanel wraps its
content in flex-1 overflow-y-auto so it absorbs overflow without
expanding outward.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(The first `git reset` un-stages the editor files so they go in their dedicated commit.)

If the frontend-design pass produced significant additional CSS/visual changes that span multiple files, add a 4th commit:

```bash
git commit -m "$(cat <<'EOF'
feat(web): frontend-design polish on test-detail tabs + preview + scroll

Refined visual treatment from the frontend-design agent:
- Tab bar hover states + spacing
- Lab-notebook crop marks on the compact preview frame
- Custom scrollbar + fade gradient on the results panel
- Striped disabled-state treatment for swept Base param fields with a
  small icon indicating "swept"

Pure visual refinement — no behaviour or props change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 8.4: Decide branch / PR strategy

The branch `feat/spectrum-tweaks-batch` already carries the small spectrum-strip fix at SHA `d2be3a9`. The redesign is significantly larger and warrants its own review. Two options at this point:

**Option A — Same PR.** Push the branch as-is and open one PR containing both the spectrum fix and the redesign. Faster to ship.

**Option B — Split.** Cherry-pick the spectrum fix onto a separate branch off main (`fix/spectrum-strip-tiles-without-gaps`), open it as its own PR. Then push the redesign-only commits as a separate branch (`feat/test-detail-redesign`) and open a second PR.

Option B is recommended — the redesign needs more careful review and the spectrum fix is uncontroversial. **The implementer should escalate to the controller for this decision before pushing.**

If Option B is chosen:

```bash
git checkout -b fix/spectrum-strip-tiles-without-gaps d2be3a9
git push -u origin fix/spectrum-strip-tiles-without-gaps
gh pr create --title "fix(web): SpectrumStrip tiles without gaps" --body "Small one-file fix for the gappy spectrum strip in the result-detail dialog. See commit message for details." --base main

git checkout feat/spectrum-tweaks-batch
git rebase --onto main d2be3a9
git branch -m feat/test-detail-redesign
git push -u origin feat/test-detail-redesign
gh pr create --draft --title "feat: redesign test detail page" --body "..."
```

If Option A is chosen, just push and PR:

```bash
git push -u origin feat/spectrum-tweaks-batch
gh pr create --draft --title "feat: test detail redesign + spectrum strip fix" --body "..."
```

### 8.5: Open the redesign PR

```bash
gh pr create --draft --title "feat(web): redesign test detail page with tabbed editor + scrollable results" --body "$(cat <<'EOF'
## Summary

Replaces the long-scrolling 3-column TestDetailPage with a fixed-height 2-column layout. Tests with hundreds of results no longer drive page-level scroll — only the results panel scrolls internally.

- **Header** (sticky): test name + status badges + Save / Generate / Retest / Duplicate / Delete.
- **Left column (~58%)**: 4 tabs.
  - **Test** — Material · Width / Height / Gap · Cell shape · Square cells · Hide axis labels · Aggregator.
  - **Sweep** — X / Y axis · Rows.
  - **Base params** — Recipe fields + Engraving direction + Passes multi-pass angle. Fields swept by X or Y render disabled with an "Overridden by …" caption.
  - **Registration** — Marker mode, QR / ArUco sizes.
- **Right column (~42%)**: Compact 160 px preview pinned at top + scrollable ResultsPanel filling the rest.

A new headless `Tabs` primitive lives in `web/src/ui/Tabs.tsx` for reuse elsewhere later.

Spec: \`docs/superpowers/specs/2026-04-27-test-detail-redesign-design.md\`. Plan: \`docs/superpowers/plans/2026-04-27-test-detail-redesign.md\`.

## Test plan

- [x] \`cd web && npx tsc --noEmit\` is green.
- [x] \`cd web && npm test\` is green (95+ vitest pass).
- [x] \`cd web && npm run build\` succeeds; bundle smoke check confirms the new code is in the built JS.
- [ ] **Manual browser check:** open a test with 100+ results. Page does not scroll; only the results panel scrolls. The preview + tabs stay pinned in view.
- [ ] **Manual browser check:** click through all 4 tabs. Active tab content matches the spec mapping.
- [ ] **Manual browser check:** on the Sweep tab, set x_param to "power"; switch to Base params; the Power field renders disabled with the "Overridden by X-axis sweep" caption.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 8.6: Watch CI; flip to ready when green

```bash
gh pr checks --watch
```

When all green:

```bash
gh pr ready
```

---

## Self-review notes

**Spec coverage:**

| Spec section | Task(s) | ✓ |
|---|---|---|
| 1. Page-level layout (viewport-flex + 2-col body) | T6 | ✓ |
| 2. Header (unchanged content + sticky) | T6 | ✓ |
| 3. Left column tabbed editor (4 tabs) | T1 + T4 + T6 | ✓ |
| 3a. Disabled-when-swept Base param fields | T5 | ✓ |
| 4a. Compact TestPreview (160 px) | T2 + T6 | ✓ |
| 4b. Scrollable ResultsPanel | T3 + T6 | ✓ |
| 5. Frontend-design treatment | T7 | ✓ |
| 6. Components (Tabs + ParamTestEditor + TestPreview + ResultsPanel + TestDetailPage) | T1–T6 | ✓ |
| 7. Data flow (unchanged) | preserved across all tasks | ✓ |
| 8. Error handling (unchanged banner) | T6 retains error UI | ✓ |
| 9. Testing (Tabs + ParamTestEditor + render + manual) | T1, T5 vitest + T8 manual | ✓ |
| 10. Files touched (5 modify + 2 new) | T1–T6 | ✓ |

**Type / name consistency:**

- `ParamTestEditorTab = "test" | "sweep" | "base" | "registration"` — defined in T4, used in T6.
- `Tabs` items use `id` and `label` (not `value` / `name`) — consistent across the primitive and call site.
- `compact?: boolean` on TestPreview — consistent prop name across T2 and T6 invocation.
- `SWEPTABLE_FIELDS` set names match the actual `base_params` keys (power, speed, frequency, density, passes, pulse_width, scan_angle).

**Placeholder scan:** the per-section JSX extraction in T4 uses comments like `{/* existing X axis JSX from ~line 101-150 */}` because the spec asks for a verbatim move (no behaviour change) and the actual JSX is too long to repeat in the plan. This is a placeholder by-the-letter, but the instruction is clear ("paste the existing JSX here") and the line ranges are concrete. Acceptable.

**Frontend-design dispatch:** T7 is a single dispatch covering all 4 visual surfaces. The brief is written so the agent can return per-surface refinements that the implementer drops into the existing files.

**Branch / PR strategy:** T8.4 explicitly asks the implementer to escalate before pushing — the spectrum-strip fix on the same branch should probably be split into its own PR. The plan doesn't decide unilaterally.
