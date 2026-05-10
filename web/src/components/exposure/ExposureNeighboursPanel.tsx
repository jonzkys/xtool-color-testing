import { useEffect, useState } from "react";
import {
  nearestByDeltaE, nearestByRegime, type Neighbour,
} from "./exposureNeighbours";
import type { ExposureRow } from "./exposureCorrelations";
import { ExposureNeighboursStrip, type NeighbourEntry } from "./ExposureNeighboursStrip";
import { ExposureNeighbourDetail } from "./ExposureNeighbourDetail";

interface Props {
  anchor: ExposureRow;
  candidates: readonly ExposureRow[];
  onSelectNeighbour: (id: number) => void;
  onFilterFromNeighbour?: (neighbour: ExposureRow) => void;
  n?: number;
}

type SortMode = "colour" | "regime";

export const ExposureNeighboursPanel: React.FC<Props> = ({
  anchor, candidates, onSelectNeighbour, onFilterFromNeighbour, n = 5,
}) => {
  const [sortMode, setSortMode] = useState<SortMode>("colour");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Reset selection whenever the focused entry changes.
  useEffect(() => { setSelectedId(null); }, [anchor.id]);

  const neighbours: Neighbour[] = sortMode === "colour"
    ? nearestByDeltaE(anchor, candidates, n)
    : nearestByRegime(anchor, candidates, n);

  const stripEntries: NeighbourEntry[] = neighbours.map((nb) => ({
    row: nb.row,
    deltaE: nb.distance,
  }));

  const effectiveSelected = selectedId ?? (neighbours[0]?.row.id ?? anchor.id);
  const selectedRow: ExposureRow = effectiveSelected === anchor.id
    ? anchor
    : (neighbours.find((nh) => nh.row.id === effectiveSelected)?.row ?? anchor);
  const selectedDeltaE: number | null = selectedRow.id === anchor.id
    ? null
    : (neighbours.find((nh) => nh.row.id === selectedRow.id)?.distance ?? null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {(["colour", "regime"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSortMode(m)}
            className={
              "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
              (m === sortMode
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
          >
            similar {m}
          </button>
        ))}
      </div>

      <ExposureNeighboursStrip
        focused={anchor}
        neighbours={stripEntries}
        selectedId={effectiveSelected}
        onSelect={(id) => setSelectedId(id)}
      />

      <ExposureNeighbourDetail
        focused={anchor}
        selected={selectedRow}
        deltaE={selectedDeltaE}
        onJumpTo={(id) => onSelectNeighbour(id)}
        onFilterFrom={(row) => onFilterFromNeighbour?.(row)}
      />
    </div>
  );
};
