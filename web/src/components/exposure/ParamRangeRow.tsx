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
  /** Anchor's value for this param — displayed when ``vary === false``
   *  unless the user has typed an explicit ``pinnedOverride``. */
  pinnedValue: number;
  /** User-set pinned value used when ``vary === false``. Undefined =
   *  fall back to ``pinnedValue`` (the anchor's value). */
  pinnedOverride?: number;
  onRangeChange: (next: { min: number; max: number }) => void;
  onVaryChange: (next: boolean) => void;
  /** Called when the user types a new pinned value. Pass ``undefined``
   *  when the field is cleared or set back to the anchor value so the
   *  override clears and the row falls back to the anchor. */
  onPinnedOverrideChange: (next: number | undefined) => void;
}

/** Compact numeric formatter for the in-field readout (no unit, since
 *  the value sits beside the slider and the unit lives on the label /
 *  beside the field). Integers show as integers, fractional values
 *  clip to the first non-redundant decimal. */
function formatBare(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Math.abs(v) >= 1000) return `${Math.round(v)}`;
  if (Math.abs(v) >= 100) return `${v.toFixed(0)}`;
  if (Math.abs(v) >= 10) return `${v.toFixed(1)}`;
  if (Number.isInteger(v)) return `${v}`;
  return `${v.toFixed(2)}`;
}

/** Click-to-edit numeric readout. Looks like a quiet monospaced label
 *  at rest — no border, no spinner arrows, transparent background —
 *  and reveals an editable affordance (hairline underline) on hover /
 *  focus. The underlying element is always an ``<input type="number">``
 *  so that existing tests (which fire ``change`` events against the
 *  aria-labeled element) continue to pass without a click step.
 *
 *  Commit semantics:
 *    - typing keeps the local string buffer mutable;
 *    - Enter / blur calls ``onCommit`` with the parsed number;
 *    - Escape reverts to the prop value;
 *    - the field auto-selects on focus so a single click + type
 *      replaces the old value cleanly. */
interface EditableValueProps {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** True when the value sits at a machine extreme (no user narrowing
   *  on this side) — used to mute the colour so the eye is drawn to
   *  the side the user has actually constrained. */
  atBound: boolean;
  align: "left" | "right";
  onCommit: (raw: string) => void;
}

const EditableValue: React.FC<EditableValueProps> = ({
  ariaLabel,
  value,
  min,
  max,
  step,
  atBound,
  align,
  onCommit,
}) => {
  const [buf, setBuf] = React.useState<string>(formatBare(value));
  const [focused, setFocused] = React.useState(false);

  // Sync from upstream when not actively editing — keeps slider drags
  // and resets visible without clobbering mid-typed text.
  React.useEffect(() => {
    if (!focused) setBuf(formatBare(value));
  }, [value, focused]);

  const colour = focused
    ? "text-[color:var(--color-primary)]"
    : atBound
      ? "text-[color:var(--color-ink-subtle)]"
      : "text-[color:var(--color-ink)]";

  const underline = focused
    ? "border-[color:var(--color-primary)]"
    : "border-transparent hover:border-[color:var(--color-ink-subtle)]";

  return (
    <input
      type="number"
      aria-label={ariaLabel}
      value={buf}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setBuf(e.target.value);
        // Fire commit immediately so the parent state (and tests) see
        // every keystroke — matches the previous component's contract.
        onCommit(e.target.value);
      }}
      onFocus={(e) => {
        setFocused(true);
        // Defer select so the caret-on-click case still works.
        const el = e.currentTarget;
        requestAnimationFrame(() => {
          try { el.select(); } catch { /* noop */ }
        });
      }}
      onBlur={() => {
        setFocused(false);
        // Snap the buffer back to the canonical formatted value so the
        // user sees the clamped result rather than their raw input.
        setBuf(formatBare(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setBuf(formatBare(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      className={
        "w-[44px] flex-none font-mono text-[10px] tabular-nums leading-none " +
        "bg-transparent border-0 border-b border-dotted " +
        "px-0 py-0.5 cursor-text focus:outline-none " +
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none " +
        `${align === "right" ? "text-right" : "text-left"} ` +
        `${colour} ${underline} transition-colors`
      }
    />
  );
};

/** Single row in the unified PARAMS section. When ``vary`` is on the
 *  row stacks into two lines: a top line with the label on the left
 *  and the vary toggle pill on the right, and a bottom line with the
 *  min readout, the Radix two-thumb range slider (full width), and
 *  the max readout. When off it collapses to a single line: label
 *  + pinned value + vary toggle. The toggle pill is always visible so
 *  the user can re-expand the row.
 *
 *  The min / max readouts are click-to-edit ``EditableValue`` fields
 *  — they look like quiet monospaced labels at rest and reveal an
 *  editable underline on hover / focus, so the slider remains the
 *  dominant interaction.
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
  pinnedOverride,
  onRangeChange,
  onVaryChange,
  onPinnedOverrideChange,
}) => {
  const commitMin = (raw: string) => {
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clampedToMachine = Math.max(machineMin, Math.min(machineMax, n));
    // If user typed min > current max, bump max up to match.
    const nextMin = clampedToMachine;
    const nextMax = Math.max(clampedToMachine, rangeMax);
    onRangeChange({ min: nextMin, max: nextMax });
  };

  const commitPinned = (raw: string) => {
    if (raw === "") {
      onPinnedOverrideChange(undefined);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(machineMin, Math.min(machineMax, n));
    // If the typed value lands back on the anchor, clear the override so
    // the row reads as "no override" (muted colour, falls back to anchor).
    if (clamped === pinnedValue) {
      onPinnedOverrideChange(undefined);
      return;
    }
    onPinnedOverrideChange(clamped);
  };

  const commitMax = (raw: string) => {
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
    const effectivePinned = pinnedOverride ?? pinnedValue;
    // ``atBound`` here reuses the EditableValue colour convention: when
    // the value equals the anchor (no override), render muted; when the
    // user has set an override, render active.
    const noOverride = pinnedOverride === undefined;
    return (
      <div
        className="flex items-center gap-2 min-w-0"
        data-row={paramKey}
      >
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[68px] flex-none truncate">
          {label}
        </div>
        <div className="flex-1 min-w-0 flex items-center justify-end gap-1">
          <EditableValue
            key="pinned"
            ariaLabel={`${paramKey} value`}
            value={effectivePinned}
            min={machineMin}
            max={machineMax}
            step={step}
            atBound={noOverride}
            align="right"
            onCommit={commitPinned}
          />
          {unit ? (
            <span
              className={
                "font-mono text-[10px] tabular-nums leading-none flex-none " +
                (noOverride
                  ? "text-[color:var(--color-ink-subtle)]"
                  : "text-[color:var(--color-ink)]")
              }
            >
              {unit}
            </span>
          ) : null}
        </div>
        {varyToggle}
      </div>
    );
  }

  // Strict equality is intentional: a value that's been dragged off the
  // bound and then back onto it should read as "at bound" again.
  const minAtBound = rangeMin <= machineMin;
  const maxAtBound = rangeMax >= machineMax;

  // vary === true: stack into two lines so the slider gets the full row width.
  return (
    <div className="flex flex-col gap-0.5 min-w-0" data-row={paramKey}>
      {/* Top line: label left, vary pill right */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] flex-1 min-w-0 truncate">
          {label}
          {unit ? (
            <span className="ml-1 text-[color:var(--color-ink-subtle)] normal-case tracking-normal">
              {unit}
            </span>
          ) : null}
        </div>
        {varyToggle}
      </div>

      {/* Bottom line: min readout | full-width slider | max readout */}
      <div className="flex items-center gap-2 min-w-0">
        <EditableValue
          key="min"
          ariaLabel={`${paramKey} minimum`}
          value={rangeMin}
          min={machineMin}
          max={machineMax}
          step={step}
          atBound={minAtBound}
          align="left"
          onCommit={commitMin}
        />
        <Slider.Root
          value={[rangeMin, rangeMax]}
          min={machineMin}
          max={machineMax}
          step={step}
          minStepsBetweenThumbs={1}
          onValueChange={([lo, hi]: number[]) =>
            onRangeChange({ min: lo, max: hi })
          }
          aria-label={`${paramKey} range`}
          className="relative flex-1 min-w-0 h-5 select-none touch-none flex items-center"
        >
          <Slider.Track className="relative grow h-[3px] rounded-full bg-[color:var(--color-border)]">
            <Slider.Range className="absolute h-full bg-[color:var(--color-primary)] rounded-full" />
          </Slider.Track>
          {/* Radix v1 wraps each Slider.Thumb in its own absolute-positioned
              <span> with no z-index, so when the two thumbs collide (e.g.
              the user drags the max thumb left onto the min) the wrapper
              rendered later wins hit-testing — and that's always the max.
              The user clicks "on the min" but actually grabs the max,
              which can't go below the min, so it looks frozen, and the
              min appears un-draggable.
              We can't put a z-index on the wrapper from JSX (Radix renders
              it), so we promote it via a ref that bumps the parent's
              z-index up. Min wins by default; whichever thumb is focused
              wins outright so the user can always reach the one they're
              targeting. */}
          <Slider.Thumb
            ref={(el) => {
              const wrap = el?.parentElement;
              if (wrap) {
                wrap.style.zIndex = "2";
                // Focus-bump so the focused thumb is always on top.
                el.onfocus = () => { wrap.style.zIndex = "3"; };
                el.onblur = () => { wrap.style.zIndex = "2"; };
              }
            }}
            aria-label={`${paramKey} range minimum`}
            className="block w-3 h-3 rounded-full bg-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)] focus:ring-offset-1"
          />
          <Slider.Thumb
            ref={(el) => {
              const wrap = el?.parentElement;
              if (wrap) {
                wrap.style.zIndex = "1";
                el.onfocus = () => { wrap.style.zIndex = "3"; };
                el.onblur = () => { wrap.style.zIndex = "1"; };
              }
            }}
            aria-label={`${paramKey} range maximum`}
            className="block w-3 h-3 rounded-full bg-[color:var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)] focus:ring-offset-1"
          />
        </Slider.Root>
        <EditableValue
          key="max"
          ariaLabel={`${paramKey} maximum`}
          value={rangeMax}
          min={machineMin}
          max={machineMax}
          step={step}
          atBound={maxAtBound}
          align="right"
          onCommit={commitMax}
        />
      </div>
    </div>
  );
};
