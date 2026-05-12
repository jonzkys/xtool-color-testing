import * as React from "react";
import * as Slider from "@radix-ui/react-slider";
import type { SampleableKey } from "./proposeTestMath";

export interface ParamRangeRowProps {
  paramKey: SampleableKey;
  label: string;
  unit: string;
  machineMin: number;
  machineMax: number;
  step: number;
  /** Current user-set min (already clamped to machine range upstream). */
  rangeMin: number;
  /** Current user-set max (already clamped to machine range upstream). */
  rangeMax: number;
  vary: boolean;
  /** Anchor's value for this param — displayed when ``vary === false``. */
  pinnedValue: number;
  onRangeChange: (next: { min: number; max: number }) => void;
  onVaryChange: (next: boolean) => void;
}

/** Format a numeric param value for compact display.
 *
 *  Tuned to keep the right-aligned numeric column legible in the
 *  narrow rail — integers show as integers, fractional values clip to
 *  the first non-redundant decimal, and a trailing space + unit is
 *  appended only when ``unit`` is non-empty. */
function formatValue(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const u = unit ? ` ${unit}` : "";
  if (Math.abs(v) >= 1000) return `${Math.round(v)}${u}`;
  if (Math.abs(v) >= 100) return `${v.toFixed(0)}${u}`;
  if (Math.abs(v) >= 10) return `${v.toFixed(1)}${u}`;
  if (Number.isInteger(v)) return `${v}${u}`;
  return `${v.toFixed(2)}${u}`;
}

/** Single row in the unified PARAMS section. When ``vary`` is on the
 *  row stacks into two lines: a top line with the label on the left
 *  and the vary toggle pill on the right, and a bottom line with the
 *  min text input, the Radix two-thumb range slider (full width), and
 *  the max text input. When off it collapses to a single line: label
 *  + pinned value + vary toggle. The toggle pill is always visible so
 *  the user can re-expand the row.
 *
 *  Cross-clamping is handled here: typing a min greater than the
 *  current ``rangeMax`` snaps min up to that max and leaves max alone;
 *  typing a max smaller than the current ``rangeMin`` snaps max down
 *  to that min. The clamped value is what gets bubbled up via
 *  ``onRangeChange``. */
export const ParamRangeRow: React.FC<ParamRangeRowProps> = ({
  paramKey,
  label,
  unit,
  machineMin,
  machineMax,
  step,
  rangeMin,
  rangeMax,
  vary,
  pinnedValue,
  onRangeChange,
  onVaryChange,
}) => {
  // Local string state for the min/max text boxes — keeps the input
  // editable while the user is mid-typing without immediately echoing
  // a (clamped) numeric value back into the field.
  const [minStr, setMinStr] = React.useState<string>(String(rangeMin));
  const [maxStr, setMaxStr] = React.useState<string>(String(rangeMax));

  // Sync local input state when the row's props change (e.g. reset or
  // slider drag updates the canonical range).
  React.useEffect(() => { setMinStr(String(rangeMin)); }, [rangeMin]);
  React.useEffect(() => { setMaxStr(String(rangeMax)); }, [rangeMax]);

  const commitMin = (raw: string) => {
    setMinStr(raw);
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clampedToMachine = Math.max(machineMin, Math.min(machineMax, n));
    // If user typed min > current max, bump max up to match.
    const nextMin = clampedToMachine;
    const nextMax = Math.max(clampedToMachine, rangeMax);
    onRangeChange({ min: nextMin, max: nextMax });
  };

  const commitMax = (raw: string) => {
    setMaxStr(raw);
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clampedToMachine = Math.max(machineMin, Math.min(machineMax, n));
    // If user typed max < current min, snap max up to min (so we never
    // produce an inverted range; the alternative — dragging min down —
    // would silently lose the user's previous min, which is worse).
    const nextMax = Math.max(rangeMin, clampedToMachine);
    onRangeChange({ min: rangeMin, max: nextMax });
  };

  const varyToggle = (
    <button
      type="button"
      role="switch"
      aria-checked={vary}
      aria-label={`${paramKey} vary`}
      onClick={() => onVaryChange(!vary)}
      title={vary ? "Pin this param to the anchor value" : "Let this param vary across the test"}
      className={
        "flex-none h-[20px] px-1.5 rounded-sm border font-mono text-[8px] uppercase tracking-[0.12em] " +
        (vary
          ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
          : "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] bg-transparent")
      }
    >
      vary
    </button>
  );

  if (!vary) {
    return (
      <div
        className="flex items-center gap-2 min-w-0"
        data-row={paramKey}
      >
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[68px] flex-none truncate">
          {label}
        </div>
        <div className="flex-1 min-w-0 font-mono text-[10px] tabular-nums text-[color:var(--color-ink)] text-right truncate">
          {formatValue(pinnedValue, unit)}
        </div>
        {varyToggle}
      </div>
    );
  }

  // vary === true: stack into two lines so the slider gets the full row width.
  return (
    <div className="flex flex-col gap-0.5 min-w-0" data-row={paramKey}>
      {/* Top line: label left, vary pill right */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] flex-1 min-w-0 truncate">
          {label}
        </div>
        {varyToggle}
      </div>

      {/* Bottom line: min textbox | full-width slider | max textbox */}
      <div className="flex items-center gap-2 min-w-0">
        <input
          type="number"
          aria-label={`${paramKey} minimum`}
          value={minStr}
          min={machineMin}
          max={machineMax}
          step={step}
          onChange={(e) => commitMin(e.target.value)}
          className="w-[48px] flex-none font-mono text-[10px] tabular-nums px-1 h-[20px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
        />
        <Slider.Root
          value={[rangeMin, rangeMax]}
          min={machineMin}
          max={machineMax}
          step={step}
          minStepsBetweenThumbs={0}
          onValueChange={([lo, hi]: number[]) =>
            onRangeChange({ min: lo, max: hi })
          }
          aria-label={`${paramKey} range`}
          className="relative flex-1 min-w-0 h-5 select-none touch-none flex items-center"
        >
          <Slider.Track className="relative grow h-[3px] rounded-full bg-[color:var(--color-border)]">
            <Slider.Range className="absolute h-full bg-[color:var(--color-primary)] rounded-full" />
          </Slider.Track>
          <Slider.Thumb
            aria-label={`${paramKey} range minimum`}
            className="block w-3 h-3 rounded-full bg-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)] focus:ring-offset-1"
          />
          <Slider.Thumb
            aria-label={`${paramKey} range maximum`}
            className="block w-3 h-3 rounded-full bg-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)] focus:ring-offset-1"
          />
        </Slider.Root>
        <input
          type="number"
          aria-label={`${paramKey} maximum`}
          value={maxStr}
          min={machineMin}
          max={machineMax}
          step={step}
          onChange={(e) => commitMax(e.target.value)}
          className="w-[48px] flex-none font-mono text-[10px] tabular-nums px-1 h-[20px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
        />
      </div>
    </div>
  );
};
