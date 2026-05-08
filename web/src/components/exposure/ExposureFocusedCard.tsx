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
  /** Optional: mirrors ExposurePage's exposure brush so the disc
   *  fades out-of-range entries in lockstep with the scatter. */
  dimRange?: readonly [number, number] | null;
}

const INDEX_LABELS: Record<IndexRow, string> = {
  surface_exposure_index: "Surface exposure",
  pulse_intensity_index: "Pulse intensity",
  pulse_energy_index: "Pulse energy",
  pulse_spacing_mm: "Pulse spacing (mm)",
  line_spacing_index: "Line spacing index",
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
  { key: "power", label: "Power", suffix: " %" },
  { key: "speed", label: "Speed", suffix: " mm/s" },
  { key: "frequency", label: "Frequency", suffix: " kHz" },
  { key: "density", label: "Density" },
  { key: "passes", label: "Passes" },
  { key: "pulse_width", label: "Pulse width", suffix: " ns" },
];

export const ExposureFocusedCard: React.FC<Props> = ({
  rows,
  focusedId,
  highlightIndex,
  onDiscHover,
  onDiscLeave,
  onDiscClick,
  dimRange,
}) => {
  const focused = focusedId == null ? null : rows.find((r) => r.id === focusedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* Disc — always visible. The card stays readable when nothing
          is focused so the rail doesn't collapse to a tiny stub. */}
      <div className="flex justify-center">
        <ExposureChromaDisc
          rows={rows}
          focusedId={focusedId}
          size={150}
          onHover={onDiscHover}
          onLeave={onDiscLeave}
          onClick={onDiscClick}
          dimRange={dimRange}
        />
      </div>

      {/* Swatch — only when focused. */}
      {focused && (
        <div className="flex items-center gap-2">
          <div
            className="h-9 w-9 shrink-0 rounded-[3px] border border-[color:var(--color-border-strong)]"
            style={{ background: focused.hex }}
            aria-label={`swatch ${focused.hex}`}
          />
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">
              Hex
            </span>
            <span className="font-mono text-[12.5px] tabular-nums text-[color:var(--color-ink)]">
              {focused.hex.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {!focused && (
        <div className="border-t border-[color:var(--color-border)] pt-3 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)]">
            Idle
          </p>
          <p className="font-mono text-[11px] text-[color:var(--color-ink-muted)] mt-1 leading-snug">
            Hover or click any dot to inspect its recipe and indices.
          </p>
        </div>
      )}

      {focused && (
        <>
          <div className="border-t border-[color:var(--color-border)] pt-3">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold mb-2">
              Recipe
            </div>
            <div className="flex flex-col gap-1">
              {PARAM_FIELDS.map((field) => {
                const v = focused.params?.[field.key];
                if (v == null) return null;
                return (
                  <div
                    key={field.key}
                    className="flex justify-between items-baseline font-mono text-[11.5px]"
                  >
                    <span className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
                      {field.label}
                    </span>
                    <span className="tabular-nums text-[color:var(--color-ink)]">
                      {String(v)}
                      {field.suffix ?? ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[color:var(--color-border)] pt-3">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold mb-2">
              Indices
            </div>
            <div className="flex flex-col gap-1">
              {INDEX_ORDER.map((key) => {
                const isHighlighted = key === highlightIndex;
                const v =
                  key === "pulse_spacing_mm"
                    ? focused.indices.pulse_spacing_mm
                    : (focused.indices[key] as number | null);
                return (
                  <div
                    key={key}
                    className={[
                      "flex justify-between items-baseline font-mono text-[11.5px] rounded-[3px] -mx-1 px-1 py-0.5",
                      isHighlighted
                        ? "bg-[color:var(--color-primary-tint)]"
                        : "",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "text-[10px] uppercase tracking-[0.16em]",
                        isHighlighted
                          ? "text-[color:var(--color-primary)] font-semibold"
                          : "text-[color:var(--color-ink-subtle)]",
                      ].join(" ")}
                    >
                      {INDEX_LABELS[key]}
                    </span>
                    <span
                      className={[
                        "tabular-nums",
                        isHighlighted
                          ? "text-[color:var(--color-primary)] font-semibold"
                          : "text-[color:var(--color-ink)]",
                      ].join(" ")}
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
