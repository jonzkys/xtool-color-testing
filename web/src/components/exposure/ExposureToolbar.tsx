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
  /** Optional hover preview hooks — let the parent override the
   *  chart's xKey / yKey while the user is hovering options in the
   *  picker popover, without committing the change. Null clears. */
  onXKeyPreview?: (k: IndexRow | ChannelCol | null) => void;
  onYKeyPreview?: (k: IndexRow | ChannelCol | null) => void;
  proposeOpen: boolean;
  onToggleProposeMode: () => void;
  proposeAvailable: boolean;   // false in univariate mode → chip disabled
}

// Short codes for the toolbar pill; full names live in ExposureAxisPicker.
const INDEX_SHORT: Record<IndexRow, string> = {
  pulse_spacing_mm: "PSp",
  line_spacing_mm: "LSp",
  pulse_energy_index: "PEn",
  pulse_intensity_index: "PIn",
  total_exposure_index: "TEx",
  ablation_aggression_index: "AAg",
  delivery_smoothness_index: "DSm",
  duty_cycle_index: "Duty",
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
  /** Optional hover preview — forwarded to the picker. */
  onKeyPreview?: (k: IndexRow | ChannelCol | null) => void;
}

function AxisPill({
  axis, mode, currentKey, scale, pretty,
  onKeyChange, onScaleChange, onKeyPreview,
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
          "shrink-0 whitespace-nowrap px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] " +
          "rounded-sm border transition-colors " +
          (open
            ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]"
            : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-ink)]")
        }
      >
        <span className="text-[color:var(--color-ink-subtle)] mr-1">{axis}</span>{pretty} ▾
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
            onClose={() => {
              setOpen(false);
              onKeyPreview?.(null);
            }}
            onKeyPreview={onKeyPreview}
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
  onXKeyPreview, onYKeyPreview,
  proposeOpen, onToggleProposeMode, proposeAvailable,
}: Props) {
  const yPretty = mode === "univariate"
    ? CHANNEL_PRETTY[yKey as ChannelCol]
    : INDEX_SHORT[yKey as IndexRow];

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-x-auto">
      <label className="shrink-0 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="text-[color:var(--color-ink-subtle)]" id="material-label">Material</span>
        <select
          aria-label="material"
          aria-labelledby="material-label"
          value={materialId ?? ""}
          onChange={(e) => onMaterialChange(Number(e.target.value))}
          className="font-mono text-[11px] px-2 py-1 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] max-w-[160px] truncate"
        >
          {materials.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </label>

      <div className="shrink-0 inline-flex border border-[color:var(--color-border)] rounded-sm overflow-hidden" role="tablist" aria-label="scatter mode">
        {(["univariate", "bivariate"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === mode}
            onClick={() => onModeChange(m)}
            className={
              "whitespace-nowrap px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] " +
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
        currentKey={xKey} scale={xScale} pretty={INDEX_SHORT[xKey]}
        onKeyChange={(k) => onXKeyChange(k as IndexRow)}
        onScaleChange={onXScaleChange}
        onKeyPreview={onXKeyPreview}
      />
      <AxisPill
        axis="y" mode={mode}
        currentKey={yKey} scale={yScale} pretty={yPretty}
        onKeyChange={onYKeyChange}
        onScaleChange={onYScaleChange}
        onKeyPreview={onYKeyPreview}
      />

      <button
        type="button"
        disabled={!proposeAvailable}
        onClick={onToggleProposeMode}
        title={proposeAvailable ? undefined : "Propose Test is bivariate-only"}
        aria-pressed={proposeOpen}
        className={
          "shrink-0 whitespace-nowrap ml-auto px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
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
