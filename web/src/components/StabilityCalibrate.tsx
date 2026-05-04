import { useMemo } from "react";
import { deltaE76, labToHex, type Lab } from "../color/math";
import type { ValidationCell } from "../types";
import { cn } from "../ui";
import {
  applyTransform,
  fitAffineTransform,
  summariseDistribution,
  type AffineTransform,
  type CalibrationFit,
  type CalibrationResult,
  type DistributionData,
} from "./stabilityCalibrateMath";
import type { SeriesInput } from "./stabilityChartMath";

/* StabilityCalibrate — fourth canvas of the stability page. Fits a
 * 12-parameter Lab→Lab affine on the chosen reference run, previews
 * the post-correction ΔE distribution, and offers an APPLY TO CHART
 * toggle that pipes the fit through SCATTER / SPATIAL / SPECTRUMS.
 * Math lives in ``stabilityCalibrateMath.ts``. */

interface Props {
  cells: ValidationCell[];
  series: SeriesInput[];
  referenceResultId: number | null;
  applyToChart: boolean;
  onApplyToChartChange: (on: boolean) => void;
}

export function StabilityCalibrate({
  cells,
  series,
  referenceResultId,
  applyToChart,
  onApplyToChartChange,
}: Props) {
  const reference = useMemo(() => {
    if (series.length === 0) return null;
    if (referenceResultId == null) return series[0];
    return series.find((s) => s.resultId === referenceResultId) ?? series[0];
  }, [series, referenceResultId]);

  const pairs = useMemo<{ measured: Lab; expected: Lab }[]>(() => {
    if (reference == null) return [];
    const out: { measured: Lab; expected: Lab }[] = [];
    for (const c of cells) {
      const exp = c.expected_lab as Lab | number[];
      if (!Array.isArray(exp) || exp.length !== 3) continue;
      const m = reference.cells.get(c.cell_index);
      if (m == null) continue;
      out.push({
        measured: [m.lab[0], m.lab[1], m.lab[2]],
        expected: [exp[0], exp[1], exp[2]],
      });
    }
    return out;
  }, [reference, cells]);

  const fitResult: CalibrationResult | null = useMemo(
    () => (pairs.length === 0 ? null : fitAffineTransform(pairs)),
    [pairs],
  );

  const distribution = useMemo(() => {
    const t = fitResult != null && fitResult.ok ? fitResult.fit.transform : null;
    return computeBeforeAfter(cells, series, t);
  }, [cells, series, fitResult]);

  if (series.length === 0) {
    return <Empty message="Pick at least one result to calibrate against." />;
  }
  if (fitResult == null) {
    return (
      <Empty message="The reference run has no comparable cells against the base test." />
    );
  }
  if (!fitResult.ok) {
    return (
      <Empty
        tone="warning"
        message={
          fitResult.failure.kind === "too_few_cells"
            ? `Need ≥ 12 comparable cells to fit (got ${fitResult.failure.n}). Pick a run with broader sampling.`
            : "Fit unstable — measurements span only a plane in Lab. Pick a different reference run."
        }
      />
    );
  }

  const fit = fitResult.fit;
  return (
    <div className="flex-1 min-h-0 overflow-auto rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
      <CalibrateCaption referenceLabel={reference?.label ?? "—"} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-px bg-[color:var(--color-border)]">
        <TransformPanel transform={fit.transform} />
        <FitQualityPanel fit={fit} />
      </div>
      <PerCellPreview
        cells={cells}
        reference={reference!}
        transform={fit.transform}
      />
      <DistributionPanel
        before={distribution.before}
        after={distribution.after}
        runCount={series.length}
        applyToChart={applyToChart}
        onApplyToChartChange={onApplyToChartChange}
      />
    </div>
  );
}

/* ─── Caption ──────────────────────────────────────────────────────────
 *
 * One-line orientation: what the calibrate tab fits and what the
 * APPLY toggle does. Every other tab is "show the data"; this tab
 * is "fit a model and preview a correction" — the user should know
 * which run feeds the fit before they read the matrix.
 */
function CalibrateCaption({ referenceLabel }: { referenceLabel: string }) {
  return (
    <div className="px-5 py-3 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      <p className="font-mono text-[11px] text-[color:var(--color-ink-muted)] leading-relaxed m-0">
        Fits a Lab → Lab affine that pulls{" "}
        <span className="font-semibold text-[color:var(--color-ink)]">
          {referenceLabel}
        </span>
        ’s measured cells back toward the palette’s expected colours.{" "}
        <span className="text-[color:var(--color-ink-subtle)]">
          A is the 3 × 3 channel mix; b is the per-channel offset.
        </span>{" "}
        Toggle <span className="font-semibold">APPLY TO CHART</span> below
        to preview the correction in SCATTER / SPATIAL / SPECTRUMS / POLAR.
      </p>
    </div>
  );
}

/* ─── Per-cell preview ────────────────────────────────────────────────
 *
 * One row per validation cell, three swatches each:
 *   EXPECTED — the palette's target colour (cell.expected_hex)
 *   BEFORE   — the reference run's measured Lab → hex
 *   AFTER    — applyTransform(measured) → hex (post-correction)
 *
 * Plus a ΔE label per row for before / after so the user can see
 * which cells the calibration helps vs hurts. Sorted by BEFORE ΔE
 * descending so the worst offenders sit at the top.
 */
function PerCellPreview({
  cells,
  reference,
  transform,
}: {
  cells: ValidationCell[];
  reference: SeriesInput;
  transform: AffineTransform;
}) {
  const rows = useMemo(() => {
    const out: {
      cellIndex: number;
      expectedHex: string;
      beforeHex: string;
      afterHex: string;
      beforeDe: number;
      afterDe: number;
    }[] = [];
    for (const c of cells) {
      const exp = c.expected_lab as Lab | number[];
      if (!Array.isArray(exp) || exp.length !== 3) continue;
      const m = reference.cells.get(c.cell_index);
      if (m == null) continue;
      const measured: Lab = [m.lab[0], m.lab[1], m.lab[2]];
      const expected: Lab = [exp[0], exp[1], exp[2]];
      const correctedLab = applyTransform(transform, measured);
      out.push({
        cellIndex: c.cell_index,
        expectedHex: c.expected_hex,
        beforeHex: m.hex,
        afterHex: labToHex(correctedLab),
        beforeDe: deltaE76(measured, expected),
        afterDe: deltaE76(correctedLab, expected),
      });
    }
    out.sort((a, b) => b.beforeDe - a.beforeDe);
    return out;
  }, [cells, reference, transform]);

  if (rows.length === 0) return null;

  return (
    <section className="border-t border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-5">
      <PanelHeading
        title="Per-cell preview"
        subtitle={`${rows.length} cell${rows.length === 1 ? "" : "s"} · sorted by pre-correction ΔE`}
      />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full font-mono text-[10.5px] tabular-nums">
          <thead>
            <tr className="text-left text-[9px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
              <th className="px-2 py-1 w-[44px]">Cell</th>
              <th className="px-2 py-1">Expected</th>
              <th className="px-2 py-1">Before</th>
              <th className="px-2 py-1">After</th>
              <th className="px-2 py-1 text-right">ΔE before</th>
              <th className="px-2 py-1 text-right">ΔE after</th>
              <th className="px-2 py-1 text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const improved = r.afterDe < r.beforeDe;
              const delta = r.afterDe - r.beforeDe;
              return (
                <tr
                  key={r.cellIndex}
                  className="border-t border-[color:var(--color-border)]/60"
                >
                  <td className="px-2 py-1 text-[color:var(--color-ink-subtle)]">
                    #{r.cellIndex}
                  </td>
                  <td className="px-2 py-1">
                    <PreviewSwatch hex={r.expectedHex} label={r.expectedHex} />
                  </td>
                  <td className="px-2 py-1">
                    <PreviewSwatch hex={r.beforeHex} label={r.beforeHex} />
                  </td>
                  <td className="px-2 py-1">
                    <PreviewSwatch hex={r.afterHex} label={r.afterHex} />
                  </td>
                  <td className="px-2 py-1 text-right text-[color:var(--color-ink-muted)]">
                    {r.beforeDe.toFixed(1)}
                  </td>
                  <td className="px-2 py-1 text-right text-[color:var(--color-ink)]">
                    {r.afterDe.toFixed(1)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 text-right",
                      improved
                        ? "text-[color:var(--color-success)]"
                        : "text-[color:var(--color-warning,#b8860b)]",
                    )}
                  >
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PreviewSwatch({ hex, label }: { hex: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={label}
    >
      <span
        aria-hidden
        className="inline-block h-4 w-7 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
        style={{ background: hex }}
      />
      <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)] uppercase">
        {hex}
      </span>
    </span>
  );
}

/* ─── Transform display ──────────────────────────────────────────────── */

const NUMBER_CELL =
  "h-7 px-2 inline-flex items-center justify-end font-mono text-[11.5px] tabular-nums text-[color:var(--color-ink)] rounded-[4px] border border-transparent";
const GREEK =
  "font-mono text-[11px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]";
const NUMBER_BOX =
  "inline-grid grid-cols-3 gap-1 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-2";

function TransformPanel({ transform }: { transform: AffineTransform }) {
  return (
    <section className="bg-[color:var(--color-surface-elevated)] p-5">
      <PanelHeading title="Transform" subtitle="A · measured + b ≈ expected" />
      <div className="mt-4 grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 gap-y-3 items-center">
        <span className={GREEK}>A</span>
        <div className={NUMBER_BOX}>
          {transform.A.flatMap((row, i) =>
            row.map((v, j) => (
              <NumberCell
                key={`a-${i}-${j}`}
                value={v}
                highlight={i !== j && Math.abs(v) > 0.1}
                title={`A[${i}][${j}] = ${v.toFixed(4)}`}
              />
            )),
          )}
        </div>
        <span className={GREEK}>b</span>
        <div className={NUMBER_BOX}>
          {transform.b.map((v, j) => (
            <NumberCell
              key={`b-${j}`}
              value={v}
              highlight={false}
              title={`b[${j}] = ${v.toFixed(4)}`}
            />
          ))}
        </div>
      </div>
      <p className="mt-3 font-mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
        Off-diagonals above 0.1 highlighted — channel cross-mixing.
      </p>
    </section>
  );
}

function NumberCell({
  value,
  highlight,
  title,
}: {
  value: number;
  highlight: boolean;
  title: string;
}) {
  return (
    <span
      className={cn(
        NUMBER_CELL,
        highlight &&
          "bg-[color:var(--color-primary)]/10 border-[color:var(--color-primary)]/30",
      )}
      title={title}
    >
      {formatSigned(value)}
    </span>
  );
}

/* ─── Fit quality ──────────────────────────────────────────────────────── */

function FitQualityPanel({ fit }: { fit: CalibrationFit }) {
  return (
    <section className="bg-[color:var(--color-surface-elevated)] p-5">
      <PanelHeading title="Fit quality" subtitle="Per-channel R² + residual ΔE" />
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-baseline">
        <Stat label="R² L" value={fit.rSquared[0].toFixed(3)} flag={fit.rSquared[0] < 0.7} />
        <Stat label="R² a" value={fit.rSquared[1].toFixed(3)} flag={fit.rSquared[1] < 0.7} />
        <Stat label="R² b" value={fit.rSquared[2].toFixed(3)} flag={fit.rSquared[2] < 0.7} />
      </dl>
      <hr className="my-3 border-[color:var(--color-border)]" />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-baseline">
        <Stat label="Residual median" value={`${fmt(fit.medianResidualDeltaE)} ΔE`} flag={false} />
        <Stat label="Residual max" value={`${fmt(fit.maxResidualDeltaE)} ΔE`} flag={false} />
        <Stat label="N cells" value={String(fit.n)} flag={false} />
      </dl>
    </section>
  );
}

function Stat({ label, value, flag }: { label: string; value: string; flag: boolean }) {
  return (
    <>
      <dt className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </dt>
      <dd
        className={cn(
          "font-mono text-[12px] tabular-nums",
          flag
            ? "text-[color:var(--color-warning,#b8860b)]"
            : "text-[color:var(--color-ink)]",
        )}
      >
        {value}
      </dd>
    </>
  );
}

/* ─── Before / after distribution ─────────────────────────────────────── */

function DistributionPanel({
  before,
  after,
  runCount,
  applyToChart,
  onApplyToChartChange,
}: {
  before: DistributionData;
  after: DistributionData;
  runCount: number;
  applyToChart: boolean;
  onApplyToChartChange: (on: boolean) => void;
}) {
  // Common scale across both bars + floor at 1 ΔE so a flat-zero
  // "after" never collapses entirely.
  const sharedMax = Math.max(before.max, after.max, 1);
  return (
    <section className="border-t border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-5">
      <PanelHeading
        title="Post-correction ΔE distribution"
        subtitle="Bins span 0 → max ΔE; one count per (cell × run)."
      />
      <div className="mt-4 space-y-4">
        <DistributionBar label="Before" tone="muted" data={before} sharedMax={sharedMax} />
        <DistributionBar label="After" tone="primary" data={after} sharedMax={sharedMax} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onApplyToChartChange(!applyToChart)}
          aria-pressed={applyToChart}
          className={cn(
            "h-7 px-3 rounded-[6px] inline-flex items-center gap-2",
            "font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase",
            "border transition-colors focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
            applyToChart
              ? "bg-[color:var(--color-primary)] text-white border-[color:var(--color-primary)]"
              : "bg-[color:var(--color-surface)] border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 rounded-full",
              applyToChart ? "bg-white" : "bg-[color:var(--color-ink-subtle)]",
            )}
          />
          Apply to chart
        </button>
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
          applies to: selected runs · {runCount}
        </span>
      </div>
    </section>
  );
}

function DistributionBar({
  label,
  tone,
  data,
  sharedMax,
}: {
  label: string;
  tone: "muted" | "primary";
  data: DistributionData;
  sharedMax: number;
}) {
  const BIN_COUNT = 32;
  const counts = new Array<number>(BIN_COUNT).fill(0);
  if (sharedMax > 0) {
    for (const v of data.values) {
      let idx = Math.floor((v / sharedMax) * BIN_COUNT);
      if (idx >= BIN_COUNT) idx = BIN_COUNT - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    }
  }
  const peak = counts.reduce((a, b) => Math.max(a, b), 0) || 1;
  const fill = tone === "primary" ? "var(--color-primary)" : "var(--color-ink-subtle)";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          {label}
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)]">
          median {fmt(data.median)} · max {fmt(data.max)}
          <span className="text-[color:var(--color-ink-subtle)]"> · n {data.count}</span>
        </span>
      </div>
      <div
        className="mt-1.5 flex h-7 items-end gap-[1px] rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-1 py-1"
        aria-hidden
      >
        {counts.map((c, i) => (
          <span
            key={`b-${i}`}
            className="flex-1"
            style={{
              height: `${Math.max(c > 0 ? 12 : 0, (c / peak) * 100)}%`,
              background: fill,
              opacity: tone === "primary" ? 0.85 : 0.55,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Shared bits ──────────────────────────────────────────────────────── */

function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">{title}</div>
      <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)]">{subtitle}</div>
    </div>
  );
}

function Empty({ message, tone }: { message: string; tone?: "warning" }) {
  return (
    <div className="flex-1 min-h-0 rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] flex items-center justify-center px-6">
      <div
        className={cn(
          "font-mono text-[11px] tracking-[0.16em] uppercase text-center max-w-[60ch]",
          tone === "warning"
            ? "text-[color:var(--color-warning,#b8860b)]"
            : "text-[color:var(--color-ink-subtle)]",
        )}
      >
        {message}
      </div>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function formatSigned(v: number): string {
  return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}` : "—";
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
}

function computeBeforeAfter(
  cells: ValidationCell[],
  series: SeriesInput[],
  transform: AffineTransform | null,
): { before: DistributionData; after: DistributionData } {
  const before: number[] = [];
  const after: number[] = [];
  for (const c of cells) {
    const exp = c.expected_lab as Lab | number[];
    if (!Array.isArray(exp) || exp.length !== 3) continue;
    const expLab: Lab = [exp[0], exp[1], exp[2]];
    for (const s of series) {
      const m = s.cells.get(c.cell_index);
      if (m == null) continue;
      before.push(deltaE76(m.lab, expLab));
      if (transform != null) {
        after.push(deltaE76(applyTransform(transform, m.lab), expLab));
      }
    }
  }
  return {
    before: summariseDistribution(before),
    after: summariseDistribution(after),
  };
}
