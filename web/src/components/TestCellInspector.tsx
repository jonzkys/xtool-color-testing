import { useMemo, useRef, useState } from "react";
import type {
  GridLayout, ResultSwatch, TestSpec, ValidationCell,
} from "../types";
import {
  cellRectInImagePx,
  displayedImageRect,
  imagePxToCell,
  resolveSwatchIndex,
  viewportToImagePx,
  type PhysicalCell,
} from "./cellInspectorMath";

export interface TestCellInspectorProps {
  /** Image URL — usually the cached warped PNG. */
  imageUrl: string;
  layout: GridLayout;
  spec: TestSpec;
  swatches: ResultSwatch[];
  /** Click / Inspect-button hand-off. Receives the swatch's row/col. */
  onCellClick: (row: number, col: number) => void;
  /** Optional alt text for the image. */
  imageAlt?: string;
  /** Test kind. Validation tests render no x-axis labels — each cell
   *  carries its own params, there's no continuous axis to interpolate. */
  kind?: "sweep" | "validation";
  /** Per-cell snapshots for ``kind="validation"`` tests. Empty / undefined
   *  for sweep. When present, the hover tooltip swaps the bogus
   *  swept-axis label out for the cell's actual params + expected
   *  hex/Lab so a colour can be mapped back to the values that
   *  produced it. */
  validationCells?: ValidationCell[];
}

/**
 * Inspector overlay for the warped image. Renders the image at fit-to-
 * container scale, draws axis labels along the edges, and tracks the
 * cursor (or last touch) to surface the cell under the pointer with a
 * floating tooltip that carries row × col, x_param + y_param values,
 * a swatch chip + hex, σ, and Lab.
 *
 * All geometry runs against ``layout`` — the backend's
 * ``GET /api/results/{rid}/grid-layout`` payload — so the highlighted
 * rect agrees with what the sampler hit.
 */
export function TestCellInspector({
  imageUrl, layout, spec, swatches, onCellClick, imageAlt, kind,
  validationCells,
}: TestCellInspectorProps) {
  // Index validation cells by (row, col) once. The swatches' (row, col)
  // is the physical-grid position, and `cell_index = row * per_row +
  // col` so we can match cleanly. ``cells_per_physical_row`` lives on
  // the layout the backend computed, so we don't have to re-derive it.
  const validationByCell = useMemo(() => {
    if (!validationCells || validationCells.length === 0) return null;
    const perRow = layout.cells_per_physical_row;
    const m = new Map<string, ValidationCell>();
    for (const vc of validationCells) {
      const r = Math.floor(vc.cell_index / perRow);
      const c = vc.cell_index % perRow;
      m.set(`${r}|${c}`, vc);
    }
    return m;
  }, [validationCells, layout.cells_per_physical_row]);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [hoverCell, setHoverCell] = useState<PhysicalCell | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  const [stickyCell, setStickyCell] = useState<PhysicalCell | null>(null);

  // Index swatches by (row, col) once for O(1) lookup on every move.
  const swatchByCell = useMemo(() => {
    const m = new Map<string, ResultSwatch>();
    for (const s of swatches) m.set(`${s.row}|${s.col}`, s);
    return m;
  }, [swatches]);

  const activeCell = stickyCell ?? hoverCell;
  const activeIdx = activeCell
    ? resolveSwatchIndex(layout, activeCell, spec.x_steps)
    : null;
  const activeSwatch = activeIdx
    ? swatchByCell.get(`${activeIdx.row}|${activeIdx.col}`) ?? null
    : null;
  const activeValidationCell =
    activeIdx && validationByCell
      ? validationByCell.get(`${activeIdx.row}|${activeIdx.col}`) ?? null
      : null;

  function pointerCell(clientX: number, clientY: number): PhysicalCell | null {
    const img = imgRef.current;
    if (!img) return null;
    const rect = displayedImageRect(img);
    if (!rect) return null;
    const { imgX, imgY } = viewportToImagePx(layout, rect, clientX, clientY);
    return imagePxToCell(layout, imgX, imgY);
  }

  function handlePointerMove(e: React.PointerEvent) {
    // Mouse moves track the cursor; touch / pen events go through
    // the click path so we don't dance the tooltip on a tap.
    if (e.pointerType !== "mouse") return;
    setHoverCell(pointerCell(e.clientX, e.clientY));
    setPointerPos({ x: e.clientX, y: e.clientY });
  }

  function handlePointerLeave() {
    setHoverCell(null);
    setPointerPos(null);
  }

  function handleClick(e: React.MouseEvent) {
    const cell = pointerCell(e.clientX, e.clientY);
    if (!cell) {
      // Tap-outside-grid clears the sticky tooltip on touch devices.
      setStickyCell(null);
      return;
    }
    const idx = resolveSwatchIndex(layout, cell, spec.x_steps);
    if (!idx) return;
    const swatch = swatchByCell.get(`${idx.row}|${idx.col}`);
    if (!swatch) return;
    // Mouse click → hand off to the dialog and DON'T pin a sticky
    // cell. The dialog owns the highlight while it's open; once it
    // closes, hover takes over again. (The previous behaviour set
    // stickyCell unconditionally, so closing the modal left the old
    // cell highlighted and blocked hover on every other cell.)
    //
    // Touch / pen → no modal hand-off; pin the tooltip locally so
    // the user can read values without their finger covering the cell.
    // The "Inspect" button inside the pinned tooltip is what opens
    // the dialog on touch.
    const isMouse =
      e.detail !== 0 && (e.nativeEvent as PointerEvent).pointerType === "mouse";
    if (isMouse) {
      onCellClick(idx.row, idx.col);
    } else {
      setStickyCell(cell);
      setPointerPos({ x: e.clientX, y: e.clientY });
    }
  }

  // Highlight rect — image-pixel coords scaled to the displayed image
  // rect (which respects object-contain letterboxing) and offset
  // back into the container's coordinate system.
  const highlightStyle = useMemo<React.CSSProperties | null>(() => {
    if (!activeCell || !imgRef.current || !containerRef.current) return null;
    const img = imgRef.current;
    const dispRect = displayedImageRect(img);
    if (!dispRect) return null;
    const containerRect = containerRef.current.getBoundingClientRect();
    const cellRect = cellRectInImagePx(layout, activeCell);
    const sx = dispRect.width / layout.image_width_px;
    const sy = dispRect.height / layout.image_height_px;
    return {
      left: dispRect.left - containerRect.left + cellRect.left * sx,
      top: dispRect.top - containerRect.top + cellRect.top * sy,
      width: cellRect.width * sx,
      height: cellRect.height * sy,
    };
  }, [activeCell, layout]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full select-none"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    >
      <img
        ref={imgRef}
        src={imageUrl}
        alt={imageAlt ?? "Warped result image"}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        draggable={false}
      />

      <AxisOverlay layout={layout} spec={spec} kind={kind} />

      {highlightStyle && (
        <div
          aria-hidden
          className="absolute pointer-events-none border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={highlightStyle}
        />
      )}

      {activeSwatch && pointerPos && containerRef.current && (
        <CellTooltip
          swatch={activeSwatch}
          spec={spec}
          validationCell={activeValidationCell}
          containerRect={containerRef.current.getBoundingClientRect()}
          anchor={pointerPos}
          onInspect={
            stickyCell !== null
              ? () => onCellClick(activeSwatch.row, activeSwatch.col)
              : undefined
          }
        />
      )}
    </div>
  );
}

function AxisOverlay({
  layout, spec, kind,
}: {
  layout: GridLayout; spec: TestSpec; kind?: "sweep" | "validation";
}) {
  // SVG that overlays the image with viewBox = image-pixel space.
  // The image and SVG share the same parent, so the SVG scales to
  // fit identically — no manual scale math needed for the labels.
  //
  // Validation tests skip x-axis labels: every cell carries its own
  // params (the source-sweep's x_min/x_max/x_steps are inherited but
  // meaningless), so paramValueAt's interpolation produces nonsense.
  // The y-axis row indices stay — they orient the user inside the
  // wrapped grid even without a swept axis.
  const isValidation = kind === "validation";
  return (
    <svg
      aria-hidden
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${layout.image_width_px} ${layout.image_height_px}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <YAxisLabels layout={layout} spec={spec} />
      {!isValidation && <XAxisLabels layout={layout} spec={spec} />}
    </svg>
  );
}

function XAxisLabels({ layout, spec }: { layout: GridLayout; spec: TestSpec }) {
  // Cap label size so labels don't overlap on dense X axes (20+ cells).
  const labelSize = Math.max(7, Math.min(layout.cell_width_px * 0.55, 14));
  // Skip every Nth label when the cells are too narrow for the label glyph
  // run — keeps labels readable instead of mashed together. Each label is
  // roughly 0.6× labelSize per char × 4 chars wide.
  const labelRunPx = labelSize * 0.6 * 4;
  const stride = Math.max(1, Math.ceil(labelRunPx / layout.cell_width_px));
  const lines: React.ReactElement[] = [];

  // Per-physical-row x-axis for 1D wrapped (each row's slice is its own
  // axis). For 2D, just one strip below the bottom-most row.
  const rowsToLabel = layout.is_2d
    ? [layout.physical_rows - 1]
    : Array.from({ length: layout.physical_rows }, (_, i) => i);

  for (const prow of rowsToLabel) {
    const rowTop = layout.grid_origin_y_px + prow * layout.row_stride_px;
    const labelY = rowTop + layout.cell_height_px + labelSize * 1.1;
    for (let pcol = 0; pcol < layout.cells_per_physical_row; pcol++) {
      // Stride-skip — but always keep first & last in the row for range bounds.
      const isFirstOrLast =
        pcol === 0 || pcol === layout.cells_per_physical_row - 1;
      if (!isFirstOrLast && pcol % stride !== 0) continue;
      const flatCol = layout.is_2d
        ? pcol
        : prow * layout.cells_per_physical_row + pcol;
      if (!layout.is_2d && flatCol >= spec.x_steps) continue;
      const xVal = paramValueAt(spec.x_min, spec.x_max, spec.x_steps, flatCol);
      const labelX =
        layout.grid_origin_x_px + (pcol + 0.5) * layout.cell_width_px;
      lines.push(
        <text
          key={`x-${prow}-${pcol}`}
          x={labelX}
          y={labelY}
          textAnchor="middle"
          fontSize={labelSize}
          fontFamily="JetBrains Mono, monospace"
          fill="rgba(0,0,0,0.85)"
          stroke="white"
          strokeWidth={Math.max(1, labelSize * 0.22)}
          paintOrder="stroke"
        >
          {formatParamValue(spec.x_param, xVal)}
        </text>,
      );
    }
  }
  return <g>{lines}</g>;
}

function YAxisLabels({ layout, spec }: { layout: GridLayout; spec: TestSpec }) {
  const labelSize = Math.max(7, Math.min(layout.cell_height_px * 0.55, 14));
  const lines: React.ReactElement[] = [];
  // Stride-skip when cell heights are tight (2D with 14+ rows).
  const labelRunPx = labelSize * 1.4;
  const stride = Math.max(1, Math.ceil(labelRunPx / layout.row_stride_px));
  for (let prow = 0; prow < layout.physical_rows; prow++) {
    const isFirstOrLast =
      prow === 0 || prow === layout.physical_rows - 1;
    if (!isFirstOrLast && prow % stride !== 0) continue;
    const rowTop = layout.grid_origin_y_px + prow * layout.row_stride_px;
    const labelY = rowTop + layout.cell_height_px / 2 + labelSize / 3;
    const labelX = layout.grid_origin_x_px - labelSize * 0.4;
    let text: string;
    if (layout.is_2d) {
      const yVal = paramValueAt(
        spec.y_min ?? 0, spec.y_max ?? 0, spec.y_steps ?? 1, prow,
      );
      text = formatParamValue(spec.y_param ?? "", yVal);
    } else {
      // 1D: row index keeps the gutter labelled but doesn't pretend
      // there's a y-param.
      text = `${prow}`;
    }
    lines.push(
      <text
        key={`y-${prow}`}
        x={labelX}
        y={labelY}
        textAnchor="end"
        fontSize={labelSize}
        fontFamily="JetBrains Mono, monospace"
        fill="rgba(0,0,0,0.85)"
        stroke="white"
        strokeWidth={Math.max(1, labelSize * 0.18)}
        paintOrder="stroke"
      >
        {text}
      </text>,
    );
  }
  return <g>{lines}</g>;
}

function paramValueAt(min: number, max: number, steps: number, idx: number): number {
  if (steps <= 1) return min;
  return min + ((max - min) * idx) / (steps - 1);
}

function formatParamValue(param: string, value: number): string {
  // Integer params get integer formatting; floats get a single decimal
  // unless the value is already integer-looking. Truncation at 5
  // characters keeps labels from overlapping on tight grids.
  const isIntParam = ["passes", "frequency", "speed", "density"].includes(param);
  if (isIntParam) return `${Math.round(value)}`;
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(1);
}

// The seven keys we surface in the tooltip for validation cells, in
// the order operators read them off the workbench. Anything else in
// the cell's params dict (e.g. `mode`, `laser`, `crosshatch`) is
// either redundant or already implied by the test, so showing it
// would crowd the tooltip without adding signal.
const _VALIDATION_PARAM_ORDER: readonly string[] = [
  "power", "speed", "frequency", "density", "passes",
  "pulse_width", "scan_angle",
] as const;
const _PARAM_LABEL: Readonly<Record<string, string>> = {
  power: "P", speed: "S", frequency: "F", density: "L",
  passes: "x", pulse_width: "PW", scan_angle: "θ",
};

function _formatValidationParam(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return `${_PARAM_LABEL[key] ?? key}${value}`;
  if (key === "power") return `${_PARAM_LABEL[key]}${num.toFixed(1)}%`;
  if (key === "frequency") return `${_PARAM_LABEL[key]}${Math.round(num)}kHz`;
  if (key === "pulse_width") return `${_PARAM_LABEL[key]}${Math.round(num)}ns`;
  if (key === "scan_angle") return `${_PARAM_LABEL[key]}${Math.round(num)}°`;
  // speed / density / passes — integer.
  return `${_PARAM_LABEL[key] ?? key}${Math.round(num)}`;
}

function _deltaE76(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

function CellTooltip({
  swatch, spec,
  validationCell,
  containerRect, anchor,
  onInspect,
}: {
  swatch: ResultSwatch;
  spec: TestSpec;
  validationCell: ValidationCell | null;
  containerRect: DOMRect;
  anchor: { x: number; y: number };
  onInspect?: () => void;
}) {
  const isValidation = validationCell !== null;

  // Edge-aware positioning: prefer right + below, flip on overflow.
  // Validation tooltip is wider so the param row + expected/actual
  // colour row both fit on a single line each.
  const TOOLTIP_W = isValidation ? 280 : 220;
  // Height is dynamic; the picker just needs a reasonable upper bound
  // for the flip-on-overflow heuristic.
  const TOOLTIP_H = isValidation
    ? (onInspect ? 188 : 160)
    : (onInspect ? 138 : 110);
  let left = anchor.x - containerRect.left + 14;
  let top = anchor.y - containerRect.top + 14;
  if (left + TOOLTIP_W > containerRect.width) {
    left = anchor.x - containerRect.left - TOOLTIP_W - 14;
  }
  if (top + TOOLTIP_H > containerRect.height) {
    top = anchor.y - containerRect.top - TOOLTIP_H - 14;
  }
  left = Math.max(4, left);
  top = Math.max(4, top);

  const labText = swatch.lab.map((v) => v.toFixed(0)).join(" / ");

  // ── Validation-mode body ────────────────────────────────────────────
  // Tooltip swaps the bogus swept-axis label out for the cell's actual
  // params (the values the burn was made with) plus an expected vs.
  // actual chip pair so the user can see the colour delta at a glance.
  if (isValidation && validationCell) {
    const paramTokens = _VALIDATION_PARAM_ORDER
      .map((k) => _formatValidationParam(k, validationCell.params[k]))
      .filter((t): t is string => t !== null);
    const expectedHex = validationCell.expected_hex;
    const expectedLab = validationCell.expected_lab as
      [number, number, number] | undefined;
    const actualLab = swatch.lab as [number, number, number];
    const dE = expectedLab !== undefined && expectedLab.length === 3
      ? _deltaE76(expectedLab, actualLab)
      : null;

    return (
      <div
        role="tooltip"
        className="absolute z-10 rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] shadow-lg p-2.5 pointer-events-auto"
        style={{ left, top, width: TOOLTIP_W }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — cell index + small mono identifier. */}
        <div className="flex items-baseline justify-between mb-2">
          <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
            cell #{validationCell.cell_index}
          </div>
          <div className="font-mono text-[10px] text-[color:var(--color-ink-subtle)]">
            r{swatch.row}·c{swatch.col}
          </div>
        </div>

        {/* Expected vs. actual chips with ΔE between them. */}
        <div className="flex items-center gap-2 mb-2.5">
          <div className="flex flex-col items-center gap-1">
            <div
              aria-hidden
              className="h-9 w-9 rounded-[3px] border border-[color:var(--color-border-strong)]"
              style={{ backgroundColor: expectedHex }}
            />
            <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
              expected
            </div>
            <div className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">
              {expectedHex}
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
              {dE !== null ? "ΔE76" : "—"}
            </div>
            <div className="font-mono text-[14px] font-semibold tabular-nums text-[color:var(--color-ink)]">
              {dE !== null ? dE.toFixed(1) : "—"}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div
              aria-hidden
              className="h-9 w-9 rounded-[3px] border border-[color:var(--color-border-strong)]"
              style={{ backgroundColor: swatch.hex }}
            />
            <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
              actual
            </div>
            <div className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">
              {swatch.hex}
            </div>
          </div>
        </div>

        {/* Per-cell params — the values that actually drove this burn. */}
        <div className="font-mono text-[10.5px] tabular-nums leading-relaxed text-[color:var(--color-ink)] break-words">
          {paramTokens.join(" · ")}
        </div>
        <div className="font-mono text-[10px] leading-tight text-[color:var(--color-ink-subtle)] mt-1">
          σ {swatch.sigma.toFixed(2)} · Lab {labText}
        </div>

        {onInspect && (
          <button
            type="button"
            onClick={onInspect}
            className="mt-2 w-full text-[11px] font-mono uppercase tracking-[0.1em] py-1 rounded-[4px] bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary-tint)]"
          >
            Inspect →
          </button>
        )}
      </div>
    );
  }

  // ── Sweep-mode body (original) ───────────────────────────────────────
  const xLabel = `${spec.x_param} = ${formatParamValue(spec.x_param, swatch.x_value)}`;
  const yLabel = swatch.y_value !== null && spec.y_param
    ? `${spec.y_param} = ${formatParamValue(spec.y_param, swatch.y_value)}`
    : null;

  return (
    <div
      role="tooltip"
      className="absolute z-10 rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] shadow-lg p-2 pointer-events-auto"
      style={{ left, top, width: TOOLTIP_W }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div
          aria-hidden
          className="h-7 w-7 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
          style={{ backgroundColor: swatch.hex }}
        />
        <div className="font-mono text-[11px] leading-tight text-[color:var(--color-ink)]">
          <div className="font-semibold">
            row {swatch.row} · col {swatch.col}
          </div>
          <div className="text-[color:var(--color-ink-muted)]">{swatch.hex}</div>
        </div>
      </div>
      <div className="font-mono text-[11px] leading-tight text-[color:var(--color-ink-muted)] mb-1">
        {xLabel}
      </div>
      {yLabel && (
        <div className="font-mono text-[11px] leading-tight text-[color:var(--color-ink-muted)] mb-1">
          {yLabel}
        </div>
      )}
      <div className="font-mono text-[10.5px] leading-tight text-[color:var(--color-ink-subtle)]">
        σ {swatch.sigma.toFixed(2)} · Lab {labText}
      </div>
      {onInspect && (
        <button
          type="button"
          onClick={onInspect}
          className="mt-2 w-full text-[11px] font-mono uppercase tracking-[0.1em] py-1 rounded-[4px] bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary-tint)]"
        >
          Inspect →
        </button>
      )}
    </div>
  );
}
