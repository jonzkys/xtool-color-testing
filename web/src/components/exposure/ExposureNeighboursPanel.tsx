import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";
import { nearestByDeltaE, nearestByRegime, type Neighbour } from "./exposureNeighbours";

interface Props {
  anchor: ExposureRow;
  candidates: readonly ExposureRow[];
  onSelectNeighbour: (id: number) => void;
  /** Default 5. */
  n?: number;
}

type Mode = "colour" | "regime";

export const ExposureNeighboursPanel: React.FC<Props> = ({ anchor, candidates, onSelectNeighbour, n = 5 }) => {
  const [mode, setMode] = React.useState<Mode>("colour");
  const neighbours = React.useMemo<Neighbour[]>(() => {
    return mode === "colour"
      ? nearestByDeltaE(anchor, candidates, n)
      : nearestByRegime(anchor, candidates, n);
  }, [mode, anchor, candidates, n]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
          Neighbours
        </div>
        <div className="flex gap-1">
          {(["colour", "regime"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
                (mode === m
                  ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
              }
            >
              {m === "colour" ? "Similar colour" : "Similar regime"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {neighbours.map((nb) => {
          const p = nb.row.params ?? {};
          const recipe = `pwr ${p.power ?? "?"} · spd ${p.speed ?? "?"} · frq ${p.frequency ?? "?"}`;
          const distLabel = mode === "colour"
            ? `ΔE ${nb.distance.toFixed(1)}`
            : `Δreg ${nb.distance.toFixed(2)}`;
          return (
            <button
              key={nb.row.id}
              type="button"
              data-role="neighbour-row"
              onClick={() => onSelectNeighbour(nb.row.id)}
              className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-[color:var(--color-surface-elevated)] text-left"
            >
              <span
                className="inline-block w-4 h-4 rounded-sm border border-[color:var(--color-border)] shrink-0"
                style={{ background: nb.row.hex }}
              />
              <span className="font-mono text-[10px] text-[color:var(--color-ink)]">{nb.row.hex.toUpperCase()}</span>
              <span className="font-mono text-[10px] text-[color:var(--color-ink-subtle)] ml-auto">{distLabel}</span>
              <span className="font-mono text-[9px] text-[color:var(--color-ink-subtle)] hidden xl:inline truncate">{recipe}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
