# Pixel Art Palette Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Pixel Art layer's palette picker from a single "8 nearest by ΔE" list into three stacked sections — Similar, ★ Favourites, and a hue-sorted, filterable All — so any existing palette entry for the active material is reachable.

**Architecture:** Pure derivation helpers (`rankByDeltaE`, `hueOf`/`hueSorted`, `matchesFilter`) move into a new co-located module `pixelArtPaletteSections.ts`; `ExpandedLayerPanel` (in `PixelArtLayerPanel.tsx`) renders three sections built from those helpers plus local UI state (`similarShown`, `allOpen`, `allFilter`). A shared `PaletteEntryRow` renders each selectable row. No backend, schema, or persistence change; the `onChooseMatch(color, entry)` contract is untouched.

**Tech Stack:** TypeScript + React + Vite + vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-08-pixel-art-palette-picker-design.md`

**Conventions (read once):**
- Frontend checks: `cd web && npx tsc --noEmit && npm test`.
- After any `web/src/**` change the served bundle is stale until `cd web && npm run build`.
- Don't use `--no-verify`. Commit messages end with the `Co-Authored-By` trailer (shown in Task 1).
- `PaletteEntry` (in `web/src/types.ts`) has at least: `id, machine_id, test_id, material_id, x_value, y_value, hex, lab, params, sigma, source, source_result_id, notes, favorited, created_at`. Tests below build minimal valid fixtures.

---

### Task 1: Pure section helpers + unit tests

Extract the ΔE ranking out of the panel and add hue-sort + filter helpers, all pure and unit-tested.

**Files:**
- Create: `web/src/components/pixelArtPaletteSections.ts`
- Create: `web/src/components/pixelArtPaletteSections.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/pixelArtPaletteSections.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import {
  rankByDeltaE,
  hueOf,
  hueSorted,
  matchesFilter,
} from "./pixelArtPaletteSections";
import type { PaletteEntry } from "../types";

// Minimal valid PaletteEntry. lab=[] forces the hex→Lab fallback path so
// fixtures only need a hex.
function pe(hex: string, over: Partial<PaletteEntry> = {}): PaletteEntry {
  return {
    id: Math.abs(hashStr(hex)) + (over.id ? 0 : 0),
    machine_id: "F2Ultra",
    test_id: null,
    material_id: 1,
    x_value: null,
    y_value: null,
    hex,
    lab: [],
    params: {},
    sigma: 0,
    source: "manual",
    source_result_id: null,
    notes: "",
    favorited: false,
    created_at: "2026-06-08T00:00:00Z",
    ...over,
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

describe("rankByDeltaE", () => {
  it("orders entries nearest-first; an exact match is ΔE≈0", () => {
    const entries = [pe("#ffffff", { id: 1 }), pe("#000000", { id: 2 }), pe("#c47a3e", { id: 3 })];
    const ranked = rankByDeltaE(entries, "#c47a3e");
    expect(ranked[0].entry.id).toBe(3);
    expect(ranked[0].dE).toBeCloseTo(0, 1);
    // monotonic non-decreasing ΔE
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].dE).toBeGreaterThanOrEqual(ranked[i - 1].dE);
    }
  });

  it("returns dE 0 for every entry when the target colour is malformed", () => {
    const ranked = rankByDeltaE([pe("#ffffff", { id: 1 })], "not-a-colour");
    expect(ranked[0].dE).toBe(0);
  });
});

describe("hueOf", () => {
  it("maps primaries to expected hue ranges", () => {
    expect(hueOf("#ff0000")).toBeCloseTo(0, 0);
    expect(hueOf("#00ff00")).toBeCloseTo(120, 0);
    expect(hueOf("#0000ff")).toBeCloseTo(240, 0);
  });

  it("sorts neutrals after all hues (>= 360)", () => {
    expect(hueOf("#808080")).toBeGreaterThanOrEqual(360);
    expect(hueOf("#000000")).toBeGreaterThanOrEqual(360);
    expect(hueOf("#ffffff")).toBeGreaterThanOrEqual(360);
  });
});

describe("hueSorted", () => {
  it("yields rainbow order then neutrals, without mutating the input", () => {
    const input = [pe("#0000ff", { id: 1 }), pe("#808080", { id: 2 }), pe("#ff0000", { id: 3 }), pe("#00ff00", { id: 4 })];
    const out = hueSorted(input);
    expect(out.map((e) => e.id)).toEqual([3, 4, 1, 2]); // red, green, blue, neutral
    expect(input.map((e) => e.id)).toEqual([1, 2, 3, 4]); // input untouched
  });
});

describe("matchesFilter", () => {
  it("matches label or hex, case-insensitive; empty query matches all", () => {
    expect(matchesFilter("", "SS Tag · gold", "#d4af37")).toBe(true);
    expect(matchesFilter("GOLD", "SS Tag · gold", "#d4af37")).toBe(true);
    expect(matchesFilter("d4af", "SS Tag · gold", "#d4af37")).toBe(true);
    expect(matchesFilter("steel", "SS Tag · gold", "#d4af37")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/components/pixelArtPaletteSections.test.ts`
Expected: FAIL — the module `./pixelArtPaletteSections` doesn't exist yet.

- [ ] **Step 3: Create the helper module**

Create `web/src/components/pixelArtPaletteSections.ts`:

```ts
/**
 * Pure helpers for the Pixel Art palette picker's three sections
 * (Similar / Favourites / All). Kept out of the component so they're
 * unit-testable and the panel stays focused on rendering.
 */

import { deltaE2000, hexToLab, type Lab } from "../color/math";
import type { PaletteEntry } from "../types";

export interface RankedEntry {
  entry: PaletteEntry;
  /** ΔE2000 from the layer colour; 0 when the layer colour is malformed. */
  dE: number;
}

/** Rank palette entries by ΔE2000 distance from ``color`` (nearest first).
 *  Uses each entry's stored Lab when present, else derives it from the hex.
 *  A malformed ``color`` yields dE 0 for all (preserves prior behaviour). */
export function rankByDeltaE(
  entries: PaletteEntry[],
  color: string,
): RankedEntry[] {
  const targetLab = /^#[0-9a-fA-F]{6}$/.test(color) ? hexToLab(color) : null;
  const ranked = entries.map((entry) => {
    const eLab =
      entry.lab.length >= 3
        ? ([entry.lab[0], entry.lab[1], entry.lab[2]] as Lab)
        : hexToLab(entry.hex);
    return { entry, dE: targetLab ? deltaE2000(targetLab, eLab) : 0 };
  });
  ranked.sort((a, b) => a.dE - b.dE);
  return ranked;
}

/** HSL hue (0–360) of a ``#rrggbb`` hex. Near-grey colours (saturation ≈ 0)
 *  return ``360 + lightness*100`` so neutrals sort *after* all hues, ordered
 *  light→dark-agnostic by lightness. Unparseable input sorts last (1000). */
export function hueOf(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 1000;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return 360 + l * 100; // neutral → after all hues
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

/** Return a hue-sorted copy of ``entries`` (neutrals last). Non-mutating. */
export function hueSorted(entries: PaletteEntry[]): PaletteEntry[] {
  return [...entries].sort((a, b) => hueOf(a.hex) - hueOf(b.hex));
}

/** Case-insensitive substring match of ``query`` against an entry's display
 *  ``label`` or ``hex``. Empty/whitespace query matches everything. */
export function matchesFilter(query: string, label: string, hex: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q) || hex.toLowerCase().includes(q);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/pixelArtPaletteSections.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/pixelArtPaletteSections.ts web/src/components/pixelArtPaletteSections.test.ts
git commit -m "$(cat <<'EOF'
feat(pixel-art): pure palette-section helpers (rank/hue/filter)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rework `ExpandedLayerPanel` into three sections

Replace the single top-8 list with Similar / Favourites / All, using the Task 1 helpers and a shared row component. Export the panel so it can be unit-tested directly.

**Files:**
- Modify: `web/src/components/PixelArtLayerPanel.tsx`
- Test: `web/src/components/PixelArtLayerPanel.test.tsx`

- [ ] **Step 1: Write the failing component test**

Append to `web/src/components/PixelArtLayerPanel.test.tsx` (it already imports `render`, `screen`, `describe`, `it`, `expect` and `defaultBaseParams`; add `fireEvent` + the new imports). Add at the top, after the existing imports:

```tsx
import { fireEvent } from "@testing-library/react";
import { ExpandedLayerPanel } from "./PixelArtLayerPanel";
import type { PaletteEntry } from "../types";
```

Then append this describe block to the end of the file:

```tsx
function entry(hex: string, over: Partial<PaletteEntry> = {}): PaletteEntry {
  return {
    id: over.id ?? Math.floor(Math.random() * 1e9),
    machine_id: "F2Ultra",
    test_id: null,
    material_id: 1,
    x_value: null,
    y_value: null,
    hex,
    lab: [],
    params: {},
    sigma: 0,
    source: "manual",
    source_result_id: null,
    notes: "",
    favorited: false,
    created_at: "2026-06-08T00:00:00Z",
    ...over,
  };
}

function expandedRow(over: Partial<PixelArtLayerRow> = {}): PixelArtLayerRow {
  return {
    color: "#c47a3e",
    enabled: true,
    areaPct: 0.5,
    cellCount: 100,
    isNearWhite: false,
    matchedEntry: null,
    baseParams: defaultBaseParams(),
    materialId: null,
    ...over,
  };
}

describe("ExpandedLayerPanel sections", () => {
  // 10 non-favourite + 2 favourite entries.
  const many: PaletteEntry[] = [
    ...Array.from({ length: 10 }, (_, i) =>
      entry(`#${(0x111111 * (i + 1)).toString(16).padStart(6, "0").slice(0, 6)}`, { id: 100 + i }),
    ),
    entry("#d4af37", { id: 900, favorited: true }),
    entry("#b87333", { id: 901, favorited: true }),
  ];

  it("shows the Similar and Favourites section headers", () => {
    render(
      <ExpandedLayerPanel
        row={expandedRow()}
        paletteEntries={many}
        library={baseLibrary}
        onChooseMatch={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Similar/i)).toBeInTheDocument();
    expect(screen.getByText(/Favourites/i)).toBeInTheDocument();
    expect(screen.getByText(/^All ·/i)).toBeInTheDocument();
  });

  it("hides the Favourites section when there are none", () => {
    const noFavs = many.filter((e) => !e.favorited);
    render(
      <ExpandedLayerPanel
        row={expandedRow()}
        paletteEntries={noFavs}
        library={baseLibrary}
        onChooseMatch={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/Favourites/i)).toBeNull();
  });

  it("Load more grows the Similar list", () => {
    render(
      <ExpandedLayerPanel
        row={expandedRow()}
        paletteEntries={many}
        library={baseLibrary}
        onChooseMatch={() => {}}
        onClose={() => {}}
      />,
    );
    const loadMore = screen.getByText(/Load more/i);
    fireEvent.click(loadMore);
    // 12 total entries → after one more page (8 + 8) all are shown, button gone.
    expect(screen.queryByText(/Load more/i)).toBeNull();
  });

  it("All is collapsed by default and expands with a filter box", () => {
    render(
      <ExpandedLayerPanel
        row={expandedRow()}
        paletteEntries={many}
        library={baseLibrary}
        onChooseMatch={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByPlaceholderText(/filter by name or hex/i)).toBeNull();
    fireEvent.click(screen.getByText(/^All ·/i));
    expect(screen.getByPlaceholderText(/filter by name or hex/i)).toBeInTheDocument();
  });

  it("calls onChooseMatch with the picked entry", () => {
    const picked: (PaletteEntry | null)[] = [];
    render(
      <ExpandedLayerPanel
        row={expandedRow()}
        paletteEntries={[entry("#c47a3e", { id: 1 })]}
        library={baseLibrary}
        onChooseMatch={(_c, e) => picked.push(e)}
        onClose={() => {}}
      />,
    );
    // The single nearest row.
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.includes("ΔE"))!);
    expect(picked[0]?.id).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/PixelArtLayerPanel.test.tsx`
Expected: FAIL — `ExpandedLayerPanel` is not exported (import error), and the section text/placeholder don't exist yet.

- [ ] **Step 3: Update the panel imports**

In `web/src/components/PixelArtLayerPanel.tsx`, **remove** the now-unused color-math import (line ~31):

```ts
import { deltaE2000, hexToLab, type Lab } from "../color/math";
```

and **add** (next to the other relative imports, e.g. after the `FormatToggle` import):

```ts
import {
  rankByDeltaE,
  hueSorted,
  matchesFilter,
} from "./pixelArtPaletteSections";
```

- [ ] **Step 4: Replace `ExpandedLayerPanel` with the three-section version**

Replace the entire `ExpandedLayerPanel` function (from `function ExpandedLayerPanel({` through its closing `}` — the block that today computes `ranked`/`topRanked` and renders the single `<ul>`) with:

```tsx
export function ExpandedLayerPanel({
  row,
  paletteEntries,
  library,
  onChooseMatch,
  onClose,
}: ExpandedLayerPanelProps) {
  const SIMILAR_PAGE = 8;
  const [similarShown, setSimilarShown] = useState(SIMILAR_PAGE);
  const [allOpen, setAllOpen] = useState(false);
  const [allFilter, setAllFilter] = useState("");

  // Reset transient picker UI when the selected layer colour or the
  // palette identity changes — a fresh layer starts collapsed at page 1.
  useEffect(() => {
    setSimilarShown(SIMILAR_PAGE);
    setAllOpen(false);
    setAllFilter("");
  }, [row.color, paletteEntries]);

  const ranked = rankByDeltaE(paletteEntries, row.color);
  const dEById = new Map(ranked.map((r) => [r.entry.id, r.dE]));
  const favourites = ranked.filter((r) => r.entry.favorited);
  const allFiltered = hueSorted(paletteEntries).filter((e) =>
    matchesFilter(allFilter, paletteEntryLabel(e, library), e.hex),
  );

  const sectionHeader =
    "px-1.5 pt-1.5 pb-0.5 font-mono text-[9px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]";

  return (
    <div className="rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] flex flex-col min-h-0">
      <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
        <div className="flex items-center gap-2 min-w-0">
          <div
            aria-hidden
            className="h-4 w-4 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
            style={{ background: row.color }}
          />
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)] truncate">
            Match · {row.color}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[9.5px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)]"
          aria-label="Close picker"
        >
          ✕
        </button>
      </div>

      {paletteEntries.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-[color:var(--color-ink-subtle)]">
          No palette entries for the active material. Add some on the
          Palette tab and the matcher will fill in.
        </div>
      ) : (
        <div className="overflow-y-auto p-1 flex-1 min-h-0" style={{ maxHeight: 460 }}>
          {/* ── Similar ─────────────────────────────────────────── */}
          <div className={sectionHeader}>Similar · nearest ΔE</div>
          <ul>
            {ranked.slice(0, similarShown).map(({ entry, dE }) => (
              <PaletteEntryRow
                key={entry.id}
                entry={entry}
                dE={dE}
                selected={row.matchedEntry?.id === entry.id}
                library={library}
                onPick={() => onChooseMatch(row.color, entry)}
              />
            ))}
          </ul>
          {similarShown < ranked.length && (
            <button
              type="button"
              onClick={() => setSimilarShown((n) => n + SIMILAR_PAGE)}
              className="w-full text-left px-2 py-1.5 text-[11px] text-[color:var(--color-primary)] hover:underline"
            >
              ⌄ Load more ({Math.min(similarShown, ranked.length)} of {ranked.length})
            </button>
          )}

          {/* ── Favourites (only when present) ──────────────────── */}
          {favourites.length > 0 && (
            <div className="border-t border-[color:var(--color-border)] mt-1">
              <div className={sectionHeader}>★ Favourites</div>
              <ul>
                {favourites.map(({ entry, dE }) => (
                  <PaletteEntryRow
                    key={entry.id}
                    entry={entry}
                    dE={dE}
                    selected={row.matchedEntry?.id === entry.id}
                    library={library}
                    onPick={() => onChooseMatch(row.color, entry)}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* ── All (collapsed by default) ──────────────────────── */}
          <div className="border-t border-[color:var(--color-border)] mt-1">
            <button
              type="button"
              onClick={() => setAllOpen((o) => !o)}
              className={cn(sectionHeader, "w-full text-left hover:text-[color:var(--color-ink)]")}
            >
              All · {paletteEntries.length} · sorted by hue {allOpen ? "⌃" : "⌄"}
            </button>
            {allOpen && (
              <>
                <input
                  type="text"
                  value={allFilter}
                  onChange={(e) => setAllFilter(e.target.value)}
                  placeholder="filter by name or hex…"
                  className="w-[calc(100%-0.75rem)] mx-1.5 mb-1 px-2 py-1 rounded-[5px] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-[11.5px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-subtle)]"
                />
                <ul>
                  {allFiltered.map((entry) => (
                    <PaletteEntryRow
                      key={entry.id}
                      entry={entry}
                      dE={dEById.get(entry.id) ?? 0}
                      selected={row.matchedEntry?.id === entry.id}
                      library={library}
                      onPick={() => onChooseMatch(row.color, entry)}
                    />
                  ))}
                </ul>
                {allFiltered.length === 0 && (
                  <div className="px-2 py-1.5 text-[11px] text-[color:var(--color-ink-subtle)]">
                    no matches
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Clear ───────────────────────────────────────────── */}
          {row.matchedEntry && (
            <div className="border-t border-[color:var(--color-border)] mt-1 pt-1">
              <button
                type="button"
                onClick={() => onChooseMatch(row.color, null)}
                className={cn(
                  "w-full px-2 py-1.5 rounded-[6px] text-left",
                  "text-[11px] text-[color:var(--color-ink-muted)]",
                  "hover:bg-[color:var(--color-primary-tint)]/30",
                )}
              >
                Clear match
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One selectable palette row — swatch, label, ΔE, and a ✓ when it's the
 *  current match. Shared by all three picker sections so an entry looks
 *  identical wherever it appears. */
function PaletteEntryRow({
  entry,
  dE,
  selected,
  library,
  onPick,
}: {
  entry: PaletteEntry;
  dE: number;
  selected: boolean;
  library: LibraryState;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-[6px] text-left",
          "hover:bg-[color:var(--color-primary-tint)]/40",
          selected && "bg-[color:var(--color-primary-tint)]/60",
        )}
      >
        <span
          aria-hidden
          className="h-4 w-4 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
          style={{ background: entry.hex }}
        />
        <span className="flex-1 min-w-0 truncate text-[11.5px] text-[color:var(--color-ink)]">
          {paletteEntryLabel(entry, library)}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
          ΔE {dE.toFixed(1)}
        </span>
        {selected && (
          <Check className="h-3 w-3 text-[color:var(--color-success)] shrink-0" />
        )}
      </button>
    </li>
  );
}
```

(Leave the existing `paletteEntryLabel` function — defined just below — in place; both `ExpandedLayerPanel` and `PaletteEntryRow` call it.)

- [ ] **Step 5: Run the component tests to verify they pass**

Run: `cd web && npx vitest run src/components/PixelArtLayerPanel.test.tsx`
Expected: PASS (existing tests + the 5 new section tests).

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS — no unused-import error (the `color/math` import was removed in Step 3), no missing-prop errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/PixelArtLayerPanel.tsx web/src/components/PixelArtLayerPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(pixel-art): Similar/Favourites/All palette picker sections

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Changelog + full verification + build

**Files:**
- Create: `changelog/2026-06-08-pixel-art-palette-picker.md`

- [ ] **Step 1: Write the changelog entry**

Create `changelog/2026-06-08-pixel-art-palette-picker.md`:

```markdown
---
id: 2026-06-08-pixel-art-palette-picker
date: 2026-06-08
level: minor
title: Pixel Art — pick any palette colour, not just the nearest
summary: The layer colour picker now has Similar, Favourites, and a hue-sorted All section so you can reach any entry, not only the 8 closest.
---

Matching a Pixel Art layer to a palette colour used to show only the eight
nearest entries by ΔE — there was no way to reach a favourite that wasn't
close, or to scroll the whole palette. The picker now has three sections:
**Similar** (nearest, with a "Load more"), **★ Favourites** (each with its
ΔE), and **All** — every entry for the material, sorted by hue and
filterable by name or hex. Picking still uses the colour's validated burn
parameters; nothing about the export changes.
```

- [ ] **Step 2: Backend suite (no-regression sanity)**

Run: `uv run --active pytest tests/ -q` (or, in a fresh venv, `.venv/bin/python -m pytest tests/ -q`)
Expected: PASS. (No backend files changed; this just confirms nothing broke.)

- [ ] **Step 3: Frontend typecheck + unit tests**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 4: Build the served bundle**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add changelog/2026-06-08-pixel-art-palette-picker.md
git commit -m "$(cat <<'EOF'
docs(changelog): pixel-art expanded palette picker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Browser verification + push + PR

Per `CLAUDE.md`, a UI change isn't done until it's loaded in a real browser and the screenshot read critically.

**Files:** none.

- [ ] **Step 1: Run the server**

Run (background shell): `uv run --active xcs-gen serve --host 127.0.0.1 --port 8017`
(Or, from a fresh clone venv: `.venv/bin/xcs-gen serve --host 127.0.0.1 --port 8017 --no-browser`.)

- [ ] **Step 2: Drive the page**

Navigate to `http://127.0.0.1:8017/#/pixel-art`. Upload an image, select a layer tile to open the picker, then confirm:
- Similar shows ~8 with ΔE; **Load more** grows it.
- **★ Favourites** appears only when the material has favourited entries, each with ΔE.
- **All** is collapsed; expanding shows the hue-sorted list + filter box; typing narrows it; "no matches" shows when nothing matches.
- Picking from any section updates the layer's matched swatch; **Clear match** still works.

Read the screenshot critically: section headers legible, swatches/labels aligned, the panel uses the available height without overflowing the card.

- [ ] **Step 3: Push the branch**

Run: `git push -u origin feat/pixel-art-palette-picker`

- [ ] **Step 4: Open a draft PR**

```bash
gh pr create --draft \
  --title "Pixel Art — expanded palette picker (Similar / Favourites / All)" \
  --body "$(cat <<'EOF'
Reworks the Pixel Art layer colour picker from a single "8 nearest by ΔE"
list into three stacked sections: Similar (nearest + Load more), ★ Favourites
(each with ΔE, hidden when none), and All (every entry for the material,
hue-sorted, with a name/hex filter). Any existing entry is now reachable.

Pure frontend: new pixelArtPaletteSections.ts helpers (rank/hue/filter,
unit-tested), ExpandedLayerPanel reworked into sections with a shared
PaletteEntryRow. No backend/schema/persistence change; onChooseMatch is
untouched.

Spec: docs/superpowers/specs/2026-06-08-pixel-art-palette-picker-design.md
Plan: docs/superpowers/plans/2026-06-08-pixel-art-palette-picker.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Flip to ready when CI is green**

Run: `gh pr ready` (after CI passes).

---

## Self-Review notes (resolved during authoring)

- **Spec coverage:** three sections (Task 2); Similar + Load more (Task 2 render + test); Favourites with ΔE, hidden when empty (Task 2 render + test); All collapsed/hue-sorted/filter (Task 1 `hueSorted`/`matchesFilter` + Task 2 render + test); pick-any-entry via `onChooseMatch` unchanged (Task 2 + test); Clear + empty-state preserved (Task 2); pure helpers unit-tested (Task 1); minor changelog (Task 3); browser check (Task 4). All covered.
- **Type consistency:** `RankedEntry = { entry, dE }` (helpers) used by panel; `rankByDeltaE`/`hueSorted`/`matchesFilter` signatures match call sites; `PaletteEntryRow` props (`entry, dE, selected, library, onPick`) match every call; `ExpandedLayerPanelProps` unchanged so `PixelArtLayerPanel`'s existing render of `<ExpandedLayerPanel …>` needs no edit; `ExpandedLayerPanel` newly **exported** for the test import.
- **Import hygiene:** `deltaE2000`/`hexToLab`/`Lab` removed from the panel (moved into the helper module) — only the ranking used them, so no dangling refs; `useState`/`useEffect`/`Check`/`cn` already imported.
- **No DB / no migration** → no alembic version bump (avoids the CI gotcha in `CLAUDE.md`).
```
