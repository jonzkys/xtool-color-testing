import * as React from "react";
import type { ExposureRow, IndexRow } from "./exposureCorrelations";
import { ExposureChromaDisc } from "./ExposureChromaDisc";

interface Props {
  rows: readonly ExposureRow[];
  focusedId: number | null;
  /** The current X axis — emphasised in the indices readout so the
   *  user sees at a glance what the scatter is comparing. */
  highlightIndex?: IndexRow;
  onDiscHover?: (id: number) => void;
  onDiscLeave?: () => void;
  onDiscClick?: (id: number) => void;
}

const INDEX_LABELS: Record<IndexRow, string> = {
  surface_exposure_index: "SURFACE_EXPOSURE",
  pulse_intensity_index: "PULSE_INTENSITY",
  pulse_energy_index: "PULSE_ENERGY",
  pulse_spacing_mm: "PULSE_SPACING (mm)",
  line_spacing_index: "LINE_SPACING_INDEX",
};

const INDEX_ORDER: IndexRow[] = [
  "surface_exposure_index",
  "pulse_intensity_index",
  "pulse_energy_index",
  "pulse_spacing_mm",
  "line_spacing_index",
];

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 1e-3 || abs >= 1e5) return n.toExponential(2);
  return n.toPrecision(4);
}

const PARAM_FIELDS: { key: string; label: string; suffix?: string }[] = [
  { key: "power", label: "POWER", suffix: " %" },
  { key: "speed", label: "SPEED", suffix: " mm/s" },
  { key: "frequency", label: "FREQUENCY", suffix: " kHz" },
  { key: "density", label: "DENSITY" },
  { key: "passes", label: "PASSES" },
  { key: "pulse_width", label: "PULSE_WIDTH", suffix: " ns" },
];

export const ExposureFocusedCard: React.FC<Props> = ({
  rows,
  focusedId,
  highlightIndex,
  onDiscHover,
  onDiscLeave,
  onDiscClick,
}) => {
  const focused = focusedId == null ? null : rows.find((r) => r.id === focusedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        {focused && (
          <div
            className="flex-shrink-0 flex items-end justify-center w-[120px] h-[120px] rounded-sm border border-[color:var(--color-border)] p-2"
            style={{ background: focused.hex }}
          >
            <span className="font-mono text-xs uppercase text-white drop-shadow-md">
              {focused.hex.toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-1">
            a* / b* CHROMATICITY
          </div>
          <ExposureChromaDisc
            rows={rows}
            focusedId={focusedId}
            size={140}
            onHover={onDiscHover}
            onLeave={onDiscLeave}
            onClick={onDiscClick}
          />
        </div>
      </div>

      {!focused && (
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] py-4 text-center border-t border-[color:var(--color-border)]">
          hover any dot to inspect
        </div>
      )}

      {focused && (
        <>
          <div className="border-t border-[color:var(--color-border)] pt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
              RECIPE
            </div>
            <div className="flex flex-col gap-1">
              {PARAM_FIELDS.map((field) => {
                const v = focused.params?.[field.key];
                if (v == null) return null;
                return (
                  <div key={field.key} className="flex justify-between font-mono text-xs">
                    <span className="text-[color:var(--color-ink-subtle)]">{field.label}</span>
                    <span className="text-[color:var(--color-ink)]">
                      {String(v)}{field.suffix ?? ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[color:var(--color-border)] pt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
              INDICES
            </div>
            <div className="flex flex-col gap-1">
              {INDEX_ORDER.map((key) => {
                const isHighlighted = key === highlightIndex;
                const v =
                  key === "pulse_spacing_mm"
                    ? focused.indices.pulse_spacing_mm
                    : (focused.indices[key] as number | null);
                return (
                  <div key={key} className="flex justify-between font-mono text-xs">
                    <span
                      className={
                        isHighlighted
                          ? "text-[color:var(--color-primary)] font-semibold"
                          : "text-[color:var(--color-ink-subtle)]"
                      }
                    >
                      {INDEX_LABELS[key]}
                    </span>
                    <span
                      className={
                        isHighlighted
                          ? "text-[color:var(--color-primary)] font-semibold"
                          : "text-[color:var(--color-ink)]"
                      }
                    >
                      {fmt(v as number | null)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
