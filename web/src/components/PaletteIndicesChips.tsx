import * as React from "react";
import { HelpTip } from "./HelpTip";
import { EXPOSURE_INDEX_HELP } from "./exposure/exposureHelpCopy";
import { IndexCardBody } from "./exposure/ExposureHelpCardBody";
import type { IndexRow } from "./exposure/exposureCorrelations";

export interface LaserIndices {
  pulse_spacing_mm: number;
  line_spacing_mm: number;
  pulse_energy_index: number;
  pulse_intensity_index: number;
  total_exposure_index: number;
  ablation_aggression_index: number;
  delivery_smoothness_index: number;
  /** Laser-on time as a percentage of the pulse period
   *  (= frequency_kHz × pulse_width_ns / 10000). Pure (freq, pw)
   *  function — independent of power calibration. Added in formula
   *  version 6. Legacy rows backfilled by migration 0026. */
  duty_cycle_index: number;
  /** @deprecated alias for total_exposure_index — will go away
   *  with the next formula-version bump. New code should not read it. */
  surface_exposure_index?: number;
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

const CHIP_INDEX_KEY: Record<string, IndexRow | null> = {
  "Pulse spacing": "pulse_spacing_mm",
  "Line spacing": "line_spacing_mm",
  "Pulse energy": "pulse_energy_index",
  "Pulse intensity": "pulse_intensity_index",
  "Total exposure": "total_exposure_index",
  "Ablation aggression": "ablation_aggression_index",
  "Delivery smoothness": "delivery_smoothness_index",
  "Duty cycle": "duty_cycle_index",
};

const HelpfulChip: React.FC<ChipProps> = (props) => {
  const indexKey = CHIP_INDEX_KEY[props.label] ?? null;
  if (indexKey === null) return <Chip {...props} />;
  return (
    <HelpTip help={EXPOSURE_INDEX_HELP[indexKey]} Body={IndexCardBody}>
      <Chip {...props} />
    </HelpTip>
  );
};

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
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <HelpfulChip
          label="Pulse spacing"
          value={`${fmtNum(indices.pulse_spacing_mm)} mm`}
        />
        <HelpfulChip
          label="Line spacing"
          value={`${fmtNum(indices.line_spacing_mm)} mm`}
        />
        <HelpfulChip
          label="Pulse energy"
          value={fmtNum(indices.pulse_energy_index)}
        />
        <HelpfulChip
          label="Pulse intensity"
          value={fmtNum(indices.pulse_intensity_index)}
        />
        <HelpfulChip
          label="Total exposure"
          value={fmtNum(indices.total_exposure_index)}
          bar={logBar(indices.total_exposure_index)}
        />
        <HelpfulChip
          label="Ablation aggression"
          value={fmtNum(indices.ablation_aggression_index)}
          bar={logBar(indices.ablation_aggression_index, 1e-4, 1e2)}
        />
        <HelpfulChip
          label="Delivery smoothness"
          value={fmtNum(indices.delivery_smoothness_index)}
          bar={logBar(indices.delivery_smoothness_index, 1e2, 1e7)}
        />
        <HelpfulChip
          label="Duty cycle"
          value={`${fmtNum(indices.duty_cycle_index)}%`}
          bar={Math.max(0, Math.min(1, indices.duty_cycle_index / 100))}
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
