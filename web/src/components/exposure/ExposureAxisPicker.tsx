import { useEffect } from "react";
import {
  CHANNEL_COLS, INDEX_ROWS,
  type ChannelCol, type IndexRow,
} from "./exposureCorrelations";
import type { ScaleKind, ScatterMode } from "./ExposureScatter";

interface Props {
  axis: "x" | "y";
  mode: ScatterMode;
  currentKey: IndexRow | ChannelCol;
  scale: ScaleKind;
  onKeyChange: (k: IndexRow | ChannelCol) => void;
  onScaleChange: (s: ScaleKind) => void;
  onClose: () => void;
  /** Optional: called while the cursor hovers a non-active option, so
   *  the chart can preview the axis without the user committing.
   *  Called with `null` when the cursor leaves the option list. */
  onKeyPreview?: (k: IndexRow | ChannelCol | null) => void;
}

const INDEX_LABELS: Record<IndexRow, string> = {
  pulse_spacing_mm: "Pulse Spacing (mm)",
  line_spacing_mm: "Line Spacing (mm)",
  pulse_energy_index: "Pulse Energy Index",
  pulse_intensity_index: "Pulse Intensity Index",
  total_exposure_index: "Total Exposure",
  ablation_aggression_index: "Ablation Aggression",
  delivery_smoothness_index: "Delivery Smoothness",
};

const CHANNEL_LABELS: Record<ChannelCol, string> = {
  L: "L*",
  a: "a*",
  b: "b*",
  hue: "Hue°",
  chroma: "Chroma",
};

export function ExposureAxisPicker({
  axis, mode, currentKey, scale,
  onKeyChange, onScaleChange, onClose, onKeyPreview,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Y axis in univariate mode shows channels; everywhere else shows indices.
  const showsChannels = axis === "y" && mode === "univariate";
  const options: { key: string; label: string }[] = showsChannels
    ? CHANNEL_COLS.map((k) => ({ key: k, label: CHANNEL_LABELS[k] }))
    : INDEX_ROWS.map((k) => ({ key: k, label: INDEX_LABELS[k] }));

  return (
    <div
      role="dialog"
      className="font-mono px-2 py-2 flex flex-col gap-1"
      style={{ width: 220 }}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[color:var(--color-ink-subtle)] mb-1">
        {axis.toUpperCase()} AXIS
      </div>
      <div
        className="flex flex-col gap-0.5"
        onMouseLeave={() => onKeyPreview?.(null)}
      >
        {options.map((opt) => {
          const active = opt.key === currentKey;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                onKeyPreview?.(null);  // commit; clear any preview override
                onKeyChange(opt.key as IndexRow | ChannelCol);
              }}
              onMouseEnter={() => {
                // Don't preview the active option — it would no-op the
                // override. Preview only foreign options.
                if (!active) onKeyPreview?.(opt.key as IndexRow | ChannelCol);
              }}
              className={
                "text-left px-2 py-1 text-[10.5px] rounded-sm transition-colors " +
                (active
                  ? "bg-[color:var(--color-surface-elevated)] text-[color:var(--color-primary)] font-semibold border-l-2 border-[color:var(--color-primary)]"
                  : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]")
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {!showsChannels && (
        <label className="flex items-center gap-2 mt-1 px-2 py-1 text-[10.5px] border-t border-[color:var(--color-border)] pt-2">
          <input
            type="checkbox"
            checked={scale === "log"}
            onChange={(e) => onScaleChange(e.target.checked ? "log" : "linear")}
            aria-label="log scale"
          />
          log scale
        </label>
      )}
    </div>
  );
}
