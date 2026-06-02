/**
 * Relief — tone-stretch controls (experimental).
 *
 * Sibling to ``ReliefControls``: the same Workshop-Instrument register — a
 * dense ``Section`` of ``Field``s, JetBrains-mono numerics, metallic dividers,
 * native range inputs tinted with ``--color-primary``. A single Mode dropdown
 * picks the tone-map; per-mode sliders refine it. The stretch is applied AFTER
 * smoothing — monotonic modes run client-side as a 256-LUT (instant), CLAHE on
 * the backend. See ``./stretch.ts``.
 */

import type { ReactNode } from "react";
import { Card, Field, Section, Select } from "../../ui";
import type { StretchMode, StretchParams } from "./stretch";

export interface StretchControlsProps {
  params: StretchParams;
  onChange: (p: StretchParams) => void;
}

const MODE_OPTIONS: { value: StretchMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "linear", label: "Linear" },
  { value: "gamma", label: "Gamma" },
  { value: "asinh", label: "Asinh" },
  { value: "equalize", label: "Equalize" },
  { value: "clahe", label: "CLAHE" },
];

/** One-line description of what the active mode does. */
function modeHint(mode: StretchMode): string {
  switch (mode) {
    case "none":
      return "No change — pick a mode to stretch the tones.";
    case "linear":
      return "Pull black/white points to 0–255; relative depth preserved.";
    case "gamma":
      return "Power curve over the trimmed range.";
    case "asinh":
      return "Nonlinear low-end lift (astro screen-stretch).";
    case "equalize":
      return "Global histogram equalization.";
    case "clahe":
      return "Tile-adaptive local contrast — runs on the server.";
  }
}

export function StretchControls({ params, onChange }: StretchControlsProps) {
  // Immutable single-field patch (mirrors ReliefControls.set).
  const set = <K extends keyof StretchParams>(key: K, value: StretchParams[K]) =>
    onChange({ ...params, [key]: value });

  const { mode } = params;
  const showClipCaveat =
    mode === "linear" || mode === "gamma" || mode === "asinh";

  return (
    <Card padded={false} className="flex flex-col gap-4 p-4">
      <Section
        title="Stretch"
        dense
        titleHint="Experimental — remap tones after smoothing to fill the palette."
      >
        <Field label="Mode" hint={modeHint(mode)}>
          <Select
            aria-label="Mode"
            value={mode}
            onChange={(e) => set("mode", e.target.value as StretchMode)}
          >
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        {mode === "linear" && (
          <>
            <Slider
              label="Clip low %"
              value={params.clipLowPct}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => set("clipLowPct", v)}
              hint="Trim this % of the darkest pixels onto the black point."
            />
            <Slider
              label="Clip high %"
              value={params.clipHighPct}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => set("clipHighPct", v)}
            />
          </>
        )}

        {mode === "gamma" && (
          <>
            <Slider
              label="Clip %"
              value={params.clipPct}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => set("clipPct", v)}
            />
            <Slider
              label="Gamma"
              value={params.gamma}
              min={0.2}
              max={2.5}
              step={0.05}
              onChange={(v) => set("gamma", v)}
              hint="< 1 lifts midtones, > 1 deepens them."
            />
          </>
        )}

        {mode === "asinh" && (
          <>
            <Slider
              label="Clip %"
              value={params.clipPct}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => set("clipPct", v)}
            />
            <Slider
              label="Strength"
              value={params.asinhStrength}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set("asinhStrength", v)}
              hint="Astro-style lift of low / shallow relief."
            />
          </>
        )}

        {mode === "clahe" && (
          <>
            <Slider
              label="Clip limit"
              value={params.claheClipLimit}
              min={1}
              max={8}
              step={0.5}
              onChange={(v) => set("claheClipLimit", v)}
              hint="Higher = stronger local contrast."
            />
            <Field label="Tiles" hint="Adaptive grid — finer = more local.">
              <SegmentedChoice
                value={params.claheTiles}
                options={[
                  { value: 4, label: "4" },
                  { value: 8, label: "8" },
                  { value: 16, label: "16" },
                ]}
                onChange={(v) => set("claheTiles", v)}
              />
            </Field>
          </>
        )}

        {showClipCaveat && (
          <p className="text-[11px] leading-relaxed text-[color:var(--color-ink-subtle)]">
            Clipping discards extreme pixels — keep it low to preserve peak
            depth.
          </p>
        )}
      </Section>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

/** Format a slider value to a sensible precision for its step. */
function formatVal(value: number, step: number): string {
  if (step >= 1) return String(value);
  if (step >= 0.5) return value.toFixed(1);
  return value.toFixed(2);
}

/** Native range slider with a live mono value in the label — integer or
 *  fractional depending on ``step`` (mirrors ReliefControls's Slider). */
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
}) {
  const isFloat = step < 1;
  return (
    <Field
      label={
        <span className="flex w-full items-baseline justify-between gap-3">
          <span>{label}</span>
          <span className="font-mono tabular-nums text-[12px] text-[color:var(--color-ink)]">
            {formatVal(value, step)}
          </span>
        </span>
      }
      hint={hint}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) =>
          onChange(
            isFloat
              ? parseFloat(e.target.value)
              : parseInt(e.target.value, 10),
          )
        }
        className="w-full accent-[color:var(--color-primary)]"
        aria-label={label}
      />
    </Field>
  );
}

/** Segmented control for the CLAHE tile choice (mirrors ReliefControls). */
function SegmentedChoice<T extends number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex overflow-hidden rounded-[7px] border border-[color:var(--color-border-strong)]"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={
              "px-3 py-1 font-mono text-[11px] tabular-nums uppercase tracking-[0.06em] transition-colors " +
              (active
                ? "bg-[color:var(--color-primary)] text-white"
                : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
