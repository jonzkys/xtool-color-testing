import * as React from "react";
import {
  DEFAULT_FILTERS, FILTERABLE_PARAMS,
  type ActiveFilters, type AngleModeFilter, type FilterableParam,
  type SourceKind, type TestSummary, type TriStateFlag,
} from "./exposureFilters";
import { ExposureRangeSlider } from "./ExposureRangeSlider";

interface Props {
  filters: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  tests: readonly TestSummary[];
  dataRanges: Record<FilterableParam, { min: number; max: number } | null>;
}

const SOURCE_OPTIONS: SourceKind[] = ["averaged", "single_result", "manual"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold">
        {title}
      </h3>
      <div className="h-[1px] bg-[color:var(--color-border)]" />
      {children}
    </section>
  );
}

export function ExposureFilterPanel({
  filters: f, onChange, tests, dataRanges,
}: Props) {
  const setRange = (k: FilterableParam, r: { min: number | null; max: number | null } | undefined) =>
    onChange({ ...f, paramRanges: { ...f.paramRanges, [k]: r } });

  const [testSearch, setTestSearch] = React.useState("");
  const [moreOpen, setMoreOpen] = React.useState(false);

  const visibleTests = React.useMemo(() => {
    const q = testSearch.trim().toLowerCase();
    if (!q) return tests;
    return tests.filter((t) =>
      t.name.toLowerCase().includes(q) || String(t.id).includes(q),
    );
  }, [tests, testSearch]);

  const toggleTest = (id: number) => {
    const next = new Set(f.testIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ ...f, testIds: next });
  };

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={
          f.testIds.size > 0
            ? `Tests · ${f.testIds.size}/${tests.length} in`
            : `Tests · all (${tests.length})`
        }
      >
        <input
          type="search"
          placeholder="search…"
          value={testSearch}
          onChange={(e) => setTestSearch(e.target.value)}
          className="font-mono text-[10.5px] px-2 py-1 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus:outline-none focus:border-[color:var(--color-primary)]"
        />
        <div
          className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto pr-1"
          role="listbox"
          aria-multiselectable="true"
        >
          {visibleTests.length === 0 && (
            <span className="font-mono text-[9.5px] italic text-[color:var(--color-ink-subtle)] px-1">
              no match
            </span>
          )}
          {visibleTests.map((t) => {
            const checked = f.testIds.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggleTest(t.id)}
                className={
                  "flex items-center gap-2 px-1 py-1 rounded-sm text-left font-mono text-[10.5px] transition-colors " +
                  (checked
                    ? "bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)]"
                    : "text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]")
                }
              >
                <span
                  aria-hidden
                  className={
                    "inline-block w-3 h-3 flex-none rounded-sm border " +
                    (checked
                      ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]"
                      : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]")
                  }
                >
                  {checked && (
                    <svg viewBox="0 0 10 10" className="w-3 h-3">
                      <path d="M2 5.5l2 2 4-4.5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="tabular-nums text-[color:var(--color-ink-subtle)] flex-none">
                  #{t.id}
                </span>
                <span className="flex-1 truncate" title={t.name}>{t.name}</span>
                <span className="text-[9px] uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)] flex-none">
                  {t.kind === "validation" ? "val" : "swp"}
                </span>
              </button>
            );
          })}
        </div>
        {f.testIds.size > 0 && (
          <div className="flex gap-1 flex-wrap pl-1">
            {(["source", "parent"] as const).map((tag) => (
              <label key={tag} className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--color-ink-muted)]">
                <input
                  type="checkbox"
                  checked={f.testLineage.has(tag)}
                  onChange={(e) => {
                    const next = new Set(f.testLineage);
                    if (e.target.checked) next.add(tag); else next.delete(tag);
                    onChange({ ...f, testLineage: next });
                  }}
                />
                +{tag}
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-1 min-w-0">
          {([
            { k: "all" as const, short: "All" },
            { k: "sweep" as const, short: "Sweep" },
            { k: "validation" as const, short: "Valid." },
          ]).map(({ k, short }) => (
            <button
              key={k}
              type="button"
              onClick={() => onChange({ ...f, testKind: k })}
              className={
                "flex-1 min-w-0 px-1 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] rounded-sm border truncate " +
                (f.testKind === k
                  ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
              }
              title={k}
            >
              {short}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Ranges">
        {/* Two-column grid halves the vertical footprint vs. the prior
            stack. Each slider auto-fits the cell width. */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-2">
          {FILTERABLE_PARAMS.map((k) => {
            const dr = dataRanges[k];
            if (!dr) return null;
            return (
              <ExposureRangeSlider
                key={k}
                param={k}
                domain={dr}
                value={f.paramRanges[k] ?? { min: null, max: null }}
                onChange={(r) => setRange(k,
                  (r.min == null && r.max == null) ? undefined : r)}
              />
            );
          })}
        </div>
      </Section>

      <Section title="Burn settings">
        <div className="flex flex-col gap-2">
          <TriStateRow
            label="Hatch"
            fullLabel="Crosshatch"
            value={f.crosshatch}
            onChange={(v) => onChange({ ...f, crosshatch: v })}
          />
          <TriStateRow
            label="Uni-dir"
            fullLabel="Unidirectional"
            value={f.unidirectional}
            onChange={(v) => onChange({ ...f, unidirectional: v })}
          />
          <AngleModeRow
            value={f.angleMode}
            onChange={(v) => onChange({ ...f, angleMode: v })}
          />
        </div>
      </Section>

      {/* "More" disclosure — niche filters most users don't touch. */}
      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="flex items-center justify-between gap-2 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold hover:text-[color:var(--color-ink-muted)]"
        >
          <span>More</span>
          <span aria-hidden>{moreOpen ? "▴" : "▾"}</span>
        </button>
        <div className="h-[1px] bg-[color:var(--color-border)]" />
        {moreOpen && (
          <div className="flex flex-col gap-3">
            <div>
              <h4 className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-1">Source</h4>
              <div className="flex flex-col gap-0.5 pl-1">
                {SOURCE_OPTIONS.map((s) => (
                  <label key={s} className="flex items-center gap-2 font-mono text-[10px]">
                    <input
                      type="checkbox"
                      checked={f.sources.has(s)}
                      onChange={(e) => {
                        const next = new Set(f.sources);
                        if (e.target.checked) next.add(s); else next.delete(s);
                        onChange({ ...f, sources: next });
                      }}
                    />
                    {s}
                  </label>
                ))}
                <label className="flex items-center gap-2 font-mono text-[10px]">
                  <input
                    type="checkbox"
                    checked={f.validatedOnly}
                    onChange={(e) =>
                      onChange({ ...f, validatedOnly: e.target.checked })}
                    aria-label="validated only"
                  />
                  validated only
                </label>
              </div>
            </div>
            <div>
              <h4 className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-1">Outliers</h4>
              <label className="flex items-center gap-2 font-mono text-[10px]">
                <input
                  type="checkbox"
                  checked={f.trimOutliers}
                  onChange={(e) =>
                    onChange({ ...f, trimOutliers: e.target.checked })}
                />
                trim 1%/99%
              </label>
              {f.brushRange && (
                <div className="flex items-center gap-2 font-mono text-[10px] mt-1">
                  <span>brush: {f.brushRange[0]}–{f.brushRange[1]}</span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...f, brushRange: null })}
                    className="ml-auto text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)]"
                  >
                    clear
                  </button>
                </div>
              )}
            </div>
            {f.family && (
              <div>
                <h4 className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-1">Recipe family</h4>
                <div className="flex items-center gap-2 font-mono text-[10px]">
                  <span>{f.family.axis} sweep</span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...f, family: null })}
                    className="ml-auto text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)]"
                  >
                    clear
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={() => onChange(DEFAULT_FILTERS)}
        className="font-mono text-[10px] uppercase tracking-[0.18em] py-1.5 rounded-sm border border-[color:var(--color-border)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
      >
        Clear all filters
      </button>
    </div>
  );
}

function SegmentedButton<T extends string>({
  label, value, active, onClick,
}: { label: string; value: T; active: boolean; onClick: (v: T) => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onClick(value)}
      className={
        "flex-1 min-w-0 px-1 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] rounded-sm border " +
        (active
          ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
          : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)]")
      }
    >
      {label}
    </button>
  );
}

function TriStateRow({
  label, value, onChange, fullLabel,
}: {
  label: string;
  /** Full label used for hover tooltip when the visible label is abbreviated. */
  fullLabel?: string;
  value: TriStateFlag;
  onChange: (v: TriStateFlag) => void;
}) {
  return (
    <div className="flex items-center gap-2" data-row={(fullLabel ?? label).toLowerCase()}>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[68px] flex-none truncate" title={fullLabel ?? label}>
        {label}
      </span>
      <div className="flex gap-1 flex-1 min-w-0">
        <SegmentedButton label="Any" value="any" active={value === "any"} onClick={onChange} />
        <SegmentedButton label="Yes" value="yes" active={value === "yes"} onClick={onChange} />
        <SegmentedButton label="No" value="no" active={value === "no"} onClick={onChange} />
      </div>
    </div>
  );
}

function AngleModeRow({
  value, onChange,
}: {
  value: AngleModeFilter;
  onChange: (v: AngleModeFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2" data-row="angle_mode">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[68px] flex-none truncate" title="Angle mode">
        Angle
      </span>
      <div className="flex gap-1 flex-1 min-w-0">
        <SegmentedButton label="Any" value="any" active={value === "any"} onClick={onChange} />
        <SegmentedButton label="Fixed" value="fixed" active={value === "fixed"} onClick={onChange} />
        <SegmentedButton label="Incr." value="incremental" active={value === "incremental"} onClick={onChange} />
      </div>
    </div>
  );
}
