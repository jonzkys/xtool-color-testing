import { type ReactNode } from "react";
import {
  cn,
  Field,
  NumberField,
  Select,
} from "../ui";
import { PulseWidthSelect } from "./PulseWidthSelect";
import type { TextRegParamsBody, TextRegSource } from "../types";

/**
 * Form rhythm shared by every place we edit the seven-field
 * "engraved annotation params" — the Library page's per-machine cards
 * and the Tests page's Registration tab. Two-column grid with mono
 * NumberFields, the same PulseWidthSelect the rest of the workbench
 * uses, and a final laser-source select.
 */

export interface TextRegParamsEditorProps {
  value: TextRegParamsBody;
  onChange: (next: TextRegParamsBody) => void;
  disabled?: boolean;
}

export function TextRegParamsEditor({
  value,
  onChange,
  disabled,
}: TextRegParamsEditorProps) {
  function patch(p: Partial<TextRegParamsBody>) {
    onChange({ ...value, ...p });
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField
        label="Power %"
        value={value.power}
        min={0}
        max={100}
        disabled={disabled}
        onChange={(v) => patch({ power: v })}
      />
      <NumberField
        label="Speed"
        value={value.speed}
        integer
        min={1}
        disabled={disabled}
        onChange={(v) => patch({ speed: v })}
      />
      <NumberField
        label="Frequency (kHz)"
        value={value.mopa_frequency}
        integer
        min={1}
        disabled={disabled}
        onChange={(v) => patch({ mopa_frequency: v })}
      />
      <NumberField
        label="Lines/cm"
        value={value.density}
        integer
        min={1}
        disabled={disabled}
        onChange={(v) => patch({ density: v })}
      />
      <NumberField
        label="Passes"
        value={value.repeat}
        integer
        min={1}
        max={99}
        disabled={disabled}
        onChange={(v) => patch({ repeat: v })}
      />
      <PulseWidthSelect
        label="Pulse width"
        value={value.pulse_width}
        disabled={disabled}
        onChange={(v) => patch({ pulse_width: v })}
      />
      <div className="col-span-2">
        <Field label="Laser source">
          <Select
            value={value.processing_light_source}
            disabled={disabled}
            onChange={(e) => patch({ processing_light_source: e.target.value })}
          >
            <option value="red">Red (MOPA)</option>
            <option value="blue">Blue (diode)</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}

// ── Source pill ──────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<TextRegSource, string> = {
  material: "From material default",
  machine: "From machine default",
  fallback: "Built-in fallback",
};

/** Small uppercase mono pill describing which layer the resolved
 *  params came from. Primary tint when the override is at the most
 *  specific level (material), softer for machine, muted for fallback. */
export function TextRegSourcePill({
  source,
  className,
  override,
}: {
  source: TextRegSource;
  className?: string;
  /** Optional label override (e.g. "Material default" on the Library
   *  cards where the surrounding context already says material/machine). */
  override?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-[18px] px-2 rounded-[4px]",
        "border font-mono text-[9.5px] tracking-[0.14em] uppercase font-semibold",
        source === "material"
          ? "border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/60 text-[color:var(--color-primary)]"
          : source === "machine"
            ? "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] text-[color:var(--color-ink-muted)]"
            : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink-subtle)]",
        className,
      )}
    >
      {override ?? SOURCE_LABELS[source]}
    </span>
  );
}
