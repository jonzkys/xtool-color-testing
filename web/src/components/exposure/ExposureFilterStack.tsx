/*
 * ExposureFilterStack — the wired Filter Stack rail.
 *
 * Renders the left rail of the redesigned Exposure page. Each
 * filterable parameter shows its active clauses, an MRU strip
 * (recent values), and an inline add-value editor. Burn settings
 * are tri-state pills; tests are a multi-select list with lineage
 * extensions.
 *
 * Persistent MRU is keyed by (machine, material, param) — see
 * exposureParamMru.ts. Every successful clause-add bumps the MRU.
 *
 * Data model: ActiveFilters.paramClauses (see exposureFilters.ts).
 * Adding/removing clauses goes through the helpers in that module
 * so the OR/AND semantics stay consistent.
 */

import * as React from "react";

import {
  DEFAULT_FILTERS, FILTERABLE_PARAMS,
  addClause, removeClauseAt,
  type ActiveFilters, type AngleModeFilter, type ClauseKind,
  type FilterableParam, type ParamClause, type SourceKind, type TestSummary,
  type TriStateFlag, formatClause,
} from "./exposureFilters";
import { bumpMru, getMru } from "./exposureParamMru";

interface Props {
  filters: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  tests: readonly TestSummary[];
  /** For MRU scoping. Material may be null when nothing is picked yet. */
  machineId: string;
  materialId: number | null;
  /** Visible entries / total dataset — surfaced as a status row. */
  entryCount: number;
  totalCount: number;
}

const PARAM_LABEL: Record<FilterableParam, string> = {
  power: "POWER",
  speed: "SPEED (mm/s)",
  frequency: "FREQUENCY (kHz)",
  pulse_width: "PULSE WIDTH (ns)",
  density: "DENSITY (lines/cm)",
  passes: "PASSES",
  scan_angle: "SCAN ANGLE (°)",
};

/* ───────────────────────────────────────────────────────────────────
 * Section shells
 * ─────────────────────────────────────────────────────────────────── */

function SectionShell({
  title, count, defaultOpen = true, children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="flex flex-col gap-1.5">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.22em] font-semibold text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink-muted)] text-left"
          aria-expanded={open}
        >
          <span aria-hidden className="text-[8px] leading-none w-2">{open ? "▾" : "▸"}</span>
          <span className="flex-1 truncate">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="px-1 py-[1px] rounded-sm text-[8.5px] tabular-nums border border-[color:var(--color-primary)] text-[color:var(--color-primary)] tracking-normal">
              {count}
            </span>
          )}
        </button>
      </header>
      <div className="h-[1px] bg-[color:var(--color-border)]" />
      {open && <div className="flex flex-col gap-2 pt-1">{children}</div>}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Clause chip
 * ─────────────────────────────────────────────────────────────────── */

function ClauseChip({
  clause, onRemove,
}: {
  clause: ParamClause;
  onRemove: () => void;
}) {
  const isExclude = clause.kind === "neq";
  return (
    <span
      role="group"
      className={
        "inline-flex items-stretch h-[22px] rounded-sm border font-mono text-[10.5px] tabular-nums overflow-hidden " +
        (isExclude
          ? "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)]"
          : "border-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)]")
      }
    >
      <span
        className={
          "flex items-center gap-1.5 px-1.5 " +
          (isExclude ? "line-through decoration-1" : "")
        }
      >
        {formatClause(clause)}
      </span>
      <span aria-hidden className={
        "w-[1px] " + (isExclude
          ? "bg-[color:var(--color-border)]"
          : "bg-[color:var(--color-primary)]/40")
      } />
      <button
        type="button"
        aria-label="Remove clause"
        onClick={onRemove}
        className="px-1.5 hover:bg-[color:var(--color-surface-elevated)]/60 text-[12px] leading-none"
      >
        ×
      </button>
    </span>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * MRU strip
 * ─────────────────────────────────────────────────────────────────── */

function MruStrip({
  values, onPick, formatter,
}: {
  values: readonly number[];
  onPick: (v: number) => void;
  /** Optional formatter for display only; storage stays numeric. */
  formatter?: (v: number) => string;
}) {
  if (values.length === 0) return null;
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span
        aria-hidden
        className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] flex-none"
      >
        recent
      </span>
      <span aria-hidden className="text-[color:var(--color-border)]">·</span>
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            title={`Add = ${v} filter`}
            onClick={() => onPick(v)}
            className="px-1 h-[18px] inline-flex items-center font-mono text-[10px] tabular-nums rounded-sm border border-transparent hover:border-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-tint)] hover:text-[color:var(--color-primary)] text-[color:var(--color-ink-muted)]"
          >
            {formatter ? formatter(v) : v}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Inline add-value editor
 * ─────────────────────────────────────────────────────────────────── */

function AddValueRow({
  paramKey, onAdd,
}: {
  paramKey: FilterableParam;
  onAdd: (clause: ParamClause) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [op, setOp] = React.useState<ClauseKind>("eq");
  const [a, setA] = React.useState("");
  const [b, setB] = React.useState("");

  const reset = () => { setOp("eq"); setA(""); setB(""); };
  const close = () => { setOpen(false); reset(); };

  const submit = () => {
    const av = Number(a);
    if (!Number.isFinite(av)) return;
    if (op === "range") {
      const bv = Number(b);
      if (!Number.isFinite(bv)) return;
      const lo = Math.min(av, bv);
      const hi = Math.max(av, bv);
      onAdd({ kind: "range", value: lo, valueHi: hi });
    } else {
      onAdd({ kind: op, value: av });
    }
    close();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 h-[22px] px-1 -mx-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)] self-start"
      >
        <span aria-hidden className="text-[12px] leading-none">+</span>
        <span>add value</span>
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-1 mt-0.5 p-1 rounded-sm border border-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
        if (e.key === "Enter") submit();
      }}
    >
      <select
        aria-label="operator"
        value={op}
        onChange={(e) => setOp(e.target.value as ClauseKind)}
        className="font-mono text-[10.5px] px-1 h-[22px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
      >
        <option value="eq">=</option>
        <option value="neq">≠</option>
        <option value="lt">&lt;</option>
        <option value="lte">≤</option>
        <option value="gt">&gt;</option>
        <option value="gte">≥</option>
        <option value="range">range</option>
      </select>
      <input
        type="number"
        placeholder={op === "range" ? "lo" : "value"}
        aria-label={`${paramKey} value`}
        value={a}
        onChange={(e) => setA(e.target.value)}
        className="flex-1 min-w-0 font-mono text-[10.5px] tabular-nums px-1.5 h-[22px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
        autoFocus
      />
      {op === "range" && (
        <input
          type="number"
          placeholder="hi"
          aria-label={`${paramKey} value hi`}
          value={b}
          onChange={(e) => setB(e.target.value)}
          className="flex-1 min-w-0 font-mono text-[10.5px] tabular-nums px-1.5 h-[22px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
        />
      )}
      <button
        type="button"
        onClick={submit}
        title="Add (Enter)"
        className="px-2 h-[22px] font-mono text-[10px] uppercase tracking-[0.14em] rounded-sm border border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary-hover)]"
      >
        add
      </button>
      <button
        type="button"
        onClick={close}
        title="Cancel (Esc)"
        aria-label="Cancel"
        className="px-1.5 h-[22px] font-mono text-[12px] rounded-sm border border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
      >
        ×
      </button>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Per-param section
 * ─────────────────────────────────────────────────────────────────── */

function ParamSection({
  param, filters, onChange, machineId, materialId,
}: {
  param: FilterableParam;
  filters: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  machineId: string;
  materialId: number | null;
}) {
  const clauses = filters.paramClauses[param] ?? [];
  const active = clauses.length;
  const [open, setOpen] = React.useState(active > 0);
  // Re-open when clauses appear from outside (e.g. Recipe apply-button)
  React.useEffect(() => {
    if (active > 0) setOpen(true);
  }, [active]);

  const mru = React.useMemo(
    () => getMru(machineId, materialId, param),
    [machineId, materialId, param],
  );

  const addClauseAndBump = (c: ParamClause) => {
    onChange(addClause(filters, param, c));
    bumpMru(machineId, materialId, param, c.value);
  };

  return (
    <section className="flex flex-col gap-1">
      <header className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex-1 flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.18em] font-semibold text-[color:var(--color-ink)] hover:text-[color:var(--color-primary)] text-left"
        >
          <span aria-hidden className="text-[8px] leading-none w-2 self-center text-[color:var(--color-ink-subtle)]">
            {open ? "▾" : "▸"}
          </span>
          <span className="flex-1 truncate">{PARAM_LABEL[param]}</span>
          {active > 0 && (
            <span className="px-1 py-[1px] rounded-sm font-mono text-[8.5px] tabular-nums tracking-normal border border-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)]">
              {active}
            </span>
          )}
        </button>
      </header>
      {open && (
        <div className="flex flex-col gap-1 pl-3.5 border-l border-[color:var(--color-border)]">
          {clauses.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {clauses.map((c, i) => (
                <ClauseChip
                  key={`${c.kind}-${c.value}-${c.valueHi ?? ""}-${i}`}
                  clause={c}
                  onRemove={() => onChange(removeClauseAt(filters, param, i))}
                />
              ))}
            </div>
          )}
          <MruStrip values={mru} onPick={(v) => addClauseAndBump({ kind: "eq", value: v })} />
          <AddValueRow paramKey={param} onAdd={addClauseAndBump} />
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Tri-state row (burn settings)
 * ─────────────────────────────────────────────────────────────────── */

function TriStateRow<T extends string>({
  label, value, options, optionLabels, onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  /** Optional short display label per option value. Falls back to the
   *  value itself. Lets "incremental" render as "INCR" without
   *  changing the underlying state shape. */
  optionLabels?: Partial<Record<T, string>>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-muted)] flex-none w-[78px]">
        {label}
      </span>
      <div className="flex flex-1 gap-1 min-w-0">
        {options.map((v) => {
          const active = v === value;
          const text = optionLabels?.[v] ?? v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(v)}
              title={v}
              className={
                "flex-1 min-w-0 h-[22px] px-1 font-mono text-[9.5px] uppercase tracking-[0.12em] rounded-sm border truncate " +
                (active
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]")
              }
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Tests multi-select
 * ─────────────────────────────────────────────────────────────────── */

function TestsList({
  filters, onChange, tests,
}: {
  filters: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  tests: readonly TestSummary[];
}) {
  const [search, setSearch] = React.useState("");

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tests;
    return tests.filter((t) =>
      t.name.toLowerCase().includes(q) || String(t.id).includes(q),
    );
  }, [tests, search]);

  const toggle = (id: number) => {
    const next = new Set(filters.testIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ ...filters, testIds: next });
  };

  return (
    <>
      <input
        type="search"
        placeholder="search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="font-mono text-[10.5px] px-2 h-[24px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus:outline-none focus:border-[color:var(--color-primary)]"
      />
      <div
        className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto pr-1"
        role="listbox"
        aria-multiselectable="true"
      >
        {visible.length === 0 && (
          <span className="font-mono text-[9.5px] italic text-[color:var(--color-ink-subtle)] px-1">
            no match
          </span>
        )}
        {visible.map((t) => {
          const checked = filters.testIds.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={checked}
              onClick={() => toggle(t.id)}
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
              <span className="tabular-nums text-[color:var(--color-ink-subtle)] flex-none">#{t.id}</span>
              <span className="flex-1 truncate" title={t.name}>{t.name}</span>
              <span className="text-[9px] uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)]">
                {t.kind === "validation" ? "val" : "swp"}
              </span>
            </button>
          );
        })}
      </div>
      {filters.testIds.size > 0 && (
        <div className="flex gap-2 pl-1">
          {(["source", "parent"] as const).map((tag) => (
            <label key={tag} className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={filters.testLineage.has(tag)}
                onChange={(e) => {
                  const next = new Set(filters.testLineage);
                  if (e.target.checked) next.add(tag); else next.delete(tag);
                  onChange({ ...filters, testLineage: next });
                }}
              />
              +{tag}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-1 min-w-0 pt-1">
        {(["all", "sweep", "validation"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange({ ...filters, testKind: k })}
            className={
              "flex-1 min-w-0 px-1 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] rounded-sm border truncate " +
              (filters.testKind === k
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
            title={k}
          >
            {k}
          </button>
        ))}
      </div>
    </>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Top-level
 * ─────────────────────────────────────────────────────────────────── */

const SOURCE_OPTIONS: SourceKind[] = ["averaged", "single_result", "manual"];

function countTotalClauses(f: ActiveFilters): number {
  let n = 0;
  for (const k of FILTERABLE_PARAMS) {
    n += (f.paramClauses[k]?.length ?? 0);
  }
  return n;
}

function countBurnSettings(f: ActiveFilters): number {
  let n = 0;
  if (f.crosshatch !== "any") n++;
  if (f.unidirectional !== "any") n++;
  if (f.angleMode !== "any") n++;
  return n;
}

function countSourceAdjustments(f: ActiveFilters): number {
  let n = 0;
  if (f.sources.size !== DEFAULT_FILTERS.sources.size) n++;
  if (f.validatedOnly) n++;
  return n;
}

export function ExposureFilterStack({
  filters: f, onChange, tests, machineId, materialId, entryCount, totalCount,
}: Props) {
  const handleClearAll = () => onChange({
    ...DEFAULT_FILTERS,
    sources: new Set(DEFAULT_FILTERS.sources),
    testIds: new Set(),
    testLineage: new Set(),
    paramClauses: {},
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="text-[color:var(--color-ink)]">
          <span className="text-[color:var(--color-primary)] font-semibold tabular-nums tracking-normal text-[12px]">
            {entryCount}
          </span>
          <span className="text-[color:var(--color-ink-subtle)]"> / {totalCount} in</span>
        </span>
        <button
          type="button"
          onClick={handleClearAll}
          className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)]"
        >
          Clear all
        </button>
      </div>

      <SectionShell title="Filters" count={countTotalClauses(f)}>
        {FILTERABLE_PARAMS.map((k) => (
          <ParamSection
            key={k}
            param={k}
            filters={f}
            onChange={onChange}
            machineId={machineId}
            materialId={materialId}
          />
        ))}
      </SectionShell>

      <SectionShell title="Burn settings" count={countBurnSettings(f)}>
        <div className="flex flex-col gap-1.5">
          <TriStateRow<TriStateFlag>
            label="Crosshatch"
            value={f.crosshatch}
            options={["any", "yes", "no"]}
            onChange={(v) => onChange({ ...f, crosshatch: v })}
          />
          <TriStateRow<TriStateFlag>
            label="Uni-dir"
            value={f.unidirectional}
            options={["any", "yes", "no"]}
            onChange={(v) => onChange({ ...f, unidirectional: v })}
          />
          <TriStateRow<AngleModeFilter>
            label="Angle mode"
            value={f.angleMode}
            options={["any", "fixed", "incremental"]}
            optionLabels={{ incremental: "incr" }}
            onChange={(v) => onChange({ ...f, angleMode: v })}
          />
        </div>
      </SectionShell>

      <SectionShell title="Tests" count={f.testIds.size} defaultOpen={f.testIds.size > 0}>
        <TestsList filters={f} onChange={onChange} tests={tests} />
      </SectionShell>

      <SectionShell title="Source" count={countSourceAdjustments(f)} defaultOpen={false}>
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
          <label className="flex items-center gap-2 font-mono text-[10px] mt-1">
            <input
              type="checkbox"
              checked={f.validatedOnly}
              onChange={(e) => onChange({ ...f, validatedOnly: e.target.checked })}
            />
            validated only
          </label>
        </div>
      </SectionShell>

      {f.family && (
        <SectionShell title="Recipe family">
          <div className="flex items-center gap-2 font-mono text-[10px] pl-1">
            <span>{f.family.axis} sweep</span>
            <button
              type="button"
              onClick={() => onChange({ ...f, family: null })}
              className="ml-auto text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)]"
            >
              clear
            </button>
          </div>
        </SectionShell>
      )}
    </div>
  );
}
