import * as React from "react";
import {
  CHANNEL_COLS,
  type ChannelCol,
} from "./exposureCorrelations";

interface Props<RowKey extends string> {
  matrix: readonly (readonly number[])[];
  rowKeys: readonly RowKey[];
  rowLabels: Record<RowKey, string>;
  selectedRowKey: RowKey | null;
  selectedChannel: ChannelCol | null;
  onSelect: ((rowKey: RowKey, channel: ChannelCol) => void) | null;
  /** Optional override for how a row's label is rendered. Defaults
   *  to a plain styled <div>. Receives the rowKey and the resolved
   *  label string from rowLabels. */
  renderRowLabel?: (rowKey: RowKey, label: string) => React.ReactNode;
}

const COL_LABELS: Record<ChannelCol, string> = {
  L: "L*",
  a: "a*",
  b: "b*",
  hue: "h°",
  chroma: "C*",
};

/** Map |r| → ink-tint percentage. Pivot at |r|=0.2 so noise reads
 *  near-blank. Clamp the upper end at 88% so the darkest cell still
 *  has enough contrast to show a white numeric on top. */
function inkPctFor(r: number): number {
  if (!Number.isFinite(r)) return 0;
  const v = Math.min(1, Math.max(0, Math.abs(r)));
  if (v < 0.2) return 0;
  return Math.round(((v - 0.2) / 0.8) * 88);
}

/** A small rotated "+/−" sign in the corner — sign carries information
 *  too (negative correlation = anti-aligned). */
function SignBadge({ r }: { r: number }) {
  if (!Number.isFinite(r)) return null;
  const sign = r < 0 ? "−" : "+";
  return (
    <span
      aria-hidden="true"
      className="absolute top-0 left-0.5 font-mono text-[8px] leading-none text-[color:var(--color-bg)] opacity-70"
    >
      {sign}
    </span>
  );
}

export function ExposureCorrelationMatrix<RowKey extends string>({
  matrix,
  rowKeys,
  rowLabels,
  selectedRowKey,
  selectedChannel,
  onSelect,
  renderRowLabel,
}: Props<RowKey>) {
  return (
    <div className="font-mono">
      <div
        className="grid"
        style={{
          gridTemplateColumns: "auto repeat(5, minmax(28px, 1fr))",
          gap: "2px",
        }}
      >
        {/* corner spacer */}
        <div />
        {CHANNEL_COLS.map((c) => (
          <div
            key={c}
            data-role="col-label"
            className={[
              "text-center text-[10px] uppercase tracking-[0.16em] pb-1",
              c === selectedChannel
                ? "text-[color:var(--color-primary)] font-semibold"
                : "text-[color:var(--color-ink-subtle)]",
            ].join(" ")}
          >
            {COL_LABELS[c]}
          </div>
        ))}
        {rowKeys.map((idx, r) => (
          <React.Fragment key={idx}>
            <div
              data-role="row-label"
              className={[
                "text-[10px] uppercase tracking-[0.16em] pr-2 self-center text-right",
                idx === selectedRowKey
                  ? "text-[color:var(--color-primary)] font-semibold"
                  : "text-[color:var(--color-ink-subtle)]",
              ].join(" ")}
            >
              {renderRowLabel
                ? renderRowLabel(idx, rowLabels[idx])
                : rowLabels[idx]}
            </div>
            {CHANNEL_COLS.map((col, c) => {
              const value = matrix[r]?.[c] ?? NaN;
              const isSelected = idx === selectedRowKey && col === selectedChannel;
              const pct = inkPctFor(value);
              const showLabel = Number.isFinite(value) && Math.abs(value) >= 0.1;
              const labelText = showLabel
                ? Math.round(Math.abs(value) * 100).toString().padStart(2, "0")
                : "";
              const inkOnDark = pct >= 35;
              const cellContent = (
                <>
                  {showLabel && (
                    <>
                      <SignBadge r={value} />
                      <span
                        data-role="cell-value"
                        className="absolute inset-0 flex items-center justify-center text-[10.5px] tabular-nums font-semibold"
                        style={{
                          color: inkOnDark
                            ? "var(--color-bg)"
                            : "var(--color-ink-muted)",
                        }}
                      >
                        {labelText}
                      </span>
                    </>
                  )}
                </>
              );
              const cellStyle = {
                background:
                  pct === 0
                    ? "var(--color-surface-elevated)"
                    : `color-mix(in oklch, var(--color-ink) ${pct}%, var(--color-surface) ${100 - pct}%)`,
              };
              const baseClass = [
                "relative h-7 rounded-[2px] transition-shadow outline-none",
                isSelected
                  ? "ring-2 ring-[color:var(--color-primary)] ring-offset-1 ring-offset-[color:var(--color-surface)]"
                  : "ring-1 ring-inset ring-[color:var(--color-border)]",
              ].join(" ");
              const titleText = Number.isFinite(value)
                ? `${rowLabels[idx]} × ${COL_LABELS[col]} : r = ${value.toFixed(2)}`
                : `${rowLabels[idx]} × ${COL_LABELS[col]} : n/a`;

              if (onSelect !== null) {
                return (
                  <button
                    key={col}
                    type="button"
                    data-role="matrix-cell"
                    className={[
                      baseClass,
                      "cursor-pointer",
                      !isSelected
                        ? "hover:ring-[color:var(--color-border-strong)]"
                        : "",
                      "focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]",
                    ].join(" ")}
                    style={cellStyle}
                    onClick={() => onSelect(idx, col)}
                    title={titleText}
                  >
                    {cellContent}
                  </button>
                );
              }

              return (
                <div
                  key={col}
                  data-role="matrix-cell"
                  className={[baseClass, "cursor-default"].join(" ")}
                  style={cellStyle}
                  title={titleText}
                >
                  {cellContent}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
        {onSelect !== null ? "|r|×100 · click to select pair" : "|r|×100 · read-only"}
      </p>
    </div>
  );
}
