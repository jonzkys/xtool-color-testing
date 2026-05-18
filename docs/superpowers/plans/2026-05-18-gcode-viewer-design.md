# Gcode Viewer — Visual Design Spec

> For the implementing engineer. Do not write JSX. This doc supersedes the
> inline Task 10 layout sketch in `2026-05-18-gcode-viewer.md`.

---

## 1. Page composition

The page occupies `PageContainer maxWidth="full" bleed` so the canvas can
claim real estate. Outer chrome is a single `Section title="Gcode Viewer"`
with `dense`. Inside that section the content is three stacked zones:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TOOLBAR  [Open .gc file…]  [filename · lines · parse-time]  [Travels ▢] │
├──────────────────────────────────────────────────────────────────────────┤
│  JOB BAR  (only when jobs.length > 1)                                    │
│  Job: [▼ select]                                                         │
├──────────────┬──────────────────────────────────────┬────────────────────┤
│  LAYER LIST  │                                      │  PARAMS BOX        │
│  220 px min  │           CANVAS                     │  280 px            │
│  scrollable  │     (fills remaining space)          │  scrollable        │
│              │                                      │                    │
│              │                                      │                    │
│              │                                      │                    │
├──────────────┴──────────────────────────────────────┴────────────────────┤
│  SLIDER  Layer N / M  [━━━━━━━━━●━━━━━━━━━━━━━━━━━]  (travels toggle)   │
└──────────────────────────────────────────────────────────────────────────┘
```

Three-column grid inside the workspace zone:

```
grid grid-cols-[220px_minmax(0,1fr)_280px] gap-3 min-h-[560px]
```

The canvas column carries `flex-1 min-h-0` so it claims whatever the page
height allows. On viewports narrower than 900 px the three columns stack:
`md:grid-cols-[220px_minmax(0,1fr)_280px] grid-cols-1`.

Total page max-width: `1440px` (use `PageContainer maxWidth="wide"`).

---

## 2. Empty state (no file loaded)

The workspace region is replaced by a `EmptyState` centered in a
`Card variant="inset"` that occupies the full grid width.

```
icon:        <FileSearch2 size={32} strokeWidth={1.5} />
             colour: var(--color-ink-subtle)
title:       "No file loaded"
description: "Drop a Studio .gc export here, or click the button above to
              browse. Files are parsed locally — nothing is uploaded."
action:      <Button variant="outline" size="sm">Open .gc file…</Button>
```

The card itself has a diagonal warp texture applied via the `bg-diagonal`
utility (if it exists in the theme) or a subtle repeating SVG pattern at
`opacity-[0.04]` over `var(--color-bg)`. Height: `min-h-[400px]`.

---

## 3. Loading state

While the Web Worker is running (expect 1–4 s on a 33 MB file):

- Replace the three-column grid with a single full-width card.
- Inside: a spinner (`animate-spin` on a 20 px ring SVG, `var(--color-primary)`
  stroke) centred horizontally.
- Below spinner: `"Parsing filename.gc…"` in
  `font-mono text-[12px] text-[color:var(--color-ink-muted)]`.
- No progress bar (the worker doesn't emit progress events in v1). Do not
  fake a progress bar.

Transition in with a 150 ms fade so a fast parse on a small file doesn't
flash.

---

## 4. Error state

Replace the three-column grid with a single error banner inside a `Card`:

```
rounded-[8px] border border-[color:var(--color-destructive)]/30
bg-[color:var(--color-destructive-tint)] px-4 py-3
```

Inside:
- `<AlertCircle size={16} />` inline-left, `var(--color-destructive)`.
- `"Parser error: {message}"` in
  `text-[13px] text-[color:var(--color-destructive)]`.
- A "Try again" button (same as the toolbar Open button) right-aligned.

Pattern matches the Spectrum page's inline error treatment.

---

## 5. Toolbar region

Use `Toolbar` primitive with:

```
children (left-aligned):
  - Button variant="default" size="sm":  "Open .gc file…"
    Wraps a hidden <input type="file"> — Button renders as a <label>.
  - When kind=ready: mono status chip (plain span, not a Badge):
      "{filename}  ·  {lines.toLocaleString()} lines  ·  {elapsed} ms"
      font-mono text-[12px] text-[color:var(--color-ink-muted)]

trailing (right-aligned):
  - Travels toggle: Checkbox + label
      label: "Show travels"
      font-mono text-[11px] text-[color:var(--color-ink-muted)]
      gap-1.5 flex items-center
```

A `MetalBar variant="soft"` sits between the toolbar row and the workspace
(same pattern as Section headers).

---

## 6. Job bar

Only render when `file.jobs.length > 1`. If it renders, place it between
the Toolbar `MetalBar` and the three-column workspace — it is not inside
the workspace grid.

```
flex items-center gap-3 py-2
  Label: "Job"  —  text-[11px] font-semibold uppercase tracking-[0.08em]
                   text-[color:var(--color-ink-subtle)]
  <Select> native select, width auto (pick from ui/Select.tsx)
```

---

## 7. Layer list

**Container:** `Card variant="inset" padded={false}` with
`overflow-y-auto h-full`. No header card — `Section title="Layers"`
is not used here; the section label is already in the outer toolbar.

**List item anatomy (one button per layer):**

```
<button>
  w-full text-left
  px-3 py-2
  border-b border-[color:var(--color-border)] last:border-b-0
  hover:bg-[color:var(--color-surface-elevated)]
  transition-colors duration-75
  data-selected: bg-[color:var(--color-primary-tint)]
                 border-l-2 border-l-[color:var(--color-primary)]
                 (removes left padding to compensate: pl-[10px])

  Row 1 — primary identity:
    flex items-center gap-2

    Index chip:
      "L{index}"  —  font-mono text-[10px] font-semibold
      bg-[color:var(--color-surface-elevated)]
      border border-[color:var(--color-border-strong)]
      rounded-[3px] px-1.5 py-[1px]
      min-w-[28px] text-center
      (same geometry as Badge size="sm" but custom bg)

    Kind badge:
      <Badge variant="info" size="sm">bitmap</Badge>
      <Badge variant="accent" size="sm">vector</Badge>

    Power:
      "S {power}"  —  font-mono text-[11px] text-[color:var(--color-ink)]

  Row 2 — secondary counts:
    mt-[2px]
    font-mono text-[10px] text-[color:var(--color-ink-subtle)]
    "{blockCount} blk  ·  {segCount.toLocaleString()} seg"
    (density shown only when defined: "d={density}  · " prefix)
```

**Type hierarchy summary:**
- Row 1 index + kind + power are immediately scannable — 11 px mono.
- Row 2 is secondary metadata — 10 px mono, muted.
- Badge colours distinguish bitmap (info = navy) from vector (accent = rust).

---

## 8. Canvas region

**Container:** `Card variant="inset" padded={false}` with
`overflow-hidden flex items-stretch`. Background: `var(--color-substrate)`
(`#22201C`). The GcodeCanvas fills this element via `ResizeObserver`.

**Canvas chrome (drawn on the canvas itself, not DOM overlay):**

Render after the geometry pass so overlays sit on top.

- **Bbox readout** — bottom-left corner, inset 8 px from edge:
  `"W {width.toFixed(1)} mm  ×  H {height.toFixed(1)} mm"` white text,
  font-mono 10 px, `rgba(255,255,255,0.55)`.

- **Origin crosshair** — faint `rgba(255,255,255,0.12)` cross at the
  gcode origin `(0, 0)` mapped through the same scale/offset as the
  geometry. 1 px stroked, dashed `[4,4]`. Only visible if origin falls
  within the padded viewport; skip if outside.

- **Mm scale bar** — bottom-right corner, inset 12 px. Pick a round mm
  value that maps to 40–80 px at current scale. White rect outline 1 px,
  label `"{n} mm"` below it, same style as bbox readout. Max 2 significant
  figures.

- **No axis ticks.** The bbox readout already tells the user the extent;
  tick marks add visual noise on a forensic viewport that auto-zooms per
  layer.

**Loading overlay** (between file drop and first render): solid
`var(--color-substrate)` fill + the spinner centred.

---

## 9. Params box

**Container:** `Card variant="default" padded={false}` with
`overflow-y-auto h-full flex flex-col`.

**Two-block internal layout:**

```
METADATA BLOCK
  px-3 pt-3 pb-2
  border-b border-[color:var(--color-border)]
  font-mono text-[11px]

  Each metadata row is a flex pair:
    label (text-[color:var(--color-ink-subtle)] uppercase tracking-[0.06em]):
    value (text-[color:var(--color-ink)])

  Rows:
    BBOX     (minX, minY) → (maxX, maxY)  in mm, 2 dp
    SIZE     W × H  mm
    BLOCKS   {count}
    SEGS     {totalSegments.toLocaleString()}
    CONFIG   (raw byte-count): {layer.config.raw.length} B

JSON BLOCK
  flex-1 overflow-y-auto
  px-3 py-2
  font-mono text-[11px] leading-[1.6]
  white-space: pre

  Key–value syntax colouring via inline spans (no external lib):
    Keys:      text-[color:var(--color-secondary)]  (navy / mid-blue)
    Strings:   text-[color:var(--color-success)]    (green)
    Numbers:   text-[color:var(--color-primary)]    (rust)
    Booleans:  text-[color:var(--color-warning)]    (amber)
    Punctuation: text-[color:var(--color-ink-muted)]

  Produce via a small `coloriseJson(raw: string): ReactNode` helper that
  runs a regex over the pretty-printed JSON string and wraps tokens in
  <span> elements. ~30 lines, no external dependency.

  If `layer.config.parsed` is null (bad JSON): show the raw string in
  text-[color:var(--color-destructive)] with a header
  "⚠ blockConfig is not valid JSON".
```

---

## 10. Slider region

Sits outside the three-column grid, separated from it by 8 px margin.

```
flex items-center gap-3 py-2 px-1

Layer counter:
  "Layer {layerIdx + 1} / {total}"
  font-mono text-[12px] text-[color:var(--color-ink-muted)]
  whitespace-nowrap min-w-[80px]

Range input (Radix Slider is overkill here — plain <input type="range">):
  flex-1
  accent-color: var(--color-primary)
  cursor-pointer disabled:cursor-default disabled:opacity-40

  Apply these CSS custom properties on the element to match the design:
    [&::-webkit-slider-thumb]:accent-[color:var(--color-primary)]
    [&::-webkit-slider-runnable-track]:h-[3px]
    [&::-webkit-slider-runnable-track]:rounded-full
    [&::-webkit-slider-runnable-track]:bg-[color:var(--color-border-strong)]
    (Full Radix Slider override is acceptable if the existing app already
    uses it elsewhere — check PixelArtPage and LoomPage first.)

Disabled state when layers.length <= 1: opacity-40 pointer-events-none.
```

Note: other pages in the app (Loom's scrub bar, Spectrum's clip range) use
plain `<input type="range">` with `accent-color`, not Radix Slider.
Mirror that pattern.

---

## 11. Colour ramp — burn segments and travels

**Burn segments** (`s > 0` and `!rapid`):

Power maps linearly to a warm ramp: 0 → black, 1000 → #FF5010 (a slightly
hotter version of `var(--color-primary)`). In code:

```
r = Math.round((s / 1000) * 255)
g = Math.round((s / 1000) * 80)
b = Math.round((s / 1000) * 16)
strokeStyle = `rgb(${r}, ${g}, ${b})`
```

This mirrors the physical intuition: dim power is near-invisible, full
power is the hot rust-orange of the brand colour.

**Travels** (`rapid === true` or `s === 0`):

`rgba(150, 150, 150, 0.30)` dashed `[2, 4]`, lineWidth 0.7. Intentionally
very faint — they are structural navigation, not the payload.

**Vector vs bitmap visual distinction:**

Do not differ the colour ramp between vector and bitmap. The distinction is
already communicated in the layer list (Badge) and params box. Changing the
canvas colour ramp by layer kind would require the user to remember two
mental maps. One ramp, power = brightness.

**Canvas background:**

`var(--color-substrate)` (#22201C). This is the existing token for "the
physical workpiece" — already used by TestPreview. Keeps the tool-palette
consistent.

---

## 12. Specific copy

| Location | Copy |
|---|---|
| Page `<title>` | `"Gcode"` (matched to route arm in App.tsx) |
| Section title | `"Gcode Viewer"` |
| TopBar nav entry | `"Gcode"` (short, consistent with "Guide", "Loom") |
| File open button | `"Open .gc file…"` |
| Empty state title | `"No file loaded"` |
| Empty state body | `"Drop a Studio .gc export here, or click the button above to browse. Files are parsed locally — nothing is uploaded."` |
| Loading body | `"Parsing {filename}…"` |
| Error prefix | `"Parser error: "` |
| Travels label | `"Show travels"` |
| Layer counter | `"Layer {n} / {total}"` |
| Bbox readout (canvas) | `"W {w} mm × H {h} mm"` |
| Params section header | `"BBOX"`, `"SIZE"`, `"BLOCKS"`, `"SEGS"`, `"CONFIG"` (all-caps, 11px mono) |
| No-layer fallback | `"—"` |

---

## 13. Concrete Tailwind class strings for the engineer

Paste these directly:

```
// Three-column workspace
"grid md:grid-cols-[220px_minmax(0,1fr)_280px] grid-cols-1 gap-3 min-h-[560px]"

// Layer list container
"rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] overflow-y-auto h-full"

// Layer list item — idle
"w-full text-left px-3 py-2 border-b border-[color:var(--color-border)] last:border-b-0 hover:bg-[color:var(--color-surface-elevated)] transition-colors duration-75"

// Layer list item — selected
"bg-[color:var(--color-primary-tint)] border-l-2 border-l-[color:var(--color-primary)] pl-[10px]"

// Layer list row 1 (kind + power)
"flex items-center gap-2 font-mono text-[11px] text-[color:var(--color-ink)]"

// Layer list row 2 (counts)
"mt-[2px] font-mono text-[10px] text-[color:var(--color-ink-subtle)]"

// Canvas container
"rounded-[10px] border border-[color:var(--color-border)] overflow-hidden flex items-stretch bg-[color:var(--color-substrate)]"

// Params box container
"rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)] overflow-y-auto h-full flex flex-col"

// Params metadata block
"px-3 pt-3 pb-2 border-b border-[color:var(--color-border)] font-mono text-[11px] flex flex-col gap-[3px]"

// Params metadata label
"text-[color:var(--color-ink-subtle)] uppercase tracking-[0.06em] text-[10px] font-semibold"

// Params JSON block
"flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.6] whitespace-pre"

// Slider row
"flex items-center gap-3 py-2 px-1 mt-1"

// Layer counter
"font-mono text-[12px] text-[color:var(--color-ink-muted)] whitespace-nowrap min-w-[80px]"

// Status chip (filename + stats)
"font-mono text-[12px] text-[color:var(--color-ink-muted)] truncate max-w-[420px]"

// Error banner
"rounded-[8px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-4 py-3 text-[13px] text-[color:var(--color-destructive)] flex items-center gap-2"

// Section title override (the outer Section)
// Use dense prop + title="Gcode Viewer" — no extra classes needed.
```

---

## 14. JSON syntax colouring — implementation note

The params box needs no external library. A 30-line helper:

```
function coloriseJson(raw: string): ReactNode[] {
  // Tokenise the pretty-printed string with one regex pass.
  // Groups: (key string) | (string value) | (number) | (boolean/null) | (punct)
  const TOKEN = /"([^"\\]|\\.)*"(?=\s*:)|"([^"\\]|\\.)*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|true|false|null|[{}\[\],:]|\s+/g;
}
```

Colour each token type with a `<span className="...">` wrapping the raw
substring. Keys (matched by the `"...":` pattern) get the secondary colour;
strings get success green; numbers get primary rust; booleans/null get
warning amber; structural punctuation and whitespace are muted.

---

## 15. Responsive and accessibility notes

- The hidden `<input type="file">` is keyboard-reachable via its wrapping
  `<label>` (the Button). Do not add `tabIndex={-1}` to the input.
- Layer list buttons carry `aria-selected` and the parent list element
  carries `role="listbox"` or equivalent so screen readers announce
  navigation.
- Canvas carries `aria-label="Gcode layer preview"` (already in the Task 9
  stub).
- The Travels checkbox label wraps the input — no `htmlFor` needed but
  acceptable.

---

## 16. What this design deliberately omits

- **Block-level drill-down within a layer.** Out of scope per the plan's
  deferred list. The layer list is the only navigation level v1 ships.
- **Dark-mode custom canvas palette.** The canvas background is
  `var(--color-substrate)` — same dark tone in both modes. The burn colour
  ramp is already legible on dark. No special-casing needed.
- **Warp texture on the empty state card.** Acceptable if the utility
  exists; skip if it requires creating a new CSS utility.
