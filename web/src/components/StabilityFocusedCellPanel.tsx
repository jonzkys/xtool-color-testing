import { useEffect, useMemo, useState } from "react";
import { labToHex, type Lab } from "../color/math";
import type { ResultRecord, TestRecord } from "../types";
import { cn } from "../ui";
import { seriesColour, type FocusedCell } from "./StabilityChart";
import { cellResidual, signedNum } from "./stabilityStatsMath";

interface FocusedCellPanelProps {
  test: TestRecord;
  /** Selected results (cached, with full swatches). */
  results: ResultRecord[];
  cellIndex: number;
  /** Re-pin focus on the same cell — used by the close button (clears)
   *  and chip clicks (re-asserts). */
  onCellClick: (cellIndex: number) => void;
  /** Clear focus everywhere. */
  onClose: () => void;
  /** Used purely for the `aria-pressed` styling — when ``true`` we
   *  highlight the close button as the focus-clearing target. */
  focusedCell: FocusedCell;
  /** cells_per_row inferred from the test spec — needed to map a
   *  result swatch (row,col) back to a cell_index. */
  cellsPerRow: number | null;
}

/**
 * Drilldown card for the cross-view focused cell. Renders four
 * sections — EXPECTED swatch, per-run MEASURED chips + BURN MEAN,
 * RESIDUAL breakdown, and the BURN PARAMS the cell was burned with.
 *
 * The card is conceptually a richer tooltip: it appears at the top of
 * the right stat strip whenever a cell is focused (transient or
 * pinned) and disappears when focus clears. Replaces nothing; it
 * stacks above the existing iter-3 / iter-5 / iter-6 cards.
 */
export function StabilityFocusedCellPanel({
  test,
  results,
  cellIndex,
  onCellClick,
  onClose,
  cellsPerRow,
}: FocusedCellPanelProps) {
  const cell = useMemo(
    () => test.validation_cells.find((c) => c.cell_index === cellIndex) ?? null,
    [test, cellIndex],
  );

  // Per-result measurement for this cell, in the same order as
  // ``results`` (which mirrors the chart series order, hence the chip
  // colours line up with the legend).
  const measurements = useMemo(() => {
    if (cellsPerRow == null) return [];
    return results.map((r, i) => {
      const sw =
        r.swatches.find(
          (s) => s.row * cellsPerRow + s.col === cellIndex,
        ) ?? null;
      return {
        result: r,
        seriesIndex: i,
        // Filter at render time but keep the index so colours stay
        // stable when a run is missing this cell.
        sw,
      };
    });
  }, [results, cellIndex, cellsPerRow]);

  // Out-of-range / no-validation-cell guard — render a small caption
  // so the panel still grounds the focus state visually rather than
  // disappearing on the user.
  if (cell == null) {
    return (
      <Wrapper onClose={onClose}>
        <header className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-[color:var(--color-primary)]/30">
          <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)]">
            Focused cell · #{cellIndex}
          </div>
          <CloseButton onClose={onClose} />
        </header>
        <div className="px-2.5 py-3 text-center font-mono text-[9.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          cell unavailable
        </div>
      </Wrapper>
    );
  }

  const expectedLab: Lab | null =
    Array.isArray(cell.expected_lab) && cell.expected_lab.length === 3
      ? [cell.expected_lab[0], cell.expected_lab[1], cell.expected_lab[2]]
      : null;

  const presentMeasurements = measurements.filter((m) => m.sw != null);
  const labsForResidual: Lab[] = presentMeasurements.flatMap((m) =>
    Array.isArray(m.sw!.lab) && m.sw!.lab.length === 3
      ? [[m.sw!.lab[0], m.sw!.lab[1], m.sw!.lab[2]] as Lab]
      : [],
  );

  // Burn-mean hex for the chip strip — only meaningful when ≥2
  // measurements exist (otherwise the single chip already IS the
  // burn-mean estimate). Lab → sRGB hex via the page's existing
  // converter; out-of-gamut values clip rather than render as a CSS
  // ``lab()`` literal, which keeps the readout copy-friendly.
  const burnMeanHex = useMemo(() => {
    if (labsForResidual.length < 2) return null;
    let sL = 0;
    let sA = 0;
    let sB = 0;
    for (const l of labsForResidual) {
      sL += l[0];
      sA += l[1];
      sB += l[2];
    }
    return labToHex([
      sL / labsForResidual.length,
      sA / labsForResidual.length,
      sB / labsForResidual.length,
    ]);
  }, [labsForResidual]);

  const residual =
    expectedLab != null && labsForResidual.length > 0
      ? cellResidual(labsForResidual, expectedLab)
      : null;

  return (
    <Wrapper onClose={onClose}>
      <header className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-[color:var(--color-primary)]/30">
        <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)]">
          Focused cell · #{cellIndex}
        </div>
        <CloseButton onClose={onClose} />
      </header>

      <Section label="Expected">
        <div className="flex items-center gap-2.5">
          <SwatchChip
            hex={cell.expected_hex}
            size={[64, 24]}
            outline="strong"
            onClick={() => onCellClick(cellIndex)}
            ariaLabel={`expected swatch ${cell.expected_hex}`}
          />
          <div className="flex flex-col gap-0.5 min-w-0">
            <CopyableHex hex={cell.expected_hex} />
            {expectedLab && (
              <div className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)] truncate">
                Lab {fmtLab(expectedLab[0])} / {signedNum(expectedLab[1])} /{" "}
                {signedNum(expectedLab[2])}
              </div>
            )}
          </div>
        </div>
      </Section>

      {presentMeasurements.length > 0 && expectedLab != null && (
        <Section
          label={`Measured · ${presentMeasurements.length} run${presentMeasurements.length === 1 ? "" : "s"}`}
        >
          <ul className="flex flex-col gap-1">
            {presentMeasurements.map((m) => {
              const lab = m.sw!.lab;
              if (!Array.isArray(lab) || lab.length !== 3) return null;
              const labTuple: Lab = [lab[0], lab[1], lab[2]];
              const dE = euclidean(labTuple, expectedLab);
              const isSingleton = presentMeasurements.length === 1;
              return (
                <RunChipRow
                  key={m.result.id}
                  hex={m.sw!.hex}
                  colour={seriesColour(m.seriesIndex)}
                  label={shortStamp(m.result.uploaded_at)}
                  dE={dE}
                  primary={isSingleton}
                />
              );
            })}
          </ul>
          {presentMeasurements.length >= 2 && burnMeanHex != null && (
            <>
              <div
                aria-hidden
                className="my-1.5 h-px w-full bg-[color:var(--color-primary)]/20"
              />
              <BurnMeanRow
                hex={burnMeanHex}
                dE={
                  residual != null && Number.isFinite(residual.deltaE)
                    ? residual.deltaE
                    : null
                }
              />
            </>
          )}
        </Section>
      )}

      {residual != null && presentMeasurements.length > 0 && (
        <Section label="Residual · vs expected (burn-mean)">
          <div className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)] flex flex-wrap gap-x-3 gap-y-0.5">
            <ResidualPair label="ΔL" value={signedNum(residual.deltaL)} />
            <ResidualPair label="Δa" value={signedNum(residual.deltaA)} />
            <ResidualPair label="Δb" value={signedNum(residual.deltaB)} />
            <ResidualPair
              label="Δh°"
              value={
                residual.deltaHue != null
                  ? `${signedNum(residual.deltaHue, 1)}°`
                  : "—"
              }
            />
          </div>
        </Section>
      )}

      {presentMeasurements.length === 0 && (
        <div className="px-2.5 pt-2 pb-1 text-center font-mono text-[9.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          select a result to compare
        </div>
      )}

      <Section label="Burn params">
        <BurnParamsGrid params={cell.params} />
      </Section>
    </Wrapper>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────── */

function Wrapper({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Esc to clear is already wired at the page level; we still listen
  // to clicks on the close button. The wrapper inherits the iter-3
  // tinted-bordered card aesthetic so it visually belongs with the
  // BURN vs CAMERA / σ ACROSS RUNS cards directly below.
  void onClose;
  return (
    <div className="rounded-[8px] border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/40 overflow-hidden">
      {children}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Clear focus"
      className={cn(
        "shrink-0 rounded-[3px] px-1 py-0.5",
        "font-mono text-[11px] leading-none text-[color:var(--color-primary)]/70",
        "hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)]/10",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60",
        "transition-colors",
      )}
      title="Clear focus (Esc)"
    >
      ✕
    </button>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-2.5 py-2 border-t border-[color:var(--color-primary)]/20 first-of-type:border-t-0">
      <div className="font-mono text-[9px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Single 24×24 chip with a coloured ring matching the chart series
 *  legend, the run timestamp, the run's hex value, and ΔE vs
 *  expected. Tooltip-only — chip click is wired to a passive copy of
 *  the run hex (consistent with the other hex spans on the card). */
function RunChipRow({
  hex,
  colour,
  label,
  dE,
  primary,
}: {
  hex: string;
  colour: string;
  label: string;
  dE: number;
  primary: boolean;
}) {
  return (
    <li className="flex items-center gap-2 min-w-0">
      <SwatchChip
        hex={hex}
        size={primary ? [32, 32] : [24, 24]}
        outline={primary ? "primary" : "series"}
        ringColour={colour}
        title={`${label} · ${hex} · ΔE ${dE.toFixed(1)}`}
        ariaLabel={`run ${label} swatch ${hex}`}
      />
      <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink)] truncate">
          {label}
        </span>
        <span className="flex items-baseline gap-1.5 shrink-0">
          <CopyableHex hex={hex} compact />
          <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
            ΔE {dE.toFixed(1)}
          </span>
        </span>
      </div>
    </li>
  );
}

function BurnMeanRow({
  hex,
  dE,
}: {
  hex: string;
  dE: number | null;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <SwatchChip
        hex={hex}
        size={[32, 32]}
        outline="primary"
        title={`burn mean · ${hex}${dE != null ? ` · ΔE ${dE.toFixed(1)}` : ""}`}
        ariaLabel={`burn mean swatch ${hex}`}
      />
      <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-primary)] truncate">
          Burn mean
        </span>
        <span className="flex items-baseline gap-1.5 shrink-0">
          <CopyableHex hex={hex} compact />
          {dE != null && (
            <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-primary)]/80">
              ΔE {dE.toFixed(1)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function ResidualPair({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums">{value}</span>
    </span>
  );
}

function BurnParamsGrid({
  params,
}: {
  params: Record<string, string | number>;
}) {
  // Render every key the row carries — we trust the burn payload that
  // was actually used for this cell over a profile-aware allow-list.
  // Skip nullish values and the always-zero ``crosshatch`` flag (a
  // numeric 0 reads as a stray "0" in the grid otherwise; keep
  // non-zero values).
  const entries = Object.entries(params)
    .filter(([k, v]) => {
      if (v == null) return false;
      if (k === "crosshatch" && (v === 0 || v === "0")) return false;
      return true;
    })
    .map(([k, v]) => [k, formatParamValue(k, v)] as const);

  if (entries.length === 0) {
    return (
      <div className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
        no params recorded
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-2 min-w-0"
        >
          <dt className="font-mono text-[9px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] shrink-0">
            {prettyParamKey(k)}
          </dt>
          <dd className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink)] truncate">
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline copyable hex span. Click → writes to clipboard, flashes a
 *  tiny `copied` chip in place of the value for 1.2 s. */
function CopyableHex({
  hex,
  compact = false,
}: {
  hex: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        // ``navigator.clipboard`` is gated on secure contexts; we
        // fall back to a noop on http: pages — the toast still
        // flashes so the user gets feedback either way.
        const cb = (navigator as Navigator).clipboard;
        if (cb && typeof cb.writeText === "function") {
          cb.writeText(hex).catch(() => {});
        }
        setCopied(true);
      }}
      title={copied ? "copied" : `copy ${hex}`}
      aria-live="polite"
      className={cn(
        "font-mono tabular-nums",
        compact ? "text-[10px]" : "text-[11px]",
        "rounded-[3px] px-0.5 -mx-0.5",
        "hover:bg-[color:var(--color-primary)]/10 hover:text-[color:var(--color-primary)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60",
        "transition-colors",
        copied
          ? "text-[color:var(--color-primary)]"
          : "text-[color:var(--color-ink)]",
      )}
    >
      {copied ? "copied" : hex}
    </button>
  );
}

/** Square-ish swatch chip with rounded 3 px corners + thin border.
 *  Three outline variants: ``strong`` (the EXPECTED reference colour),
 *  ``primary`` (burn-mean / single-run "best estimate"), ``series``
 *  (per-run, 2 px ring in the chart series colour). */
function SwatchChip({
  hex,
  size,
  outline,
  ringColour,
  onClick,
  title,
  ariaLabel,
}: {
  hex: string;
  size: [number, number];
  outline: "strong" | "primary" | "series";
  ringColour?: string;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
}) {
  const [w, h] = size;
  const isButton = onClick != null;
  const className = cn(
    "shrink-0 rounded-[3px]",
    outline === "strong" &&
      "border border-[color:var(--color-border-strong)]",
    outline === "primary" &&
      "border-2 border-[color:var(--color-primary)] shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-primary)_25%,transparent)]",
    outline === "series" && "border-2",
    isButton &&
      "cursor-pointer transition-transform hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60",
  );
  const style: React.CSSProperties = {
    width: w,
    height: h,
    background: hex,
    borderColor: outline === "series" ? ringColour : undefined,
  };
  if (isButton) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
        className={className}
        style={style}
      />
    );
  }
  return (
    <div
      role="img"
      title={title}
      aria-label={ariaLabel}
      className={className}
      style={style}
    />
  );
}

/* ─── Pure helpers ────────────────────────────────────────────────────── */

function shortStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${time}`;
}

function fmtLab(v: number): string {
  return v.toFixed(1);
}

function euclidean(a: Lab, b: Lab): number {
  const dL = a[0] - b[0];
  const dA = a[1] - b[1];
  const dB = a[2] - b[2];
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

/** Pretty-print a known param key. Falls back to the raw key for
 *  unknowns so a future-added field isn't silently dropped. */
function prettyParamKey(k: string): string {
  switch (k) {
    case "power":
      return "power";
    case "speed":
      return "speed";
    case "frequency":
      return "freq";
    case "passes":
      return "passes";
    case "pulse_width":
      return "pulse";
    case "laser":
      return "laser";
    case "scan_angle":
      return "angle";
    case "angle_mode":
      return "angle mode";
    case "mode":
      return "mode";
    case "density":
      return "density";
    case "crosshatch":
      return "crosshatch";
    default:
      return k.replace(/_/g, " ");
  }
}

/** Pretty-format a known param value: ``frequency`` becomes ``60kHz``,
 *  ``pulse_width`` becomes ``200ns``. Strings pass through; numbers
 *  default to a decimal-trimmed representation. */
function formatParamValue(
  k: string,
  v: string | number,
): string {
  if (typeof v === "string") return v;
  switch (k) {
    case "frequency":
      return `${v}kHz`;
    case "pulse_width":
      return `${v}ns`;
    case "scan_angle":
      return `${v}°`;
    default:
      return String(v);
  }
}
