import type { ExposureRow } from "./exposureCorrelations";

export interface NeighbourEntry {
  row: ExposureRow;
  deltaE: number;
}

interface Props {
  focused: ExposureRow | null;
  neighbours: readonly NeighbourEntry[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

interface TileProps {
  row: ExposureRow;
  isFocused: boolean;
  isSelected: boolean;
  caption: string;
  onClick: () => void;
}

function Tile({ row, isFocused, isSelected, caption, onClick }: TileProps) {
  return (
    <button
      type="button"
      data-role="strip-tile"
      data-focused={isFocused ? "true" : "false"}
      data-selected={isSelected ? "true" : "false"}
      onClick={onClick}
      title={caption}
      className="flex-1 h-8 cursor-pointer transition-shadow"
      style={{
        background: row.hex,
        outline: isSelected
          ? "2px solid var(--color-primary)"
          : isFocused
            ? "2px solid var(--color-ink)"
            : "none",
        outlineOffset: "-2px",
      }}
    />
  );
}

export function ExposureNeighboursStrip({
  focused, neighbours, selectedId, onSelect,
}: Props) {
  if (!focused) return null;
  const effectiveSelected = selectedId ?? focused.id;

  return (
    <div className="flex gap-px">
      <Tile
        row={focused}
        isFocused={true}
        isSelected={effectiveSelected === focused.id}
        caption={`focused · ${focused.hex}`}
        onClick={() => onSelect(focused.id)}
      />
      {neighbours.map((n) => (
        <Tile
          key={n.row.id}
          row={n.row}
          isFocused={false}
          isSelected={effectiveSelected === n.row.id}
          caption={`${n.row.hex} · ΔE ${n.deltaE.toFixed(1)}`}
          onClick={() => onSelect(n.row.id)}
        />
      ))}
    </div>
  );
}
