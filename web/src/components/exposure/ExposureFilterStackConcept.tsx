/*
 * ExposureFilterStackConcept — preview-only mockup of the redesigned
 * right rail for the Exposure page.
 *
 * Design intent
 * -------------
 * The Exposure page is a filter-driven exploration tool. The current
 * rail buries filters behind one of four tabs and limits each param
 * to a single (min, max) range. This concept makes Filters the
 * primary content of the rail and supports a *clause list* per
 * parameter — multiple equalities, inequalities, ranges, OR'd within
 * a param and AND'd across params.
 *
 * Sections below the Filter Stack (Focus / Indices / Stats / Overlays
 * / Neighbours / Correlations) collapse into a single scroll surface,
 * so the user never has to tab to find a number. Each section header
 * doubles as a disclosure control. Per-param MRU values (recent 5,
 * scoped to machine + material) anchor the bottom of each filter
 * section as one-click chips.
 *
 * Everything in this file is a static mockup. No props, no business
 * logic, no localStorage. State is only used for the few interactive
 * toggles needed to make the design feel alive in the styleguide.
 */

import * as React from "react";
import { ListFilterPlus } from "lucide-react";

/* ───────────────────────────────────────────────────────────────────
 * Primitives
 * ─────────────────────────────────────────────────────────────────── */

function SectionShell({
  title, count, defaultOpen = true, headerAction, children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  headerAction?: React.ReactNode;
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
        {headerAction && <div className="flex-none">{headerAction}</div>}
      </header>
      <div className="h-[1px] bg-[color:var(--color-border)]" />
      {open && <div className="flex flex-col gap-2 pt-1">{children}</div>}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Filter Stack — clauses, MRU strip, inline add editor
 * ─────────────────────────────────────────────────────────────────── */

type Op = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "range";
const OP_GLYPH: Record<Op, string> = {
  eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥", range: "–",
};

interface Clause {
  op: Op;
  value: number;
  /** Only set when op="range". */
  valueHi?: number;
  /** Display as exclude-style chip (currently we treat neq as that). */
  invert?: boolean;
}

function ClauseChip({ clause }: { clause: Clause }) {
  const isExclude = clause.op === "neq" || clause.invert;
  return (
    <span
      role="group"
      className={
        "inline-flex items-stretch h-[22px] rounded-sm border font-mono text-[10.5px] tabular-nums overflow-hidden transition-colors " +
        (isExclude
          ? "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)]"
          : "border-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)]")
      }
    >
      <button
        type="button"
        title="Edit clause"
        className="flex items-center gap-1.5 px-1.5 hover:bg-[color:var(--color-surface-elevated)]/40"
      >
        <span aria-hidden className="text-[11px] font-semibold leading-none">
          {OP_GLYPH[clause.op]}
        </span>
        <span className={"text-[10.5px] " + (isExclude ? "line-through decoration-1" : "")}>
          {clause.op === "range"
            ? `${clause.value}–${clause.valueHi}`
            : clause.value}
        </span>
      </button>
      <span aria-hidden className={
        "w-[1px] " + (isExclude
          ? "bg-[color:var(--color-border)]"
          : "bg-[color:var(--color-primary)]/40")
      } />
      <button
        type="button"
        aria-label="Remove clause"
        className="px-1.5 hover:bg-[color:var(--color-surface-elevated)]/60 text-[12px] leading-none"
      >
        ×
      </button>
    </span>
  );
}

function MruStrip({
  values, paramKey,
}: { values: readonly number[]; paramKey: string }) {
  if (values.length === 0) return null;
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span
        aria-hidden
        className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] flex-none"
        title={`Recently used ${paramKey} values on this machine + material`}
      >
        recent
      </span>
      <span aria-hidden className="text-[color:var(--color-border)]">·</span>
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            title={`Add ${paramKey} = ${v}`}
            className="px-1 h-[18px] inline-flex items-center font-mono text-[10px] tabular-nums rounded-sm border border-transparent hover:border-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-tint)] hover:text-[color:var(--color-primary)] text-[color:var(--color-ink-muted)]"
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddValueRow({
  paramKey, openEditor,
}: { paramKey: string; openEditor?: boolean }) {
  if (openEditor) {
    return (
      <div className="flex items-center gap-1 mt-0.5 p-1 rounded-sm border border-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]">
        <select
          aria-label="operator"
          defaultValue="eq"
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
          placeholder="value"
          aria-label={`${paramKey} value`}
          className="flex-1 min-w-0 font-mono text-[10.5px] tabular-nums px-1.5 h-[22px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
          autoFocus
        />
        <button
          type="button"
          title="Add (Enter)"
          className="px-2 h-[22px] font-mono text-[10px] uppercase tracking-[0.14em] rounded-sm border border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary-hover)]"
        >
          add
        </button>
        <button
          type="button"
          title="Cancel (Esc)"
          aria-label="Cancel"
          className="px-1.5 h-[22px] font-mono text-[12px] rounded-sm border border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
        >
          ×
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="flex items-center gap-1 h-[22px] px-1 -mx-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)] self-start"
    >
      <span aria-hidden className="text-[12px] leading-none">+</span>
      <span>add value</span>
    </button>
  );
}

function ParamSection({
  label, paramKey, clauses, mru, openEditor = false, defaultOpen,
}: {
  label: string;
  paramKey: string;
  clauses: Clause[];
  mru: readonly number[];
  openEditor?: boolean;
  defaultOpen?: boolean;
}) {
  const active = clauses.length;
  const [open, setOpen] = React.useState(defaultOpen ?? active > 0);
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
          <span className="flex-1 truncate">{label}</span>
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
              {clauses.map((c, i) => <ClauseChip key={i} clause={c} />)}
            </div>
          )}
          <MruStrip values={mru} paramKey={paramKey} />
          <AddValueRow paramKey={paramKey} openEditor={openEditor} />
        </div>
      )}
    </section>
  );
}

function TriStatePill<T extends string>({
  label, value, options,
}: {
  label: string;
  value: T;
  options: readonly T[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-muted)] flex-none w-[78px]">
        {label}
      </span>
      <div className="flex flex-1 gap-1">
        {options.map((v) => {
          const active = v === value;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={active}
              className={
                "flex-1 h-[22px] px-1 font-mono text-[9.5px] uppercase tracking-[0.16em] rounded-sm border " +
                (active
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]")
              }
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterStack() {
  return (
    <div className="flex flex-col gap-4">
      {/* Top status row */}
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="text-[color:var(--color-ink)]">
          <span className="text-[color:var(--color-primary)] font-semibold tabular-nums tracking-normal text-[12px]">184</span>
          <span className="text-[color:var(--color-ink-subtle)]"> / 280 in</span>
        </span>
        <button
          type="button"
          className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)]"
        >
          Clear all
        </button>
      </div>

      <SectionShell title="Filters" count={4}>
        <ParamSection
          label="POWER"
          paramKey="power"
          clauses={[
            { op: "eq", value: 14.6 },
            { op: "lt", value: 20 },
          ]}
          mru={[14.6, 50, 35, 10, 100]}
        />
        <ParamSection
          label="FREQUENCY (kHz)"
          paramKey="frequency"
          clauses={[
            { op: "range", value: 100, valueHi: 200 },
          ]}
          mru={[65, 100, 200, 444]}
        />
        <ParamSection
          label="PULSE WIDTH (ns)"
          paramKey="pulse_width"
          clauses={[]}
          mru={[200, 100, 500, 20]}
          openEditor
          defaultOpen
        />
        <ParamSection
          label="DENSITY (lines/cm)"
          paramKey="density"
          clauses={[
            { op: "neq", value: 1000 },
          ]}
          mru={[4444, 1000, 2566, 5000]}
        />
        <ParamSection
          label="SPEED (mm/s)"
          paramKey="speed"
          clauses={[]}
          mru={[333, 1500, 4000, 1152]}
          defaultOpen={false}
        />
        <ParamSection
          label="PASSES"
          paramKey="passes"
          clauses={[]}
          mru={[1, 22, 3, 2]}
          defaultOpen={false}
        />
        <ParamSection
          label="SCAN ANGLE (°)"
          paramKey="scan_angle"
          clauses={[]}
          mru={[90, 0, 45, 135]}
          defaultOpen={false}
        />
      </SectionShell>

      {/* Burn settings — tri-state */}
      <SectionShell title="Burn settings" count={1}>
        <div className="flex flex-col gap-1.5">
          <TriStatePill label="Crosshatch" value="yes" options={["any", "yes", "no"]} />
          <TriStatePill label="Uni-dir" value="any" options={["any", "yes", "no"]} />
          <TriStatePill label="Angle mode" value="any" options={["any", "fixed", "incr"]} />
        </div>
      </SectionShell>

      {/* Tests — multi-select */}
      <SectionShell title="Tests" count={1} defaultOpen={false}>
        <input
          type="search"
          placeholder="search…"
          className="font-mono text-[10.5px] px-2 h-[24px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus:outline-none focus:border-[color:var(--color-primary)]"
        />
        <div className="flex flex-col gap-0.5 max-h-[140px] overflow-y-auto pr-1">
          {[
            { id: 142, name: "SS Tag · 24-cell sweep", checked: true, kind: "swp" },
            { id: 138, name: "SS Tag · power × freq grid", checked: false, kind: "swp" },
            { id: 131, name: "SS Tag · 16-cell validation", checked: false, kind: "val" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className={
                "flex items-center gap-2 px-1 py-1 rounded-sm text-left font-mono text-[10.5px] " +
                (t.checked
                  ? "bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)]"
                  : "text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]")
              }
            >
              <span
                aria-hidden
                className={
                  "inline-block w-3 h-3 flex-none rounded-sm border " +
                  (t.checked
                    ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)]"
                    : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]")
                }
              >
                {t.checked && (
                  <svg viewBox="0 0 10 10" className="w-3 h-3">
                    <path d="M2 5.5l2 2 4-4.5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="tabular-nums text-[color:var(--color-ink-subtle)] flex-none">#{t.id}</span>
              <span className="flex-1 truncate">{t.name}</span>
              <span className="text-[9px] uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)]">{t.kind}</span>
            </button>
          ))}
        </div>
      </SectionShell>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Below-filter sections — Focus / Indices / Stats / Overlays / Neighbours / Correlations
 * ─────────────────────────────────────────────────────────────────── */

function FocusSection() {
  return (
    <SectionShell title="Focus" defaultOpen={true}>
      <div className="flex gap-2 items-start">
        <div className="w-[64px] h-[64px] flex-none rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] grid place-items-center">
          <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">a*/b*</span>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm border border-[color:var(--color-border)]" style={{ background: "#5d796b" }} />
            <span className="font-mono text-[11px] tabular-nums tracking-[0.08em] text-[color:var(--color-ink)]">#5d796b</span>
          </div>
          <p className="font-mono text-[9.5px] italic text-[color:var(--color-ink-subtle)] leading-relaxed">
            Hover or click any dot to inspect.
          </p>
        </div>
      </div>
    </SectionShell>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-2 py-1">
      <span className="font-mono uppercase tracking-[0.16em] text-[8.5px] font-semibold text-[color:var(--color-ink-subtle)]">{label}</span>
      <span className="font-mono tabular-nums text-[10.5px] text-[color:var(--color-ink)]">{value}</span>
    </div>
  );
}

function IndicesSection() {
  return (
    <SectionShell title="Indices" defaultOpen={true}>
      <div className="grid grid-cols-2 gap-1">
        <Chip label="Pulse spacing" value="0.0064 mm" />
        <Chip label="Line spacing" value="0.0020 mm" />
        <Chip label="Pulse energy" value="0.0880" />
        <Chip label="Pulse intensity" value="4.40e-4" />
        <Chip label="Total exposure" value="3.4e+4" />
        <Chip label="Ablation aggr." value="15.13" />
        <Chip label="Delivery smooth." value="7.8e+7" />
        <Chip label="Duty cycle" value="1.30%" />
      </div>
    </SectionShell>
  );
}

function StatsSection() {
  return (
    <SectionShell title="Stats" defaultOpen={false}>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] font-semibold">
          Pearson r
        </span>
        <span className="font-mono text-[24px] leading-none tabular-nums text-[color:var(--color-primary)] font-semibold">
          −0.524
        </span>
      </div>
      <div className="grid grid-cols-2 gap-y-1 gap-x-3 mt-1 font-mono">
        <div className="flex flex-col gap-0.5">
          <span className="text-[8.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">Spearman ρ</span>
          <span className="text-[12px] tabular-nums text-[color:var(--color-ink)]">−0.613</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[8.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">R²</span>
          <span className="text-[12px] tabular-nums text-[color:var(--color-ink)]">0.490</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[8.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">Slope</span>
          <span className="text-[12px] tabular-nums text-[color:var(--color-ink)]">−0.873</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[8.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">n</span>
          <span className="text-[12px] tabular-nums text-[color:var(--color-ink)]">184</span>
        </div>
      </div>
    </SectionShell>
  );
}

function OverlayToggle({
  label, checked, disabled,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      className={
        "flex items-center gap-2 px-2 py-1 rounded-sm border font-mono text-[10.5px] uppercase tracking-[0.14em] text-left " +
        (disabled
          ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] opacity-60 cursor-not-allowed"
          : checked
            ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)]"
            : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]")
      }
    >
      <span
        aria-hidden
        className={
          "inline-block w-3 h-3 rounded-sm border " +
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
      <span className="flex-1">{label}</span>
    </button>
  );
}

function OverlaysSection() {
  return (
    <SectionShell title="Overlays" count={2} defaultOpen={false}>
      <div className="flex flex-col gap-1">
        <OverlayToggle label="▦  Colour field" checked={true} />
        <OverlayToggle label="◷  Contours · L*" checked={true} />
        <OverlayToggle label="◯  Fade dots" checked={false} />
        <OverlayToggle label="✛  Focus crosshair" checked={false} />
      </div>
    </SectionShell>
  );
}

function NeighboursSection() {
  return (
    <SectionShell title="Neighbours" defaultOpen={false}>
      <div className="flex flex-col gap-1">
        {[
          { hex: "#4e6d66", de: 2.6 },
          { hex: "#537069", de: 3.3 },
          { hex: "#596b6d", de: 6.0 },
          { hex: "#58696c", de: 6.6 },
        ].map((n) => (
          <button
            key={n.hex}
            type="button"
            className="flex items-center gap-2 px-1 py-1 rounded-sm font-mono text-[10.5px] hover:bg-[color:var(--color-surface-elevated)] text-left"
          >
            <span className="w-3 h-3 rounded-sm border border-[color:var(--color-border)] flex-none" style={{ background: n.hex }} />
            <span className="tabular-nums text-[color:var(--color-ink)] flex-1">{n.hex}</span>
            <span className="text-[9.5px] uppercase tracking-[0.14em] text-[color:var(--color-ink-subtle)] tabular-nums">ΔE {n.de}</span>
          </button>
        ))}
      </div>
    </SectionShell>
  );
}

function CorrelationsSection() {
  // 5×5 mock cells just to indicate the visual style at this density.
  const rows = ["PSp", "LSp", "PEn", "PIn", "TEx", "AAg", "DSm", "Duty"];
  const cols = ["L*", "a*", "b*", "h°", "C*"];
  const seed = (i: number, j: number) => Math.abs(Math.sin(i * 9 + j * 3)) * 80 + 5;
  return (
    <SectionShell title="Correlations" defaultOpen={false}>
      <div className="flex gap-1 mb-1">
        <button type="button" className="px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] rounded-sm border border-[color:var(--color-primary)] text-[color:var(--color-primary)]">
          Indices
        </button>
        <button type="button" className="px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] rounded-sm border border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]">
          Raw params
        </button>
      </div>
      <div className="grid font-mono text-[9.5px] tabular-nums" style={{ gridTemplateColumns: "auto repeat(5, 1fr)" }}>
        {/* col headers */}
        <span />
        {cols.map((c) => (
          <span key={c} className="text-center py-0.5 text-[color:var(--color-ink-subtle)] uppercase tracking-[0.16em]">{c}</span>
        ))}
        {/* rows */}
        {rows.map((r, i) => (
          <React.Fragment key={r}>
            <span className="pr-2 text-[color:var(--color-ink-subtle)] uppercase tracking-[0.16em] self-center">{r}</span>
            {cols.map((c, j) => {
              const v = Math.round(seed(i, j));
              const sign = (i + j) % 3 === 0 ? -1 : 1;
              const display = `${v}`;
              const intensity = Math.min(1, v / 80);
              return (
                <button
                  key={c}
                  type="button"
                  className="m-[1px] aspect-square grid place-items-center rounded-[2px] text-[9.5px] tabular-nums"
                  style={{
                    background: sign < 0
                      ? `color-mix(in srgb, var(--color-primary) ${intensity * 70}%, var(--color-surface))`
                      : `color-mix(in srgb, var(--color-ink) ${intensity * 40}%, var(--color-surface))`,
                    color: intensity > 0.5 ? "white" : "var(--color-ink-muted)",
                  }}
                  title={`${r} × ${c} : r = ${sign * v / 100}`}
                >
                  {display}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <p className="font-mono text-[9px] italic text-[color:var(--color-ink-subtle)] mt-0.5">|r|×100 · click to select pair</p>
    </SectionShell>
  );
}

function RecipeRow({
  label, value, active, filterable = true,
}: {
  label: string;
  value: string;
  /** True when the Filter Stack already has an active `= value` clause
   *  for this param. Renders the button in its filled state. */
  active?: boolean;
  /** False for non-numeric or non-filterable rows (the apply button
   *  is hidden — burn settings have their own tri-state filter row). */
  filterable?: boolean;
}) {
  return (
    <>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-subtle)] self-center">
        {label}
      </span>
      <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)] text-right self-center">
        {value}
      </span>
      {filterable ? (
        <button
          type="button"
          aria-pressed={!!active}
          title={active
            ? `Filtering scatter to ${label} = ${value} — click to remove`
            : `Filter scatter to ${label} = ${value}`}
          className={
            "h-[20px] w-[20px] grid place-items-center rounded-sm transition-colors " +
            (active
              ? "bg-[color:var(--color-primary)] text-white"
              : "text-[color:var(--color-ink-subtle)] hover:bg-[color:var(--color-primary-tint)] hover:text-[color:var(--color-primary)]")
          }
        >
          <ListFilterPlus
            className="h-3.5 w-3.5"
            strokeWidth={1.8}
            aria-hidden
          />
        </button>
      ) : (
        <span aria-hidden className="h-[20px] w-[20px]" />
      )}
    </>
  );
}

function RecipeSection() {
  // Mocks a focused entry's burn params. Three columns: label / value /
  // apply-as-filter button. Clicking the [+] adds `param = value` to
  // the Filter Stack; clicking the ✓ removes it.
  const rows: { k: string; v: string; active?: boolean; filterable?: boolean }[] = [
    { k: "Power", v: "14.6 %", active: true },
    { k: "Speed", v: "1152 mm/s" },
    { k: "Frequency", v: "100 kHz" },
    { k: "Density", v: "5000" },
    { k: "Passes", v: "1" },
    { k: "Pulse width", v: "200 ns" },
    { k: "Scan angle", v: "90°" },
    { k: "Crosshatch", v: "no", filterable: false },
    { k: "Uni-directional", v: "no", filterable: false },
    { k: "Angle mode", v: "fixed", filterable: false },
  ];
  return (
    <SectionShell title="Recipe" defaultOpen={true}>
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5 items-center">
        {rows.map((r) => (
          <RecipeRow
            key={r.k}
            label={r.k}
            value={r.v}
            active={r.active}
            filterable={r.filterable}
          />
        ))}
      </div>
      <div className="mt-1 pt-1.5 border-t border-[color:var(--color-border)] flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[color:var(--color-ink-subtle)]">
        <span>Source test</span>
        <span className="text-[color:var(--color-primary)] tabular-nums">#142</span>
        <span aria-hidden>·</span>
        <span className="truncate flex-1">SS Tag · 24-cell sweep</span>
      </div>
    </SectionShell>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Two-rail composite — the new page layout
 * ─────────────────────────────────────────────────────────────────── */

function LeftRail() {
  return (
    <aside
      className="flex flex-col gap-5 border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 overflow-y-auto"
      style={{ width: 300, height: 760 }}
    >
      <FilterStack />
    </aside>
  );
}

function RightRail() {
  return (
    <aside
      className="flex flex-col gap-5 border-l border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 overflow-y-auto"
      style={{ width: 300, height: 760 }}
    >
      <FocusSection />
      <RecipeSection />
      <IndicesSection />
      <NeighboursSection />
      <StatsSection />
      <CorrelationsSection />
      <OverlaysSection />
    </aside>
  );
}

function ChartPlaceholder() {
  return (
    <div
      className="flex-1 min-w-[400px] grid place-items-center bg-[color:var(--color-bg)] border-y border-[color:var(--color-border)]"
      style={{ height: 760 }}
    >
      <div className="flex flex-col items-center gap-2 text-center px-6">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold">
          scatter
        </span>
        <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)] max-w-[40ch]">
          chart fills this column; both rails are capped to viewport
          height and scroll internally if their contents need it
        </span>
      </div>
    </div>
  );
}

export function ExposureFilterStackConcept() {
  return (
    <div className="flex w-full max-w-full overflow-x-auto">
      <LeftRail />
      <ChartPlaceholder />
      <RightRail />
    </div>
  );
}

