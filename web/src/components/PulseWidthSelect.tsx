import { ALLOWED_PULSE_WIDTHS, snapPulseWidth } from "../laser/pulseWidths";

/**
 * Dropdown constrained to the F2 Ultra MOPA preset list.
 *
 * Styled to match the instrument-panel aesthetic used in DynamicParamForm:
 * mono label above a styled native select with the current value shown
 * prominently. Legacy values (outside the preset list) show an amber
 * "(legacy)" annotation and the effective snapped value.
 */
export function PulseWidthSelect({
  label = "Pulse width",
  value,
  onChange,
  disabled,
  className,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  help?: string;           // accepted but not rendered (API compat)
  disabled?: boolean;
  className?: string;
}) {
  const isAllowed = ALLOWED_PULSE_WIDTHS.includes(value as (typeof ALLOWED_PULSE_WIDTHS)[number]);
  const effective = isAllowed ? value : snapPulseWidth(value);

  return (
    <div
      className={`flex flex-col gap-1${className ? ` ${className}` : ""}`}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      {/* Label + current value display */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="font-mono font-semibold uppercase tracking-[0.1em] shrink-0"
          style={{ fontSize: "9.5px", color: "var(--color-ink-subtle)" }}
        >
          {label}
        </span>
        <div className="flex items-baseline gap-1">
          <span
            className="font-mono tabular-nums font-semibold"
            style={{
              fontSize: "12px",
              color: isAllowed ? "var(--color-ink)" : "var(--color-primary)",
            }}
          >
            {isAllowed ? value : effective}
          </span>
          <span
            className="font-mono uppercase tracking-[0.06em]"
            style={{ fontSize: "9px", color: "var(--color-ink-subtle)" }}
          >
            ns
          </span>
          {!isAllowed && (
            <span
              className="font-mono uppercase tracking-[0.06em]"
              style={{ fontSize: "8.5px", color: "var(--color-primary)" }}
            >
              legacy
            </span>
          )}
        </div>
      </div>

      {/* Native select */}
      <select
        value={String(effective)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-8 rounded-[5px] px-2 font-mono text-[12px] appearance-none cursor-pointer focus:outline-none border"
        style={{
          background: isAllowed ? "var(--color-surface)" : "var(--color-primary-tint)",
          color: "var(--color-ink)",
          borderColor: isAllowed ? "var(--color-border-strong)" : "var(--color-primary)",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23807A72' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
          paddingRight: "24px",
        }}
      >
        {!isAllowed && (
          <option value={String(value)} disabled>
            {value} ns · not a preset
          </option>
        )}
        {ALLOWED_PULSE_WIDTHS.map((w) => (
          <option key={w} value={w}>
            {w} ns
          </option>
        ))}
      </select>

      {!isAllowed && (
        <p
          className="font-mono tracking-[0.06em]"
          style={{ fontSize: "9.5px", color: "var(--color-primary)" }}
        >
          stored as {value} ns — select a preset to snap
        </p>
      )}
    </div>
  );
}
