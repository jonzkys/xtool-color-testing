import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  MetalBar,
  cn,
} from "../ui";
import type { InspectCellResponse, SampleAggregator } from "../types";
import { inspectCell } from "../api/results";

/**
 * InspectMatchDialog — "specimen examination chamber"
 *
 * The visual conceit: this modal is the lab-tray for one cell. The
 * left panel shows the specimen as captured (the cell crop straight
 * from the warped image). The right panel shows the same specimen
 * with the sampling iris drawn over it — a precision overlay marking
 * exactly which pixels were chosen. Below sits a five-position colour
 * tray comparing every aggregator side-by-side.
 *
 * Each tile in the tray reports both its own colour AND its delta in
 * L* from the active aggregator — turning the strip from a swatch row
 * into an actual comparison instrument. Click a tile to switch the
 * underlying result-detail dialog over to that aggregator.
 *
 * Aesthetic register: same JetBrains Mono numerics + tracking-tight
 * uppercase labels + dark-substrate mat with corner crop marks as the
 * parent ResultDetailDialog. Workshop instrument all the way down.
 */

const AGGREGATOR_LABELS: Record<SampleAggregator, string> = {
  median: "Median",
  mean: "Mean",
  saturation_median: "Sat. median",
  trimmed_mean: "Trimmed mean",
  kmeans_dominant: "K-means dominant",
};

const AGGREGATOR_ORDER: SampleAggregator[] = [
  "median",
  "mean",
  "saturation_median",
  "trimmed_mean",
  "kmeans_dominant",
];

export interface InspectMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rid: number;
  row: number;
  col: number;
  currentAggregator: SampleAggregator;
  /** Called when the user clicks a tile in the comparison tray.
   * Parent typically closes the modal and switches its preview to the
   * picked aggregator. */
  onAggregatorPicked: (agg: SampleAggregator) => void;
}

export function InspectMatchDialog(props: InspectMatchDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <InspectBody {...props} />}
    </Dialog>
  );
}

function InspectBody({
  rid,
  row,
  col,
  currentAggregator,
  onAggregatorPicked,
}: InspectMatchDialogProps) {
  const [data, setData] = useState<InspectCellResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const resp = await inspectCell(rid, row, col);
        if (!cancelled) setData(resp);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rid, row, col]);

  return (
    <DialogContent
      width="lg"
      className="p-0 overflow-hidden max-w-[860px] max-h-[92vh] flex flex-col"
      aria-describedby={undefined}
    >
      <DialogTitle className="sr-only">
        Inspect cell · row {row} · column {col}
      </DialogTitle>

      <div className="flex-1 overflow-y-auto">
        {/* === HEADER STRIP — instrument readouts ============================ */}
        <Header
          row={row}
          col={col}
          xValue={data?.x_value}
          yValue={data?.y_value ?? null}
          sigma={data?.sigma}
          activeAggregator={currentAggregator}
        />

        <MetalBar />

        {/* === BODY ========================================================== */}
        {error && (
          <div className="px-6 py-10 text-center">
            <div
              className={cn(
                "inline-flex items-start gap-2 px-3 py-2 rounded-[6px]",
                "border border-[color:var(--color-warning)]/40",
                "bg-[color:var(--color-warning-tint)]",
                "text-[color:var(--color-warning)] text-[12.5px] leading-snug",
              )}
            >
              <span>Couldn't inspect this cell: {error}</span>
            </div>
          </div>
        )}

        {!error && !data && (
          <div className="px-6 py-16 flex items-center justify-center">
            <Spinner />
          </div>
        )}

        {data && (
          <>
            {/* === SPECIMEN PAIR ========================================== */}
            <SpecimenPanel data={data} />

            <MetalBar variant="soft" />

            {/* === AGGREGATOR TRAY ======================================== */}
            <AggregatorTray
              data={data}
              currentAggregator={currentAggregator}
              onAggregatorPicked={onAggregatorPicked}
            />
          </>
        )}
      </div>

      {/* Floating close — same blend-difference treatment as ResultDetailDialog */}
      <DialogClose
        aria-label="Close"
        className="absolute top-3 right-3 h-7 w-7 inline-flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60 text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] transition-colors"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </DialogClose>
    </DialogContent>
  );
}

// ============================================================================
// Header
// ============================================================================

function Header({
  row,
  col,
  xValue,
  yValue,
  sigma,
  activeAggregator,
}: {
  row: number;
  col: number;
  xValue?: number;
  yValue?: number | null;
  sigma?: number;
  activeAggregator: SampleAggregator;
}) {
  return (
    <div className="bg-[color:var(--color-surface-elevated)]">
      {/* Title row — small, monospaced, drives the workshop register */}
      <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] tracking-[0.24em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
            Inspect · cell
          </span>
          <span className="font-mono text-[15px] tabular-nums tracking-tight text-[color:var(--color-ink)]">
            {row}, {col}
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
          showing&nbsp;·&nbsp;
          <span className="text-[color:var(--color-primary)] font-semibold">
            {AGGREGATOR_LABELS[activeAggregator]}
          </span>
        </span>
      </div>

      {/* Readout strip — mirrors ReadoutCell rhythm in the parent */}
      <div className="grid grid-cols-3 divide-x divide-[color:var(--color-border)] border-t border-[color:var(--color-border)]">
        <ReadoutCell
          label="X"
          value={xValue == null ? "—" : fmt(xValue)}
        />
        <ReadoutCell
          label="Y"
          value={yValue == null ? "—" : fmt(yValue)}
        />
        <ReadoutCell
          label="σ"
          value={sigma == null ? "—" : sigma.toFixed(2)}
        />
      </div>
    </div>
  );
}

function ReadoutCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <div className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[13px] tabular-nums text-[color:var(--color-ink)]">
        {value}
      </div>
    </div>
  );
}

// ============================================================================
// Specimen pair — left: raw crop. right: crop with sampling iris.
// ============================================================================

function SpecimenPanel({ data }: { data: InspectCellResponse }) {
  const src = `data:image/png;base64,${data.cell_image_b64}`;
  const region = data.sampling_region;

  // Geometry caption — matches the metric register elsewhere in the app.
  const geometryCaption =
    region.shape === "circle"
      ? `Ø ${Math.round((region.radius_px ?? 0) * 2)} px`
      : `▢ ${Math.round((region.half_w_px ?? 0) * 2)} × ${Math.round((region.half_h_px ?? 0) * 2)} px`;

  return (
    <div className="grid grid-cols-2 gap-px bg-[color:var(--color-border)]">
      <SpecimenSlot
        title="Cell crop"
        annotation="raw"
        src={src}
      />
      <SpecimenSlot
        title="Sampling region"
        annotation={geometryCaption}
        src={src}
        overlay={<SamplingOverlay region={region} />}
      />
    </div>
  );
}

function SpecimenSlot({
  title,
  annotation,
  src,
  overlay,
}: {
  title: string;
  annotation: string;
  src: string;
  overlay?: React.ReactNode;
}) {
  return (
    <div className="bg-[color:var(--color-surface)] px-5 pt-4 pb-5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          {title}
        </span>
        <span className="font-mono text-[10px] tabular-nums tracking-[0.06em] text-[color:var(--color-ink-muted)]">
          {annotation}
        </span>
      </div>

      {/* Substrate mat with corner ticks, mirroring the parent's hero treatment */}
      <div className="relative mt-3 aspect-square rounded-[4px] overflow-hidden bg-[color:var(--color-substrate)]">
        <img
          src={src}
          alt={title}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ imageRendering: "pixelated" }}
        />

        {/* Sampling iris overlay (right slot only) */}
        {overlay && (
          <div className="absolute inset-0 pointer-events-none">{overlay}</div>
        )}

        {/* Fine grain overlay — same noise motif as the parent */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />

        <TickMark corner="tl" />
        <TickMark corner="tr" />
        <TickMark corner="bl" />
        <TickMark corner="br" />
      </div>
    </div>
  );
}

function SamplingOverlay({
  region,
}: {
  region: InspectCellResponse["sampling_region"];
}) {
  // The crop's natural dimensions aren't passed in — use the center to
  // derive a viewBox by assuming square aspect. The image is rendered
  // object-contain inside an aspect-square container, so we draw at the
  // natural pixel coordinates of the crop and let preserveAspectRatio
  // scale the SVG to match.
  // We don't know the crop's exact width/height, but the center_px is
  // the cell centre in crop-local coords. A conservative viewBox is
  // 2 × max(center_px) so the iris fits.
  const w = Math.max(region.center_px[0] * 2, 1);
  const h = Math.max(region.center_px[1] * 2, 1);
  const cx = region.center_px[0];
  const cy = region.center_px[1];

  const stroke = "var(--color-warning)";
  const strokeWidth = Math.max(w, h) * 0.012; // scales with crop size
  const dash = `${strokeWidth * 4} ${strokeWidth * 3}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 w-full h-full"
      aria-hidden
    >
      {region.shape === "circle" && region.radius_px != null && (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={region.radius_px}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
          {/* Crosshair through the iris centre — gives the eye a focal anchor */}
          <line
            x1={cx - region.radius_px * 0.3}
            y1={cy}
            x2={cx + region.radius_px * 0.3}
            y2={cy}
            stroke={stroke}
            strokeWidth={strokeWidth * 0.6}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={cx}
            y1={cy - region.radius_px * 0.3}
            x2={cx}
            y2={cy + region.radius_px * 0.3}
            stroke={stroke}
            strokeWidth={strokeWidth * 0.6}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      {region.shape === "rect" &&
        region.half_w_px != null &&
        region.half_h_px != null && (
          <rect
            x={cx - region.half_w_px}
            y={cy - region.half_h_px}
            width={region.half_w_px * 2}
            height={region.half_h_px * 2}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
        )}
      {/* Cell-shape + sampling-fraction annotation in the upper-left of
          the iris area. The fraction comes from the backend so the
          label can't drift from the actual constant. */}
      <text
        x={4}
        y={12}
        fontSize={Math.max(w, h) * 0.04}
        fontFamily="JetBrains Mono, monospace"
        fill={stroke}
        opacity={0.85}
        letterSpacing={0.06}
      >
        {region.shape === "circle" ? "●" : "▢"} {region.fraction_label}
      </text>
    </svg>
  );
}

function TickMark({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const pos = {
    tl: "top-1.5 left-1.5",
    tr: "top-1.5 right-1.5",
    bl: "bottom-1.5 left-1.5",
    br: "bottom-1.5 right-1.5",
  }[corner];
  return (
    <div
      aria-hidden
      className={cn("absolute h-2.5 w-2.5 pointer-events-none", pos)}
      style={{ mixBlendMode: "difference" }}
    >
      <div
        className="absolute top-0 left-0 h-px w-full"
        style={{ background: "white" }}
      />
      <div
        className="absolute top-0 left-0 w-px h-full"
        style={{ background: "white" }}
      />
    </div>
  );
}

// ============================================================================
// Aggregator tray — five tiles + L* delta from the active one
// ============================================================================

function AggregatorTray({
  data,
  currentAggregator,
  onAggregatorPicked,
}: {
  data: InspectCellResponse;
  currentAggregator: SampleAggregator;
  onAggregatorPicked: (agg: SampleAggregator) => void;
}) {
  const activeHex = data.aggregator_results[currentAggregator];
  const activeL = perceivedLuminance(activeHex);

  return (
    <div className="px-5 pt-4 pb-5">
      <div className="flex items-baseline justify-between mb-3">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          Aggregator comparison
        </span>
        <span className="font-mono text-[10px] tracking-[0.06em] text-[color:var(--color-ink-muted)]">
          ΔL* shown vs.&nbsp;
          <span className="text-[color:var(--color-primary)]">
            {AGGREGATOR_LABELS[currentAggregator].toLowerCase()}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {AGGREGATOR_ORDER.map((name) => {
          const hex = data.aggregator_results[name];
          const isActive = name === currentAggregator;
          const dL = perceivedLuminance(hex) - activeL;
          return (
            <AggregatorTile
              key={name}
              name={name}
              hex={hex}
              dL={isActive ? null : dL}
              isActive={isActive}
              onClick={() => onAggregatorPicked(name)}
            />
          );
        })}
      </div>

      <p className="mt-3 font-mono text-[10px] tracking-[0.06em] text-[color:var(--color-ink-subtle)] leading-relaxed">
        Click any tile to preview that aggregator across the whole result.
      </p>
    </div>
  );
}

function AggregatorTile({
  name,
  hex,
  dL,
  isActive,
  onClick,
}: {
  name: SampleAggregator;
  hex: string;
  dL: number | null;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${AGGREGATOR_LABELS[name]} → ${hex}`}
      aria-label={`Switch to ${AGGREGATOR_LABELS[name]} (${hex})`}
      aria-pressed={isActive}
      className={cn(
        "group relative rounded-[5px] overflow-hidden text-left",
        "border transition-colors duration-150",
        isActive
          ? "border-[color:var(--color-primary)] shadow-[0_0_0_1px_var(--color-primary)]/30"
          : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]",
        "bg-[color:var(--color-surface-elevated)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/50",
      )}
    >
      {/* Colour chip — fills the upper portion */}
      <div
        className="relative h-16 w-full"
        style={{ backgroundColor: hex }}
      >
        {/* Active marker — small filled dot, top-right */}
        {isActive && (
          <span
            aria-hidden
            className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[color:var(--color-primary)] ring-2 ring-[color:var(--color-surface)]"
          />
        )}
        {/* Subtle vignette so chips with very light hexes still read as a chip */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.06) 100%)",
          }}
        />
      </div>

      {/* Caption strip */}
      <div className="px-2 pt-1.5 pb-2">
        <div className="font-mono text-[10.5px] tabular-nums tracking-tight text-[color:var(--color-ink)] uppercase">
          {hex}
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="font-mono text-[8.5px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)] truncate">
            {AGGREGATOR_LABELS[name]}
          </span>
          {dL != null && (
            <span
              className={cn(
                "font-mono text-[8.5px] tabular-nums tracking-tight shrink-0",
                Math.abs(dL) < 0.5
                  ? "text-[color:var(--color-ink-subtle)]"
                  : "text-[color:var(--color-ink-muted)]",
              )}
            >
              {dL > 0 ? "+" : ""}
              {dL.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function fmt(n: number): string {
  // Match the codebase's parameter-display register: integer for whole
  // numbers, 1 decimal otherwise.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function perceivedLuminance(hex: string): number {
  // Rec.601 perceived luminance, 0..100 range to feel like L*.
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * 100;
}

function Spinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="h-5 w-5 rounded-full border-2 border-[color:var(--color-border-strong)] border-t-[color:var(--color-primary)] animate-spin"
    />
  );
}
