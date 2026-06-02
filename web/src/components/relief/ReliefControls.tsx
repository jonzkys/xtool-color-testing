/**
 * Relief — smoothing controls.
 *
 * The driving panel for the depth-map smoother: smoothing strength, edge
 * preservation, speckle removal, and the (preview-only) layer targets.
 * Every control patches the shared ``ReliefParams`` immutably through
 * ``onChange`` — the page owns the debounce, so we fire on every tick and
 * let the parent coalesce the re-smooth.
 *
 * Visual language mirrors the rest of the workbench: a single ``Card`` of
 * dense ``Section``s, JetBrains-mono numerics, metallic dividers, and the
 * native range input tinted with ``--color-primary`` (same pattern the
 * Pixel-Art "Cells across" slider uses).
 */

import type { ReactNode } from "react";
import { Card, Field, NumberField, Section } from "../../ui";
import type { ReliefParams } from "../../pages/reliefHelpers";

export interface ReliefControlsProps {
  params: ReliefParams;
  onChange: (p: ReliefParams) => void;
}

export function ReliefControls({ params, onChange }: ReliefControlsProps) {
  // Immutable single-field patch.
  const set = <K extends keyof ReliefParams>(key: K, value: ReliefParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <Card padded={false} className="flex flex-col gap-4 p-4">
      {/* ── Smoothing ──────────────────────────────────────────────── */}
      <Section
        title="Smoothing"
        dense
        titleHint="Bilateral spatial radius — higher = softer, more aggressive."
      >
        <Toggle
          label="Enable smoothing"
          checked={params.smoothEnabled}
          onChange={(v) => set("smoothEnabled", v)}
        />
        {params.smoothEnabled ? (
          <Slider
            label="Strength"
            value={params.strength}
            min={1}
            max={30}
            onChange={(v) => set("strength", v)}
            hint="Radius of the bilateral / median pass."
          />
        ) : (
          <p className="text-[12px] leading-relaxed text-[color:var(--color-ink-subtle)]">
            Smoothing off — driving the raw heightfield (use the histogram /
            stretch tools).
          </p>
        )}
      </Section>

      {params.smoothEnabled && (
        <>
          {/* ── Edges ────────────────────────────────────────────────── */}
          <Section title="Edges" dense>
            <Toggle
              label="Preserve edges"
              checked={params.edgePreserve}
              onChange={(v) => set("edgePreserve", v)}
            />
            {params.edgePreserve && (
              <Slider
                label="Edge threshold"
                value={params.edgeThreshold}
                min={1}
                max={255}
                onChange={(v) => set("edgeThreshold", v)}
                hint="Preserve drops steeper than this — keeps real edges crisp."
              />
            )}
          </Section>

          {/* ── Speckle ──────────────────────────────────────────────── */}
          <Section title="Speckle" dense>
            <Toggle
              label="Remove speckle"
              checked={params.spikeRemoval}
              onChange={(v) => set("spikeRemoval", v)}
            />
            {params.spikeRemoval && (
              <Field
                label="Median window"
                hint="Kernel size for the despeckling median pass."
              >
                <SegmentedChoice
                  value={params.medianKsize}
                  options={[
                    { value: 3, label: "3 × 3" },
                    { value: 5, label: "5 × 5" },
                  ]}
                  onChange={(v) => set("medianKsize", v)}
                />
              </Field>
            )}
          </Section>
        </>
      )}

      {/* ── Layers (preview / pass-through) ────────────────────────── */}
      <Section
        title="Layers"
        dense
        titleHint="Preview & export hints — they do not change the smoothing yet."
      >
        <Slider
          label="Target layers"
          value={params.targetLayers}
          min={2}
          max={256}
          onChange={(v) => set("targetLayers", v)}
          hint="Preview only — Z is not quantised here yet."
        />
        <NumberField
          label="Z descent / layers (mm)"
          value={params.zDescentPerLayers}
          min={0}
          step={0.01}
          onChange={(v) => set("zDescentPerLayers", Math.max(0, v))}
          hint="Pass-through for a future export — no effect on the smooth."
        />
      </Section>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

/** Native range slider with a live mono value in the label — matches the
 *  Pixel-Art slider pattern. */
function Slider({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
}) {
  return (
    <Field
      label={
        <span className="flex w-full items-baseline justify-between gap-3">
          <span>{label}</span>
          <span className="font-mono tabular-nums text-[12px] text-[color:var(--color-ink)]">
            {value}
          </span>
        </span>
      }
      hint={hint}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-[color:var(--color-primary)]"
        aria-label={label}
      />
    </Field>
  );
}

/** Checkbox toggle row — mirrors the ForgeControls inline-label pattern. */
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

/** Two-state segmented control for the median kernel choice. */
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
