import type { ValidationProfile } from "../../types";
import { RangeField } from "./RangeField";
import { SteppedField } from "./SteppedField";
import { EnumField } from "./EnumField";
import { PulseWidthSelect } from "../PulseWidthSelect";
import { Field, Select } from "../../ui";

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
const FIELD_META: Record<
  string,
  { label: string; unit?: string }
> = {
  power:       { label: "Power",     unit: "%"    },
  density:     { label: "Lines/cm"               },
  frequency:   { label: "Frequency", unit: "Hz"  },
  speed:       { label: "Speed",     unit: "mm/s" },
  passes:      { label: "Passes"                 },
  pulse_width: { label: "Pulse width (ns)"       },
  laser:       { label: "Laser"                  },
};

export interface DynamicParamFormProps {
  profile: ValidationProfile;
  value: Record<string, number | string>;
  onChange: (next: Record<string, number | string>) => void;
  disabled?: boolean;
}

/**
 * Fully-controlled param form driven by a `ValidationProfile`.
 *
 * Iterates `FIELD_ORDER`, skips `not_applicable` fields entirely, and
 * renders the appropriate control based on the constraint kind:
 *
 *   range   → RangeField (slider + numeric input)
 *   stepped → SteppedField (select for ≤16 values, discrete slider for more)
 *   enum    → EnumField (select) / PulseWidthSelect for pulse_width
 *
 * `onChange` is called with the full value dict on every change —
 * unchanged fields are preserved.
 */
export function DynamicParamForm({
  profile,
  value,
  onChange,
  disabled,
}: DynamicParamFormProps) {
  function patch(field: string, next: number | string) {
    onChange({ ...value, [field]: next });
  }

  return (
    <div className="flex flex-col gap-3">
      {FIELD_ORDER.map((field) => {
        const constraint = profile[field];
        // Profile doesn't mention this field, or explicitly not applicable.
        if (!constraint || constraint.kind === "not_applicable") return null;

        const meta = FIELD_META[field] ?? { label: field };
        const current = value[field] ?? 0;

        if (constraint.kind === "range") {
          return (
            <RangeField
              key={field}
              label={meta.label}
              unit={meta.unit}
              min={constraint.min}
              max={constraint.max}
              step={constraint.step}
              value={typeof current === "number" ? current : Number(current)}
              onChange={(v) => patch(field, v)}
              disabled={disabled}
            />
          );
        }

        if (constraint.kind === "stepped") {
          // pulse_width gets the dedicated PulseWidthSelect which handles
          // the legacy snap-and-warn behaviour.
          if (field === "pulse_width") {
            return (
              <PulseWidthSelect
                key={field}
                value={typeof current === "number" ? current : Number(current)}
                onChange={(v) => patch(field, v)}
                disabled={disabled}
              />
            );
          }

          return (
            <SteppedField
              key={field}
              label={meta.label}
              unit={meta.unit}
              values={constraint.values}
              value={current}
              onChange={(v) => patch(field, v)}
              disabled={disabled}
            />
          );
        }

        if (constraint.kind === "enum") {
          // Laser field gets a styled option set with human-readable names.
          if (field === "laser") {
            return (
              <LaserField
                key={field}
                value={String(current)}
                values={constraint.values as string[]}
                onChange={(v) => patch(field, v)}
                disabled={disabled}
              />
            );
          }

          return (
            <EnumField
              key={field}
              label={meta.label}
              values={constraint.values}
              value={current}
              onChange={(v) => patch(field, v)}
              disabled={disabled}
            />
          );
        }

        return null;
      })}
    </div>
  );
}

/** Laser selector — maps "red"/"blue" wire values to readable labels. */
function LaserField({
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
  const LASER_LABELS: Record<string, string> = {
    red:  "Red (MOPA)",
    blue: "Blue (diode)",
  };

  return (
    <Field label="Laser">
      <Select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {values.map((v) => (
          <option key={v} value={v}>
            {LASER_LABELS[v] ?? v}
          </option>
        ))}
      </Select>
    </Field>
  );
}
