import { cn, Field, Select } from "../ui";
import { ALLOWED_PULSE_WIDTHS, snapPulseWidth } from "../laser/pulseWidths";

/**
 * Dropdown constrained to the F2 Ultra MOPA preset list.
 *
 * ``value`` may temporarily land on a value outside the preset list
 * (legacy preset data, out-of-range paste) — we snap the displayed
 * selection to the nearest allowed value but don't auto-save until
 * the user commits. The ``help`` prop tucks a small hint under the
 * mono-caps label, mirroring ``NumberField`` so it slots cleanly into
 * existing forms.
 */
export function PulseWidthSelect({
  label = "Pulse width (ns)",
  value,
  onChange,
  help,
  disabled,
  className,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  help?: string;
  disabled?: boolean;
  className?: string;
}) {
  const isAllowed = ALLOWED_PULSE_WIDTHS.includes(value as (typeof ALLOWED_PULSE_WIDTHS)[number]);
  const effective = isAllowed ? value : snapPulseWidth(value);
  return (
    <Field label={label} help={help} className={className}>
      <Select
        value={String(effective)}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        invalid={!isAllowed}
      >
        {!isAllowed && (
          <option value={String(value)} disabled>
            {value} · not a preset
          </option>
        )}
        {ALLOWED_PULSE_WIDTHS.map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </Select>
      {!isAllowed && (
        <p
          className={cn(
            "mt-1 font-mono text-[10px] tracking-[0.08em]",
            "text-[color:var(--color-warning-ink, var(--color-primary))]",
          )}
        >
          stored as {value} — press a preset to snap
        </p>
      )}
    </Field>
  );
}
