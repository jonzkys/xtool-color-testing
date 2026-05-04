import { useEffect, useMemo, useState } from "react";
import type { ResultRecord, TestRecord } from "../types";
import type { Material } from "../library";
import { cn, EmptyState, Input, Select } from "../ui";

interface Props {
  /** All validation tests on the current machine. */
  tests: TestRecord[];
  /** Active material set, used for the test filter dropdown. */
  materials: Material[];
  /** Currently selected base test id (or undefined when none). */
  selectedTestId: number | undefined;
  onSelectTest: (id: number | undefined) => void;
  /** Results for the currently selected base test. */
  results: ResultRecord[] | null;
  resultsLoading: boolean;
  /** Result ids ticked in the comparison set. */
  selectedResultIds: number[];
  onToggleResult: (id: number) => void;
  /** Optional error string to surface inline. */
  error?: string;
  /** When ``true`` the rail collapses to a thin strip — just an
   *  expand button + a one-line summary of what's currently
   *  picked. The freed pixels reflow to the chart + stats strip. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Left rail of the Stability page — base-test combobox + multi-select
 * result list. The aesthetic register matches the SpectrumPage / Loom
 * page sidebars: monospaced labels in tracking-[0.18em] uppercase,
 * thin metallic dividers, and EmptyState fallbacks for the three
 * "no data yet" outcomes (no validation tests, no results, picker
 * loading).
 */
export function StabilityPicker({
  tests,
  materials,
  selectedTestId,
  onSelectTest,
  results,
  resultsLoading,
  selectedResultIds,
  onToggleResult,
  error,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const [search, setSearch] = useState("");
  const [materialFilter, setMaterialFilter] = useState<number | "all">("all");

  // Reset the search whenever the test set itself changes wholesale
  // (e.g. machine switch). Material filter survives — it's user intent.
  useEffect(() => {
    setSearch("");
  }, [tests.length]);

  const filteredTests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tests.filter((t) => {
      if (materialFilter !== "all" && t.material_id !== materialFilter) {
        return false;
      }
      if (q.length === 0) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        String(t.id).includes(q)
      );
    });
  }, [tests, search, materialFilter]);

  const materialName = (id: number) =>
    materials.find((m) => m.id === id)?.name ?? `material #${id}`;

  const selectedTest =
    selectedTestId != null ? tests.find((t) => t.id === selectedTestId) : null;

  if (collapsed) {
    return (
      <CollapsedRail
        selectedTest={selectedTest ?? null}
        selectedResultCount={selectedResultIds.length}
        totalResultCount={results?.length ?? 0}
        onExpand={onToggleCollapsed}
      />
    );
  }

  return (
    <aside
      className={cn(
        "shrink-0 w-[280px] flex flex-col min-h-0",
        "border-r border-[color:var(--color-border)]",
        "bg-[color:var(--color-surface)]",
      )}
    >
      {/* ── Base test selector ───────────────────────────────────────── */}
      <div className="px-3 py-3 border-b border-[color:var(--color-border)] flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <RailLabel text="Base test" />
          <CollapseButton
            onClick={onToggleCollapsed}
            label="Collapse"
            direction="left"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Select
            value={materialFilter === "all" ? "" : String(materialFilter)}
            onChange={(e) =>
              setMaterialFilter(
                e.target.value === "" ? "all" : Number(e.target.value),
              )
            }
          >
            <option value="">All materials</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Input
            type="search"
            placeholder="Search by name or #id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search validation tests"
          />
        </div>
      </div>

      {/* ── Test list ────────────────────────────────────────────────── */}
      <div
        className="flex-1 min-h-0 overflow-y-scroll"
        style={{ scrollbarGutter: "stable" }}
      >
        {tests.length === 0 ? (
          <EmptyState
            title="No validation tests"
            description="Create a validation test on the Tests page to compare its results here."
          />
        ) : filteredTests.length === 0 ? (
          <div className="px-3 py-6 text-center font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
            No tests match.
          </div>
        ) : (
          <ul className="flex flex-col">
            {filteredTests.map((t) => {
              const active = t.id === selectedTestId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelectTest(t.id)}
                    className={cn(
                      "w-full text-left px-3 py-2",
                      "border-b border-[color:var(--color-border)]/60",
                      "transition-colors",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)] focus-visible:ring-inset",
                      active
                        ? "bg-[color:var(--color-primary-tint)]/50 border-l-[3px] border-l-[color:var(--color-primary)] pl-[9px]"
                        : "hover:bg-[color:var(--color-surface-elevated)] border-l-[3px] border-l-transparent pl-[9px]",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span
                        className={cn(
                          "font-mono text-[10.5px] font-semibold tabular-nums",
                          active
                            ? "text-[color:var(--color-primary)]"
                            : "text-[color:var(--color-ink-subtle)]",
                        )}
                      >
                        #{t.id}
                      </span>
                      <span className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
                        {t.spec.cells_per_row ?? "—"}×{t.validation_cells.length}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "text-[12.5px] leading-tight truncate",
                        active
                          ? "text-[color:var(--color-ink)] font-medium"
                          : "text-[color:var(--color-ink)]",
                      )}
                    >
                      {t.name || "Untitled"}
                    </div>
                    <div className="mt-0.5 font-mono text-[9.5px] tracking-[0.06em] text-[color:var(--color-ink-subtle)] truncate">
                      {materialName(t.material_id)}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Result picker ────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        <div className="px-3 py-2 flex items-center justify-between">
          <RailLabel text="Results" />
          {results && results.length > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
              {selectedResultIds.length}/{results.length}
            </span>
          )}
        </div>
        <div
          className="max-h-[260px] overflow-y-scroll border-t border-[color:var(--color-border)]/60"
          style={{ scrollbarGutter: "stable" }}
        >
          {selectedTestId == null ? (
            <div className="px-3 py-6 text-center font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
              Pick a base test ↑
            </div>
          ) : resultsLoading ? (
            <div className="px-3 py-6 text-center font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
              Loading results…
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-[12px] text-[color:var(--color-destructive)]">
              {error}
            </div>
          ) : !results || results.length === 0 ? (
            <div className="px-3 py-6 text-center font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
              No uploaded results yet.
            </div>
          ) : (
            <ul className="flex flex-col">
              {/* Group results by retest_index so the user can see
                  "different photos of the same burn" vs "different
                  burns" at a glance. Each retest = a fresh burn of
                  the test; multiple results within a retest = the
                  same burn photographed multiple times. The
                  BURN-vs-CAMERA stat math depends on which case
                  is which. */}
              {groupResultsByRetest(results).map((group) => (
                <li key={`group-${group.retestIndex}`}>
                  {showRetestHeader(results) && (
                    <div className="px-3 py-1 border-b border-[color:var(--color-border)]/60 bg-[color:var(--color-surface-elevated)]/60 font-mono text-[9px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
                      burn #{group.retestIndex + 1} · {group.results.length} photo{group.results.length === 1 ? "" : "s"}
                    </div>
                  )}
                  <ul className="flex flex-col">
                    {group.results.map((r) => (
                      <ResultRow
                        key={r.id}
                        result={r}
                        index={group.indexFor(r.id)}
                        selected={selectedResultIds.includes(r.id)}
                        onToggle={() => onToggleResult(r.id)}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* Done · Collapse — primary action that lets the user
            commit a selection and reclaim the rail's pixels for the
            chart + stats strip. The rail can also be collapsed via
            the chevron in the header at any time; this just makes
            the "I'm done picking" path obvious. Disabled until
            there's at least one result selected, so the user
            doesn't accidentally collapse before configuring. */}
        <div className="px-3 pb-3 pt-2 border-t border-[color:var(--color-border)]/60">
          <button
            type="button"
            onClick={onToggleCollapsed}
            disabled={selectedResultIds.length === 0}
            className={cn(
              "w-full h-8 rounded-[6px]",
              "font-mono text-[10.5px] tracking-[0.18em] uppercase font-semibold",
              "border transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
              selectedResultIds.length === 0
                ? "border-[color:var(--color-border)] bg-[color:var(--color-surface)]/60 text-[color:var(--color-ink-subtle)] cursor-not-allowed"
                : "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary)]/90",
            )}
          >
            Done · Collapse
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ─── Collapsed rail ────────────────────────────────────────────────────
 *
 * Thin (32 px) sidebar that surfaces just enough state for the user
 * to know what they picked, plus a fat hit area to expand back. The
 * vertical strip of test id + result count lives along the
 * collapse-friendly axis (top → bottom) so it reads at a glance.
 */
function CollapsedRail({
  selectedTest,
  selectedResultCount,
  totalResultCount,
  onExpand,
}: {
  selectedTest: TestRecord | null;
  selectedResultCount: number;
  totalResultCount: number;
  onExpand: () => void;
}) {
  return (
    <aside
      className={cn(
        "shrink-0 w-[32px] flex flex-col min-h-0",
        "border-r border-[color:var(--color-border)]",
        "bg-[color:var(--color-surface)]",
      )}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand picker"
        title="Expand picker (base test + results)"
        className={cn(
          "flex-1 min-h-0 w-full flex flex-col items-center gap-3 py-3",
          "text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)] focus-visible:ring-inset",
          "transition-colors",
        )}
      >
        {/* Expand glyph */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden
          className="block shrink-0"
        >
          <path
            d="M5 3 L9 7 L5 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {/* Vertical text — uses writing-mode so the labels don't
            wrap into stacked single characters. ``upright`` keeps
            digits oriented the right way. */}
        {selectedTest && (
          <span
            className="font-mono text-[10px] tabular-nums tracking-[0.12em] text-[color:var(--color-primary)] font-semibold"
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            #{selectedTest.id}
          </span>
        )}
        {totalResultCount > 0 && (
          <span
            className="font-mono text-[9.5px] tabular-nums tracking-[0.1em] text-[color:var(--color-ink-subtle)]"
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            {selectedResultCount}/{totalResultCount}
          </span>
        )}
      </button>
    </aside>
  );
}

/* ─── Chevron-style collapse button ────────────────────────────────── */

function CollapseButton({
  onClick,
  label,
  direction,
}: {
  onClick: () => void;
  label: string;
  direction: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "h-5 w-5 inline-flex items-center justify-center rounded-[3px]",
        "text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)]",
        "hover:bg-[color:var(--color-surface-elevated)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60",
        "transition-colors",
      )}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden
        className="block"
      >
        <path
          d={direction === "left" ? "M8 2 L4 6 L8 10" : "M4 2 L8 6 L4 10"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function RailLabel({ text }: { text: string }) {
  return (
    <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
      {text}
    </span>
  );
}

function ResultRow({
  result,
  index,
  selected,
  onToggle,
}: {
  result: ResultRecord;
  index: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const stamp = formatStamp(result.uploaded_at);
  return (
    <li>
      <label
        className={cn(
          "flex items-center gap-2 px-3 py-1.5",
          "border-b border-[color:var(--color-border)]/60",
          "cursor-pointer transition-colors",
          selected
            ? "bg-[color:var(--color-primary-tint)]/40"
            : "hover:bg-[color:var(--color-surface-elevated)]",
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="accent-[color:var(--color-primary)]"
          aria-label={`Toggle result #${result.id} (${stamp})`}
        />
        <ResultThumb result={result} />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink)] truncate">
            #{index} · {stamp}
          </div>
          <div className="font-mono text-[9px] tracking-[0.06em] text-[color:var(--color-ink-subtle)] truncate">
            id {result.id} · {result.swatches.length} sw
          </div>
        </div>
      </label>
    </li>
  );
}

function ResultThumb({ result }: { result: ResultRecord }) {
  const [errored, setErrored] = useState(false);
  return (
    <div
      aria-hidden
      className={cn(
        "h-8 w-8 rounded-[3px] border border-[color:var(--color-border-strong)] overflow-hidden shrink-0",
        "bg-[color:var(--color-surface-elevated)]",
      )}
    >
      {!errored && (
        <img
          src={`/api/results/${result.id}/warped-image`}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setErrored(true)}
        />
      )}
    </div>
  );
}

interface RetestGroup {
  retestIndex: number;
  results: ResultRecord[];
  indexFor: (id: number) => number;
}

/** Group results by ``retest_index``, descending. Each group's
 *  ``results`` are sorted newest-first within the burn, and
 *  ``indexFor(id)`` returns the within-group "photo #N" label so
 *  rows aren't tagged with mismatched indices when a single picker
 *  contains multiple burns.
 *
 *  Treats missing retest_index as 0 (legacy results from the very
 *  first burn before the column existed).
 */
function groupResultsByRetest(results: ResultRecord[]): RetestGroup[] {
  const buckets = new Map<number, ResultRecord[]>();
  for (const r of results) {
    const k = r.retest_index ?? 0;
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(r);
  }
  // Newest burn (highest retest_index) on top.
  const keys = [...buckets.keys()].sort((a, b) => b - a);
  return keys.map((k) => {
    const arr = buckets.get(k)!;
    // Within a burn: newest photo on top.
    arr.sort(
      (a, b) =>
        new Date(b.uploaded_at).getTime() -
        new Date(a.uploaded_at).getTime(),
    );
    const idMap = new Map<number, number>();
    arr.forEach((r, i) => idMap.set(r.id, arr.length - i));
    return {
      retestIndex: k,
      results: arr,
      indexFor: (id) => idMap.get(id) ?? 0,
    };
  });
}

/** Show the retest header rows only when results actually span more
 *  than one burn — single-burn tests are the common case and the
 *  ``BURN #1`` chrome would just be noise. */
function showRetestHeader(results: ResultRecord[]): boolean {
  const set = new Set<number>();
  for (const r of results) set.add(r.retest_index ?? 0);
  return set.size >= 2;
}

function formatStamp(iso: string): string {
  // "30 Apr · 14:20" — short, mono-friendly. Falls back to the raw
  // string if Date parsing fails (which it rarely does for ISO 8601).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${time}`;
}
