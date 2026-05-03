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
        <RailLabel text="Base test" />
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
      <div className="flex-1 min-h-0 overflow-auto">
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
        <div className="max-h-[260px] overflow-auto border-t border-[color:var(--color-border)]/60">
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
              {results.map((r, i) => (
                <ResultRow
                  key={r.id}
                  result={r}
                  index={results.length - i}
                  selected={selectedResultIds.includes(r.id)}
                  onToggle={() => onToggleResult(r.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
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

function formatStamp(iso: string): string {
  // "30 Apr · 14:20" — short, mono-friendly. Falls back to the raw
  // string if Date parsing fails (which it rarely does for ISO 8601).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${time}`;
}
