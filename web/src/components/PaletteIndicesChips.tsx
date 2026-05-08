import * as React from "react";

export interface LaserIndices {
  pulse_spacing_mm: number;
  line_spacing_index: number;
  line_spacing_mm: number | null;
  pulse_energy_index: number;
  pulse_intensity_index: number;
  surface_exposure_index: number;
  formula_version: number;
  density_model: string;
  power_model: string;
}

interface ChipProps {
  label: string;
  value: string;
  bar?: number;
}

const Chip: React.FC<ChipProps> = ({ label, value, bar }) => (
  <div
    className="flex flex-col gap-0.5 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-2 py-1 text-xs"
    role="group"
  >
    <span className="font-mono uppercase tracking-[0.16em] text-[9.5px] font-semibold text-[color:var(--color-ink-subtle)]">
      {label}
    </span>
    <span className="font-mono tabular-nums text-[color:var(--color-ink)]">{value}</span>
    {bar !== undefined && (
      <div className="mt-0.5 h-0.5 w-full bg-[color:var(--color-border)]">
        <div
          className="h-full bg-amber-600"
          style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }}
        />
      </div>
    )}
  </div>
);

function fmtNum(n: number, sig: number = 4): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 1e-3 || abs >= 1e5) return n.toExponential(2);
  return n.toPrecision(sig);
}

function logBar(v: number, lo: number = 1, hi: number = 2000): number {
  if (v <= 0 || !Number.isFinite(v)) return 0;
  const t =
    (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  return Math.max(0, Math.min(1, t));
}

export const PaletteIndicesChips: React.FC<{ indices: LaserIndices }> = ({
  indices,
}) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Chip
          label="Pulse spacing"
          value={`${fmtNum(indices.pulse_spacing_mm)} mm`}
        />
        <Chip
          label="Line spacing index"
          value={fmtNum(indices.line_spacing_index)}
        />
        <Chip
          label="Line spacing (mm)"
          value={
            indices.line_spacing_mm === null
              ? "—"
              : `${fmtNum(indices.line_spacing_mm)}`
          }
        />
        <Chip
          label="Pulse energy"
          value={fmtNum(indices.pulse_energy_index)}
        />
        <Chip
          label="Pulse intensity"
          value={fmtNum(indices.pulse_intensity_index)}
        />
        <Chip
          label="Surface exposure"
          value={fmtNum(indices.surface_exposure_index)}
          bar={logBar(indices.surface_exposure_index)}
        />
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-ink-subtle)]">
        <span
          title={`density_model=${indices.density_model}; power_model=${indices.power_model}`}
        >
          v{indices.formula_version}
        </span>
        <span aria-hidden="true">·</span>
        <span>heuristic indices, not calibrated values</span>
      </div>
    </div>
  );
};
