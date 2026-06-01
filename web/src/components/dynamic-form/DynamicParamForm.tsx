import type { ValidationProfile } from "../../types";
import { RangeField } from "./RangeField";
import { SteppedField } from "./SteppedField";
import { PulseWidthSelect } from "../PulseWidthSelect";

/** Canonical render order for base parameters. Fields absent from
 *  the profile — or marked `not_applicable` — are silently skipped. */
const FIELD_ORDER = [
  "power",
  "density",
  "frequency",
  "speed",
  "passes",
  "pulse_width",
  "laser",
] as const;

/** Human-readable labels and optional unit strings for each field. */
const FIELD_META: Record<string, { label: string; unit?: string }> = {
  power:       { label: "Power",       unit: "%"    },
  density:     { label: "Lines/cm"                  },
  frequency:   { label: "Frequency",   unit: "kHz"  },
  speed:       { label: "Speed",       unit: "mm/s" },
  passes:      { label: "Passes"                    },
  pulse_width: { label: "Pulse width", unit: "ns"   },
  laser:       { label: "Laser"                     },
};

/**
 * All param fields render full-width on their own row. The earlier
 * 2-col grid for frequency+speed saved a small amount of vertical
 * space at the cost of visual rhythm; user feedback was that it
 * wasn't worth the gap.
 */
const FULL_WIDTH_FIELDS = new Set([
  "power", "density", "frequency", "speed", "passes", "laser", "pulse_width",
]);

export interface DynamicParamFormProps {
  profile: ValidationProfile;
  value: Record<string, number | string>;
  onChange: (next: Record<string, number | string>) => void;
  disabled?: boolean;
  /** Per-field override captions. When a field is in this map, the
   *  field renders disabled and the caption appears below it as
   *  italic micro-text. Used by the test-detail editor to mark base
   *  params that are overridden by the X/Y sweep. */
  fieldOverrides?: Record<string, string>;
}

/**
 * Fully-controlled param form driven by a `ValidationProfile`.
 *
 * Iterates `FIELD_ORDER`, skips `not_applicable` fields entirely, and
 * renders the appropriate control based on the constraint kind:
 *
 *   range   → RangeField (slider + click-to-edit numeric badge)
 *   stepped → SteppedField (select for ≤16 values, discrete slider for more)
 *   enum    → LaserField (two-button toggle for laser, EnumField fallback)
 *
 * Layout: a 2-column grid for "recipe" fields (frequency, speed, passes),
 * with power, density, laser and pulse_width spanning full width.
 * `onChange` is called with the full value dict on every change.
 */
export function DynamicParamForm({
  profile,
  value,
  onChange,
  disabled,
  fieldOverrides,
}: DynamicParamFormProps) {
  function patch(field: string, next: number | string) {
    onChange({ ...value, [field]: next });
  }

  // Separate full-width and grid-column fields for layout.
  const rendered: { field: string; node: React.ReactNode; fullWidth: boolean }[] = [];

  for (const field of FIELD_ORDER) {
    const constraint = profile[field];
    if (!constraint || constraint.kind === "not_applicable") continue;

    const meta = FIELD_META[field] ?? { label: field };
    const current = value[field] ?? 0;
    const isFullWidth = FULL_WIDTH_FIELDS.has(field);
    const overrideCaption = fieldOverrides?.[field];
    const effectiveDisabled = disabled || !!overrideCaption;

    let node: React.ReactNode = null;

    if (constraint.kind === "range") {
      node = (
        <RangeField
          label={meta.label}
          unit={meta.unit}
          min={constraint.min}
          max={constraint.max}
          step={constraint.step}
          value={typeof current === "number" ? current : Number(current)}
          onChange={(v) => patch(field, v)}
          disabled={effectiveDisabled}
          prominent={field === "power"}
        />
      );
    } else if (constraint.kind === "stepped") {
      if (field === "pulse_width") {
        node = (
          <PulseWidthSelect
            value={typeof current === "number" ? current : Number(current)}
            onChange={(v) => patch(field, v)}
            disabled={effectiveDisabled}
          />
        );
      } else {
        node = (
          <SteppedField
            label={meta.label}
            unit={meta.unit}
            values={constraint.values}
            value={current}
            onChange={(v) => patch(field, v)}
            disabled={effectiveDisabled}
          />
        );
      }
    } else if (constraint.kind === "enum") {
      if (field === "laser") {
        node = (
          <LaserToggle
            value={String(current)}
            values={constraint.values as string[]}
            onChange={(v) => patch(field, v)}
            disabled={effectiveDisabled}
          />
        );
      } else {
        node = (
          <GenericEnumRow
            label={meta.label}
            values={constraint.values}
            value={current}
            onChange={(v) => patch(field, v)}
            disabled={effectiveDisabled}
          />
        );
      }
    }

    if (node) {
      // Wrap with caption if overridden.
      if (overrideCaption) {
        node = (
          <div>
            {node}
            <p className="mt-1 text-[10.5px] text-[color:var(--color-ink-subtle)] italic">
              {overrideCaption}
            </p>
          </div>
        );
      }
      rendered.push({ field, node, fullWidth: isFullWidth });
    }
  }

  if (rendered.length === 0) return null;

  // Split into sections for layout: full-width fields interspersed,
  // grid-eligible fields are batched into 2-column pairs.
  return (
    <div className="flex flex-col gap-3">
      {renderWithGrid(rendered, disabled)}
    </div>
  );
}

/** Render the field list, batching adjacent non-full-width fields into
 *  2-column grid rows, and full-width fields as solo rows. */
function renderWithGrid(
  fields: { field: string; node: React.ReactNode; fullWidth: boolean }[],
  _disabled?: boolean,
) {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < fields.length) {
    const current = fields[i];

    if (current.fullWidth) {
      result.push(
        <div key={current.field}>{current.node}</div>,
      );
      i++;
    } else {
      // Collect a run of non-full-width fields to place in the grid.
      const gridBatch: typeof fields = [];
      while (i < fields.length && !fields[i].fullWidth) {
        gridBatch.push(fields[i]);
        i++;
      }

      if (gridBatch.length === 1) {
        // Lone field — still render full-width for visual consistency.
        result.push(
          <div key={gridBatch[0].field}>{gridBatch[0].node}</div>,
        );
      } else {
        result.push(
          <div
            key={gridBatch.map((f) => f.field).join("-")}
            className="grid grid-cols-2 gap-x-4 gap-y-3"
          >
            {gridBatch.map((f) => (
              <div key={f.field}>{f.node}</div>
            ))}
          </div>,
        );
      }
    }
  }

  return result;
}

// ── Laser toggle — two pill buttons ─────────────────────────────────────────

const LASER_LABELS: Record<string, string> = {
  red:  "Red · MOPA",
  blue: "Blue · Diode",
  uv:   "UV · 355 nm",
};

function LaserToggle({
  value,
  values,
  onChange,
  disabled,
}: {
  value: string;
  values: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="font-mono font-semibold uppercase tracking-[0.1em]"
        style={{ fontSize: "9.5px", color: "var(--color-ink-subtle)" }}
      >
        Laser
      </span>
      <div
        className="flex gap-1 p-[3px] rounded-[7px]"
        style={{
          background: "var(--color-border)",
        }}
      >
        {values.map((v) => {
          const active = v === value;
          return (
            <button
              key={v}
              type="button"
              onClick={() => !disabled && onChange(v)}
              disabled={disabled}
              className="flex-1 rounded-[5px] font-mono font-semibold tracking-[0.06em] transition-all focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-default"
              style={{
                fontSize: "11px",
                height: "28px",
                background: active ? "var(--color-surface)" : "transparent",
                color: active ? "var(--color-primary)" : "var(--color-ink-muted)",
                boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                border: active ? "1px solid var(--color-border-strong)" : "1px solid transparent",
              }}
            >
              {LASER_LABELS[v] ?? v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Generic enum row (fallback for non-laser enum fields) ────────────────────

function GenericEnumRow({
  label,
  values,
  value,
  onChange,
  disabled,
}: {
  label: string;
  values: (number | string)[];
  value: number | string;
  onChange: (v: number | string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1" style={{ opacity: disabled ? 0.5 : 1 }}>
      <span
        className="font-mono font-semibold uppercase tracking-[0.1em]"
        style={{ fontSize: "9.5px", color: "var(--color-ink-subtle)" }}
      >
        {label}
      </span>
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (values.length > 0 && typeof values[0] === "number") {
            onChange(Number(raw));
          } else {
            onChange(raw);
          }
        }}
        className="w-full h-8 rounded-[5px] px-2 font-mono text-[12px] appearance-none cursor-pointer focus:outline-none border"
        style={{
          background: "var(--color-surface)",
          color: "var(--color-ink)",
          borderColor: "var(--color-border-strong)",
        }}
      >
        {values.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    </div>
  );
}
