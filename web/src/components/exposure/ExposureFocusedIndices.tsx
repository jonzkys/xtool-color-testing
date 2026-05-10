import type { ExposureRow } from "./exposureCorrelations";

interface Props {
  row: ExposureRow | null;
}

interface ChipProps {
  label: string;
  value: string;
}

function fmtNum(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 1e-3 || abs >= 1e5) return n.toExponential(2);
  return n.toPrecision(sig);
}

function Chip({ label, value }: ChipProps) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2 py-1 rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-semibold text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

export function ExposureFocusedIndices({ row }: Props) {
  if (row == null) {
    return (
      <p className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)] leading-relaxed">
        Focus an entry to see its indices.
      </p>
    );
  }
  const i = row.indices;
  return (
    <div className="flex flex-col gap-1">
      <Chip label="Pulse spacing" value={`${fmtNum(i.pulse_spacing_mm)} mm`} />
      <Chip label="Line spacing" value={`${fmtNum(i.line_spacing_mm ?? NaN)} mm`} />
      <Chip label="Pulse energy" value={fmtNum(i.pulse_energy_index)} />
      <Chip label="Pulse intensity" value={fmtNum(i.pulse_intensity_index)} />
      <Chip label="Total exposure" value={fmtNum(i.total_exposure_index)} />
      <Chip label="Ablation aggression" value={fmtNum(i.ablation_aggression_index)} />
      <Chip label="Delivery smoothness" value={fmtNum(i.delivery_smoothness_index)} />
    </div>
  );
}
