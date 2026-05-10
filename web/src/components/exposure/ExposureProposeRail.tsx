import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";
import type { ModeChoice, ParamKey } from "./proposeTestMath";

interface RangeReadout {
  paramName: string;
  min: number;
  max: number;
  unit: string;
}

interface Props {
  anchor: ExposureRow | null;
  mode: ModeChoice;
  onModeChange: (next: ModeChoice) => void;
  cellCount: number;
  onCellCountChange: (n: number) => void;
  rangeReadout: ReadonlyArray<RangeReadout>;
  canCreate: boolean;
  helperText: string | null;
  onCreate: () => void;
  onCancel: () => void;
}

function formatRange(v: number): string {
  // Round integers to 0dp, fractional values to 2dp. Avoids 16-digit
  // float artefacts in the rail's range readout.
  if (Number.isInteger(v)) return v.toString();
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

const PARAM_LABEL: Record<ParamKey, string> = {
  power: "POWER",
  speed: "SPEED",
  frequency: "FREQ",
  density: "DENSITY",
};

export const ExposureProposeRail: React.FC<Props> = ({
  anchor, mode, onModeChange, cellCount, onCellCountChange,
  rangeReadout, canCreate, helperText, onCreate, onCancel,
}) => {
  const isFill = mode.mode === "fill";

  const toggleMode = (next: "curve" | "fill") => {
    if (next === mode.mode) return;
    if (next === "curve") {
      const param: ParamKey = isFill ? mode.varyParams[0] : mode.varyParam;
      onModeChange({ mode: "curve", varyParam: param });
    } else {
      const first: ParamKey = isFill ? mode.varyParams[0] : mode.varyParam;
      const second: ParamKey = first === "power" ? "speed" : "power";
      onModeChange({ mode: "fill", varyParams: [first, second] });
    }
  };

  const toggleChip = (param: ParamKey) => {
    if (mode.mode === "curve") {
      onModeChange({ mode: "curve", varyParam: param });
    } else {
      const [a, b] = mode.varyParams;
      // Multi-select clamp to 2: clicking a selected chip when both slots
      // are filled deselects it (mode becomes curve with the OTHER chip).
      // Clicking an unselected chip swaps in for the second slot.
      if (param === a) {
        onModeChange({ mode: "curve", varyParam: b });
      } else if (param === b) {
        onModeChange({ mode: "curve", varyParam: a });
      } else {
        onModeChange({ mode: "fill", varyParams: [a, param] });
      }
    }
  };

  const isChipSelected = (p: ParamKey) =>
    mode.mode === "curve"
      ? mode.varyParam === p
      : mode.varyParams.includes(p);

  return (
    <div
      className="flex flex-col gap-3 h-full"
      data-role="propose-rail"
    >
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] font-semibold text-[color:var(--color-primary)]">
          Propose Test
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => toggleMode("curve")}
            className={
              "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
              (mode.mode === "curve"
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
          >
            curve
          </button>
          <button
            type="button"
            onClick={() => toggleMode("fill")}
            className={
              "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
              (mode.mode === "fill"
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
          >
            fill
          </button>
        </div>
      </div>

      <div className="h-px bg-[color:var(--color-border)]" />

      <section>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-1">
          Anchor
        </div>
        {anchor ? (
          <>
            <div className="font-mono text-[12px] text-[color:var(--color-ink)]">
              {anchor.hex}
            </div>
            <div className="font-mono text-[10px] text-[color:var(--color-ink-muted)] mt-1">
              {Object.entries(anchor.params ?? {})
                .map(([k, v]) => `${k.slice(0, 1).toUpperCase()} ${v}`)
                .join("  ")}
            </div>
          </>
        ) : (
          <div className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)]">
            No entries inside polygon yet.
          </div>
        )}
      </section>

      <section>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
          Vary
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(["power", "speed", "frequency", "density"] as ParamKey[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={isChipSelected(p)}
              onClick={() => toggleChip(p)}
              className={
                "px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
                (isChipSelected(p)
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
              }
            >
              {PARAM_LABEL[p]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
            Cells · {cellCount}
          </div>
        </div>
        <input
          type="range"
          min={2}
          max={200}
          step={1}
          value={cellCount}
          onChange={(e) => onCellCountChange(Number(e.target.value))}
          aria-label="Cells"
          className="w-full"
        />
        <div className="flex justify-between font-mono text-[8px] text-[color:var(--color-ink-subtle)]">
          <span>2</span>
          <span>200</span>
        </div>
      </section>

      <section>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-1">
          Range
        </div>
        {rangeReadout.length === 0 ? (
          <div className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)]">—</div>
        ) : (
          rangeReadout.map((r) => (
            <div key={r.paramName} className="font-mono text-[11px] text-[color:var(--color-ink)]">
              {`${r.paramName} · ${formatRange(r.min)} → ${formatRange(r.max)} ${r.unit}`}
            </div>
          ))
        )}
      </section>

      <div className="flex-1" />

      {helperText && (
        <div className="font-mono text-[10px] text-[color:var(--color-ink-muted)] italic">
          {helperText}
        </div>
      )}

      <button
        type="button"
        disabled={!canCreate}
        onClick={onCreate}
        className={
          "px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] font-semibold rounded-sm " +
          (canCreate
            ? "bg-[color:var(--color-primary)] text-white"
            : "bg-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed")
        }
      >
        Create Test →
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-muted)] border border-[color:var(--color-border)] rounded-sm"
      >
        Cancel
      </button>
    </div>
  );
};

export type { RangeReadout };
