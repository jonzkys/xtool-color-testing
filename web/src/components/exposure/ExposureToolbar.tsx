import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Material } from "../../library";
import type { ChannelCol, IndexRow } from "./exposureCorrelations";
import type { ScaleKind, ScatterMode } from "./ExposureScatter";
import { ExposureAxisPicker } from "./ExposureAxisPicker";

interface Props {
  materials: readonly Material[];
  materialId: number | null;
  onMaterialChange: (id: number) => void;
  mode: ScatterMode;
  onModeChange: (m: ScatterMode) => void;
  xKey: IndexRow;
  yKey: ChannelCol | IndexRow;
  xScale: ScaleKind;
  yScale: ScaleKind;
  onXKeyChange: (k: IndexRow) => void;
  onYKeyChange: (k: ChannelCol | IndexRow) => void;
  onXScaleChange: (s: ScaleKind) => void;
  onYScaleChange: (s: ScaleKind) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  proposeOpen: boolean;
  onToggleProposeMode: () => void;
  proposeAvailable: boolean;   // false in univariate mode → chip disabled
  colourField: boolean;
  onToggleColourField: () => void;
  colourFieldAvailable: boolean;   // false in univariate mode → chip disabled
  contours: boolean;
  onToggleContours: () => void;
  contoursAvailable: boolean;      // false in univariate mode → chip disabled
  fadeDots: boolean;
  onToggleFadeDots: () => void;
}

const INDEX_PRETTY: Record<IndexRow, string> = {
  pulse_spacing_mm: "Pulse Spacing (mm)",
  line_spacing_mm: "Line Spacing (mm)",
  pulse_energy_index: "Pulse Energy",
  pulse_intensity_index: "Pulse Intensity",
  total_exposure_index: "Total Exposure",
  ablation_aggression_index: "Ablation Aggression",
  delivery_smoothness_index: "Delivery Smoothness",
};

const CHANNEL_PRETTY: Record<ChannelCol, string> = {
  L: "L*", a: "a*", b: "b*", hue: "Hue°", chroma: "Chroma",
};

function placePopover(
  anchor: HTMLElement,
  size: { width: number; height: number },
): { left: number; top: number } {
  const a = anchor.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = a.left;
  if (left + size.width + margin > vw) left = vw - size.width - margin;
  if (left < margin) left = margin;
  let top = a.bottom + 6;
  if (top + size.height + margin > vh) {
    top = a.top - size.height - 6;
  }
  if (top < margin) top = margin;
  return { left, top };
}

interface AxisPillProps {
  axis: "x" | "y";
  mode: ScatterMode;
  currentKey: IndexRow | ChannelCol;
  scale: ScaleKind;
  pretty: string;
  onKeyChange: (k: IndexRow | ChannelCol) => void;
  onScaleChange: (s: ScaleKind) => void;
}

function AxisPill({
  axis, mode, currentKey, scale, pretty,
  onKeyChange, onScaleChange,
}: AxisPillProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      const tip = document.querySelector('[data-axis-picker]');
      if (tip && e.target instanceof Node && tip.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          "px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] " +
          "rounded-sm border transition-colors " +
          (open
            ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]"
            : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-ink)]")
        }
      >
        {axis.toUpperCase()}: {pretty} ▾
      </button>
      {open && ref.current && typeof document !== "undefined" && createPortal(
        <div
          data-axis-picker
          className="fixed z-[1000] rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] shadow-lg"
          style={placePopover(ref.current, { width: 220, height: 280 })}
        >
          <ExposureAxisPicker
            axis={axis}
            mode={mode}
            currentKey={currentKey}
            scale={scale}
            onKeyChange={onKeyChange}
            onScaleChange={onScaleChange}
            onClose={() => setOpen(false)}
          />
        </div>,
        document.body,
      )}
    </>
  );
}

export function ExposureToolbar({
  materials, materialId, onMaterialChange,
  mode, onModeChange,
  xKey, yKey, xScale, yScale,
  onXKeyChange, onYKeyChange, onXScaleChange, onYScaleChange,
  filtersOpen, onToggleFilters, activeFilterCount,
  proposeOpen, onToggleProposeMode, proposeAvailable,
  colourField, onToggleColourField, colourFieldAvailable,
  contours, onToggleContours, contoursAvailable,
  fadeDots, onToggleFadeDots,
}: Props) {
  const yPretty = mode === "univariate"
    ? CHANNEL_PRETTY[yKey as ChannelCol]
    : INDEX_PRETTY[yKey as IndexRow];

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="text-[color:var(--color-ink-subtle)]" id="material-label">Material</span>
        <select
          aria-label="material"
          aria-labelledby="material-label"
          value={materialId ?? ""}
          onChange={(e) => onMaterialChange(Number(e.target.value))}
          className="font-mono text-[11px] px-2 py-1 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
        >
          {materials.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </label>

      <div className="inline-flex border border-[color:var(--color-border)] rounded-sm overflow-hidden" role="tablist" aria-label="scatter mode">
        {(["univariate", "bivariate"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === mode}
            onClick={() => onModeChange(m)}
            className={
              "px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] " +
              (m === mode
                ? "bg-[color:var(--color-primary)] text-white"
                : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]")
            }
          >
            {m}
          </button>
        ))}
      </div>

      <AxisPill
        axis="x" mode={mode}
        currentKey={xKey} scale={xScale} pretty={INDEX_PRETTY[xKey]}
        onKeyChange={(k) => onXKeyChange(k as IndexRow)}
        onScaleChange={onXScaleChange}
      />
      <AxisPill
        axis="y" mode={mode}
        currentKey={yKey} scale={yScale} pretty={yPretty}
        onKeyChange={onYKeyChange}
        onScaleChange={onYScaleChange}
      />

      <button
        type="button"
        disabled={!colourFieldAvailable}
        onClick={onToggleColourField}
        aria-pressed={colourField}
        title={colourFieldAvailable
          ? "Tint the chart background with the local measured colour"
          : "Colour field is bivariate-only"}
        className={
          "ml-auto px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
          (!colourFieldAvailable
            ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] opacity-50 cursor-not-allowed"
            : colourField
              ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
              : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)]")
        }
      >
        ▦ COLOUR FIELD
      </button>

      <button
        type="button"
        disabled={!contoursAvailable}
        onClick={onToggleContours}
        aria-pressed={contours}
        title={contoursAvailable
          ? "Overlay L* (brightness) contour lines"
          : "Contours are bivariate-only"}
        className={
          "ml-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
          (!contoursAvailable
            ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] opacity-50 cursor-not-allowed"
            : contours
              ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
              : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)]")
        }
      >
        ◷ CONTOURS
      </button>

      <button
        type="button"
        onClick={onToggleFadeDots}
        aria-pressed={fadeDots}
        title="Fade the palette dots so overlay viz reads clearly"
        className={
          "ml-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
          (fadeDots
            ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
            : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)]")
        }
      >
        ◯ FADE DOTS
      </button>

      <button
        type="button"
        onClick={onToggleFilters}
        className={
          "ml-1 px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] " +
          "rounded-sm border transition-colors " +
          (filtersOpen || activeFilterCount > 0
            ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]"
            : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)]")
        }
      >
        ⚙ FILTERS{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
      </button>

      <button
        type="button"
        disabled={!proposeAvailable}
        onClick={onToggleProposeMode}
        title={proposeAvailable ? undefined : "Propose Test is bivariate-only"}
        aria-pressed={proposeOpen}
        className={
          "ml-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
          (!proposeAvailable
            ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] opacity-50 cursor-not-allowed"
            : proposeOpen
              ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
              : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
        }
      >
        {proposeOpen ? "× CANCEL" : "◇ PROPOSE TEST"}
      </button>
    </div>
  );
}
