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
  const setSources = (next: ReadonlySet<SourceKind>) =>
    onChange({ ...f, sources: next });
  const setRange = (k: FilterableParam, r: { min: number | null; max: number | null } | undefined) =>
    onChange({ ...f, paramRanges: { ...f.paramRanges, [k]: r } });

  return (
    <div className="flex flex-col gap-4">
      <Section title="Source / validated">
        <div className="flex flex-col gap-1">
          {SOURCE_OPTIONS.map((s) => (
            <label key={s} className="flex items-center gap-2 font-mono text-[10.5px]">
              <input
                type="checkbox"
                checked={f.sources.has(s)}
                onChange={(e) => {
                  const next = new Set(f.sources);
                  if (e.target.checked) next.add(s); else next.delete(s);
                  setSources(next);
                }}
              />
              {s}
            </label>
          ))}
          <label className="flex items-center gap-2 font-mono text-[10.5px]">
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
      </Section>

      <Section title="Test">
        <select
          className="font-mono text-[10.5px] px-1 py-1 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
          value={f.testId ?? ""}
          onChange={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            onChange({ ...f, testId: v, testLineage: new Set() });
          }}
        >
          <option value="">— all —</option>
          {tests.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.id} · {t.name} · {t.kind}
            </option>
          ))}
        </select>
        {f.testId != null && (
          <div className="flex flex-col gap-1 pl-2">
            {(["source", "parent"] as const).map((tag) => (
              <label key={tag} className="flex items-center gap-2 font-mono text-[10.5px]">
                <input
                  type="checkbox"
                  checked={f.testLineage.has(tag)}
                  onChange={(e) => {
                    const next = new Set(f.testLineage);
                    if (e.target.checked) next.add(tag); else next.delete(tag);
                    onChange({ ...f, testLineage: next });
                  }}
                />
                + {tag} test
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
        <div className="flex flex-col gap-3">
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

      <Section title="Recipe family">
        {f.family ? (
          <div className="flex items-center gap-2 font-mono text-[10.5px]">
            <span>{f.family.axis} sweep</span>
            <button
              type="button"
              onClick={() => onChange({ ...f, family: null })}
              className="ml-auto text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)]"
            >
              clear
            </button>
          </div>
        ) : (
          <p className="font-mono text-[9.5px] italic text-[color:var(--color-ink-subtle)]">
            Set from the focused card.
          </p>
        )}
      </Section>

      <Section title="Outliers / brush">
        <label className="flex items-center gap-2 font-mono text-[10.5px]">
          <input
            type="checkbox"
            checked={f.trimOutliers}
            onChange={(e) =>
              onChange({ ...f, trimOutliers: e.target.checked })}
          />
          trim 1%/99%
        </label>
        {f.brushRange ? (
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span>brush: {f.brushRange[0]}–{f.brushRange[1]}</span>
            <button
              type="button"
              onClick={() => onChange({ ...f, brushRange: null })}
              className="ml-auto text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)]"
            >
              clear
            </button>
          </div>
        ) : null}
      </Section>

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
