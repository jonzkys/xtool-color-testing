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
  onPickColor: () => void;
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

export function StretchControls({ params, onChange, onPickColor }: StretchControlsProps) {
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

      {/* ── Trim ───────────────────────────────────────────────────── */}
      <Section
        title="Trim"
        dense
        titleHint="Drop the unused bottom of the range, and cut out the background."
      >
        <Toggle
          label="Remove empty layers"
          checked={params.removeEmptyLayers}
          onChange={(v) => set("removeEmptyLayers", v)}
        />
        <p className="text-[11px] leading-relaxed text-[color:var(--color-ink-subtle)]">
          Offsets the lowest value to 0 — drops layers the machine would
          otherwise cut as air. Most visible with Mode = None.
        </p>

        <Toggle
          label="Remove background"
          checked={params.removeBackground}
          onChange={(v) => set("removeBackground", v)}
        />
        <p className="text-[11px] leading-relaxed text-[color:var(--color-ink-subtle)]">
          Make the surrounding background transparent — it won't be engraved,
          and it's excluded from the stretch.
        </p>
        {params.removeBackground && (
          <>
            <Field label="Method">
              <Select
                aria-label="Background removal method"
                value={params.bgMode}
                onChange={(e) => set("bgMode", e.target.value as "dark" | "bright" | "colour")}
              >
                <option value="dark">Dark threshold</option>
                <option value="bright">Bright threshold</option>
                <option value="colour">Pick colour</option>
              </Select>
            </Field>

            {params.bgMode !== "colour" ? (
              <Slider
                label="Threshold"
                value={params.bgThreshold}
                min={0}
                max={255}
                step={1}
                onChange={(v) => set("bgThreshold", v)}
                hint="Pixels at or below this value become transparent."
              />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onPickColor}
                    className="rounded-[5px] border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-primary)]/50"
                  >
                    Pick from image
                  </button>
                  <span
                    className="inline-block h-5 w-5 rounded-[4px] border border-[var(--color-border)]"
                    style={{ background: params.bgColor ? `rgb(${params.bgColor.join(",")})` : "transparent" }}
                    aria-hidden
                  />
                  <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                    {params.bgColor ? params.bgColor.join(", ") : "no colour picked"}
                  </span>
                </div>
                <Slider
                  label="Tolerance"
                  value={params.bgTolerance}
                  min={0}
                  max={200}
                  step={1}
                  onChange={(v) => set("bgTolerance", v)}
                />
              </>
            )}

            <Toggle
              label="Smooth edge"
              checked={params.perimeterEnabled}
              onChange={(v) => set("perimeterEnabled", v)}
            />
            {params.perimeterEnabled && (
              <Slider
                label="Smooth %"
                value={params.perimeterPct}
                min={0}
                max={15}
                step={0.5}
                onChange={(v) => set("perimeterPct", v)}
                hint="Round the jagged silhouette outline — smooths the engraved wall and any tapered rim."
              />
            )}

            <Toggle
              label="Trim outline"
              checked={params.trimEnabled}
              onChange={(v) => set("trimEnabled", v)}
            />
            {params.trimEnabled && (
              <Slider
                label="Trim %"
                value={params.trimPct}
                min={0}
                max={25}
                step={0.5}
                onChange={(v) => set("trimPct", v)}
              />
            )}

            <Toggle
              label="Edge falloff"
              checked={params.falloffEnabled}
              onChange={(v) => set("falloffEnabled", v)}
            />
            {params.falloffEnabled && (
              <>
                <Field label="Falloff mode">
                  <Select
                    aria-label="Edge falloff mode"
                    value={params.falloffMode}
                    onChange={(e) => set("falloffMode", e.target.value as "inward" | "outward")}
                  >
                    <option value="inward">Inward — bevel the object edge</option>
                    <option value="outward">Outward — raised border (berm)</option>
                  </Select>
                </Field>
                <Slider
                  label="Taper to %"
                  value={params.falloffTarget}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => set("falloffTarget", v)}
                  hint="Level the edge ramps to — 0 = floor, 100 = peak."
                />
                <Slider
                  label="Offset %"
                  value={params.falloffPct}
                  min={0}
                  max={50}
                  step={0.5}
                  onChange={(v) => set("falloffPct", v)}
                />
                <Slider
                  label="Intensity"
                  value={params.falloffIntensity}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => set("falloffIntensity", v)}
                />
              </>
            )}
          </>
        )}
      </Section>
    </Card>
  );
}

/** Checkbox toggle row — mirrors ReliefControls's Toggle. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-muted)] select-none cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[color:var(--color-primary)]"
      />
      <span>{label}</span>
    </label>
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
