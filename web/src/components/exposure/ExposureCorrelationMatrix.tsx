import * as React from "react";
import {
  CHANNEL_COLS,
  INDEX_ROWS,
  type ChannelCol,
  type IndexRow,
} from "./exposureCorrelations";

interface Props {
  matrix: readonly (readonly number[])[];
  selectedIndex: IndexRow;
  selectedChannel: ChannelCol;
  onSelect: (index: IndexRow, channel: ChannelCol) => void;
}

const ROW_LABELS: Record<IndexRow, string> = {
  pulse_spacing_mm: "PSp",
  line_spacing_index: "LSp",
  pulse_energy_index: "PEn",
  pulse_intensity_index: "PIn",
  surface_exposure_index: "SEx",
};

const COL_LABELS: Record<ChannelCol, string> = {
  L: "L*",
  a: "a*",
  b: "b*",
  hue: "hue",
  chroma: "chr",
};

function opacityFor(r: number): number {
  if (!Number.isFinite(r)) return 0;
  const v = Math.min(1, Math.max(0, Math.abs(r)));
  return Math.max(0, (v - 0.2) / 0.8);
}

export const ExposureCorrelationMatrix: React.FC<Props> = ({
  matrix,
  selectedIndex,
  selectedChannel,
  onSelect,
}) => {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.16em]">
      <div className="grid" style={{ gridTemplateColumns: "auto repeat(5, 1fr)", gap: "2px" }}>
        <div />
        {CHANNEL_COLS.map((c) => (
          <div
            key={c}
            data-role="col-label"
            className="text-center text-[color:var(--color-ink-subtle)]"
          >
            {COL_LABELS[c]}
          </div>
        ))}
        {INDEX_ROWS.map((idx, r) => (
          <React.Fragment key={idx}>
            <div
              data-role="row-label"
              className={
                idx === selectedIndex
                  ? "text-[color:var(--color-primary)] pr-2"
                  : "text-[color:var(--color-ink-subtle)] pr-2"
              }
            >
              {ROW_LABELS[idx]}
            </div>
            {CHANNEL_COLS.map((col, c) => {
              const value = matrix[r]?.[c] ?? NaN;
              const isSelected = idx === selectedIndex && col === selectedChannel;
              const showLabel = Number.isFinite(value) && Math.abs(value) >= 0.7;
              return (
                <button
                  key={col}
                  type="button"
                  data-role="matrix-cell"
                  className={
                    "relative h-5 cursor-pointer border " +
                    (isSelected
                      ? "border-[color:var(--color-primary)]"
                      : "border-[color:var(--color-border)]")
                  }
                  style={{
                    background: `color-mix(in oklch, var(--color-primary) ${
                      Math.round(opacityFor(value) * 100)
                    }%, transparent)`,
                  }}
                  onClick={() => onSelect(idx, col)}
                  title={
                    Number.isFinite(value)
                      ? `${ROW_LABELS[idx]} × ${COL_LABELS[col]} : r = ${value.toFixed(2)}`
                      : `${ROW_LABELS[idx]} × ${COL_LABELS[col]} : n/a`
                  }
                >
                  {showLabel && (
                    <span
                      data-role="cell-value"
                      className="absolute inset-0 flex items-center justify-center font-bold text-[color:var(--color-bg)]"
                    >
                      {Math.round(Math.abs(value) * 100)}
                    </span>
                  )}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
