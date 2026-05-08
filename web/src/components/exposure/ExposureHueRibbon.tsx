import * as React from "react";
import type { ExposureRow, IndexRow } from "./exposureCorrelations";

interface Props {
  rows: readonly ExposureRow[];
  /** The index whose value drives the order of tiles ascending. */
  orderBy: IndexRow;
  focusedId: number | null;
  onHover?: (id: number) => void;
  onLeave?: () => void;
  onClick?: (id: number) => void;
}

/**
 * Hue Ribbon — every entry's swatch as a tile, ordered ascending by
 * the chosen index. A successful index/colour relationship makes the
 * ribbon read as a smooth gradient; a noisy one looks scrambled.
 */
export const ExposureHueRibbon: React.FC<Props> = ({
  rows,
  orderBy,
  focusedId,
  onHover,
  onLeave,
  onClick,
}) => {
  const ordered = React.useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = a.indices[orderBy] as number;
      const vb = b.indices[orderBy] as number;
      if (Number.isNaN(va) || va == null) return 1;
      if (Number.isNaN(vb) || vb == null) return -1;
      return va - vb;
    });
  }, [rows, orderBy]);

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="relative flex w-full overflow-hidden rounded-sm border border-[color:var(--color-border)] h-[60px]">
        {ordered.map((row) => {
          const isFocused = row.id === focusedId;
          return (
            <div
              key={row.id}
              data-role="ribbon-tile"
              data-entry-id={row.id}
              className="flex-1 cursor-pointer transition-opacity"
              style={{ background: row.hex, opacity: isFocused ? 1 : 0.95 }}
              onMouseEnter={() => onHover?.(row.id)}
              onMouseLeave={() => onLeave?.()}
              onClick={() => onClick?.(row.id)}
              title={`${row.hex} · ${orderBy}=${(row.indices[orderBy] as number).toPrecision(3)}`}
            />
          );
        })}
      </div>
      {focusedId != null && (() => {
        const idx = ordered.findIndex((r) => r.id === focusedId);
        if (idx < 0) return null;
        const left = `calc(${(idx + 0.5) * (100 / ordered.length)}% - 1px)`;
        return (
          <div
            data-role="focus-mark"
            className="relative w-full h-3"
            aria-hidden="true"
          >
            <div
              className="absolute top-0 h-3 w-0.5 bg-[color:var(--color-primary)]"
              style={{ left }}
            />
            <div
              className="absolute top-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-primary)]"
              style={{ left: `calc(${left} + 6px)` }}
            >
              focused
            </div>
          </div>
        );
      })()}
    </div>
  );
};
