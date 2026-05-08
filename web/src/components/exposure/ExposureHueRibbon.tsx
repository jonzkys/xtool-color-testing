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
  /** Optional: dim out-of-range tiles when the user has narrowed the
   *  exposure brush. Mirrors ExposureScatter — the brush range is
   *  always against ``surface_exposure_index`` regardless of orderBy. */
  dimRange?: readonly [number, number] | null;
}

/**
 * Hue Ribbon — every entry's swatch as a tile, ordered ascending by
 * the chosen index. A successful index/colour relationship makes the
 * ribbon read as a smooth gradient; a noisy one looks scrambled.
 *
 * The focused tile gets a sharp inset outline + a small downward
 * caret — opacity alone was too subtle to read at the page level.
 */
export const ExposureHueRibbon: React.FC<Props> = ({
  rows,
  orderBy,
  focusedId,
  onHover,
  onLeave,
  onClick,
  dimRange,
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

  const inDimRange = (row: ExposureRow): boolean => {
    if (!dimRange) return true;
    const v = row.indices.surface_exposure_index as number;
    return v >= dimRange[0] && v <= dimRange[1];
  };

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="relative flex w-full overflow-hidden rounded-[3px] border border-[color:var(--color-border)] h-[56px] bg-[color:var(--color-surface)]">
        {ordered.map((row) => {
          const isFocused = row.id === focusedId;
          const visible = inDimRange(row);
          return (
            <div
              key={row.id}
              data-role="ribbon-tile"
              data-entry-id={row.id}
              className="relative flex-1 cursor-pointer transition-opacity"
              style={{
                background: row.hex,
                opacity: visible ? 1 : 0.18,
              }}
              onMouseEnter={() => onHover?.(row.id)}
              onMouseLeave={() => onLeave?.()}
              onClick={() => onClick?.(row.id)}
              title={`${row.hex} · ${orderBy}=${(row.indices[orderBy] as number).toPrecision(3)}`}
            >
              {isFocused && (
                <span
                  data-role="focus-outline"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-[color:var(--color-primary)]"
                  style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.6) inset" }}
                />
              )}
            </div>
          );
        })}
      </div>
      {focusedId != null && (() => {
        const idx = ordered.findIndex((r) => r.id === focusedId);
        if (idx < 0) return null;
        const left = `calc(${(idx + 0.5) * (100 / ordered.length)}% - 3px)`;
        return (
          <div
            data-role="focus-mark"
            className="relative w-full h-2"
            aria-hidden="true"
          >
            <div
              className="absolute top-0 h-2 w-1.5 bg-[color:var(--color-primary)]"
              style={{
                left,
                clipPath: "polygon(0 0, 100% 0, 50% 100%)",
              }}
            />
          </div>
        );
      })()}
    </div>
  );
};
