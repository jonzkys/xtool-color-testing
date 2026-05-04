import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ExternalLink, X } from "lucide-react";
import type { Lab } from "../color/math";
import type { GridLayout, ResultRecord, TestRecord } from "../types";
import { cn, MetalBar } from "../ui";
import {
  computePerResultStats, signedNum,
  type PerResultStats, type StatsSeriesEntry,
} from "./stabilityStatsMath";
import { cellRectInImagePx } from "./cellInspectorMath";

interface ResultModalProps {
  open: boolean;
  /** Active result (carries swatches → all stats derive). */
  result: ResultRecord | null;
  /** Carries cells_per_row + validation cells for stats; provides the
   *  test id used by the OPEN ⤴ deep link. */
  test: TestRecord;
  /** When set, render a primary-tinted box around this cell on the
   *  warped image (with a dimmed mask outside) so the user can spot
   *  where on the print the focused cell lives. ``null`` = no
   *  highlight. */
  highlightCellIndex?: number | null;
  /** Required to compute (row, col) from ``cell_index`` for the
   *  highlight. ``null`` skips the overlay. */
  cellsPerRow?: number | null;
  onClose: () => void;
}

/**
 * Per-result drilldown modal. Pairs the warped photograph with the
 * same stat fields the right-strip card shows, just larger and with a
 * deep link to the test detail page so the user can drill further.
 * Reuses ``computePerResultStats`` so the strip and modal never
 * disagree.
 */
export function StabilityResultModal({
  open,
  result,
  test,
  highlightCellIndex,
  cellsPerRow,
  onClose,
}: ResultModalProps) {
  return (
    <DialogPrimitive.Root open={open && result != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(
          "fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        )} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
            "border border-[color:var(--color-border)] rounded-[12px] shadow-[var(--shadow-popover)] overflow-hidden",
            "w-[min(960px,calc(100vw-2rem))] h-[min(600px,calc(100vh-2rem))]",
            "flex flex-col focus:outline-none",
          )}
        >
          {result ? (
            <ModalBody
              result={result}
              test={test}
              highlightCellIndex={highlightCellIndex ?? null}
              cellsPerRow={cellsPerRow ?? null}
              onClose={onClose}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ModalBody({
  result,
  test,
  highlightCellIndex,
  cellsPerRow,
  onClose,
}: {
  result: ResultRecord;
  test: TestRecord;
  highlightCellIndex: number | null;
  cellsPerRow: number | null;
  onClose: () => void;
}) {
  const stat = useMemo(
    () => computePerResultStats(test.validation_cells, buildSeriesEntry(test, result)),
    [test, result],
  );
  return (
    <>
      <Header result={result} test={test} stat={stat} onClose={onClose} />
      <MetalBar variant="soft" />
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_240px]">
        <ImagePane
          result={result}
          highlightCellIndex={highlightCellIndex}
          cellsPerRow={cellsPerRow}
        />
        <StatPane result={result} stat={stat} />
      </div>
    </>
  );
}

/* ─── Header ───────────────────────────────────────────────────────────── */

function Header({
  result, test, stat, onClose,
}: { result: ResultRecord; test: TestRecord; stat: PerResultStats; onClose: () => void }) {
  return (
    <header className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-[color:var(--color-surface-elevated)]">
      <DialogPrimitive.Title className="font-mono text-[11px] tabular-nums tracking-[0.16em] uppercase font-semibold text-[color:var(--color-ink)] truncate">
        Result #{result.id}<Sep />
        <span className="text-[color:var(--color-ink-muted)]">{shortStamp(result.uploaded_at)}</span><Sep />
        <span className="text-[color:var(--color-ink-muted)]">{stat.sampleCount}/{stat.totalCells} cells</span>
      </DialogPrimitive.Title>
      <div className="flex-1" />
      <a
        href={`#/tests/${test.id}`}
        onClick={onClose}
        title={`Open test #${test.id} detail page`}
        className={cn(
          "inline-flex items-center gap-1 shrink-0",
          "font-mono text-[10px] tracking-[0.18em] uppercase font-semibold",
          "px-2 py-1 rounded-[3px] border border-[color:var(--color-primary)]/40 text-[color:var(--color-primary)]",
          "hover:bg-[color:var(--color-primary)]/10 transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60",
        )}
      >
        Open<ExternalLink className="h-3 w-3" strokeWidth={2.25} />
      </a>
      <button
        type="button" onClick={onClose} aria-label="Close" title="Close (Esc)"
        className={cn(
          "shrink-0 rounded-[3px] h-6 w-6 inline-flex items-center justify-center",
          "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
          "hover:bg-[color:var(--color-border)]/40 transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60",
        )}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </header>
  );
}

const Sep = () => <span className="mx-2 text-[color:var(--color-border-strong)]">·</span>;

/* ─── Image pane ───────────────────────────────────────────────────────── */

function ImagePane({
  result,
  highlightCellIndex,
  cellsPerRow,
}: {
  result: ResultRecord;
  highlightCellIndex: number | null;
  cellsPerRow: number | null;
}) {
  const { blobUrl, status } = useWarpedImage(result.id);
  // Lazy grid layout fetch — only fired when we actually need to draw
  // the highlight overlay. Stays cached across opens because the
  // modal's React tree unmounts on close, but if it stayed mounted the
  // dependency on result.id would re-fetch.
  const [layout, setLayout] = useState<GridLayout | null>(null);
  useEffect(() => {
    if (highlightCellIndex == null || cellsPerRow == null) return;
    let cancelled = false;
    setLayout(null);
    (async () => {
      try {
        const { getGridLayout } = await import("../api/results");
        const l = await getGridLayout(result.id);
        if (!cancelled) setLayout(l);
      } catch {
        if (!cancelled) setLayout(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result.id, highlightCellIndex, cellsPerRow]);

  return (
    <div className="relative bg-[color:var(--color-substrate)] border-r border-[color:var(--color-border)] overflow-hidden">
      {status === "ok" && blobUrl != null && (
        <>
          <img
            src={blobUrl}
            alt={`Rectified burn-space view of result #${result.id}`}
            className="absolute inset-0 w-full h-full object-contain"
          />
          {highlightCellIndex != null &&
            cellsPerRow != null &&
            cellsPerRow > 0 &&
            layout != null && (
              <CellHighlightOverlay
                layout={layout}
                cellsPerRow={cellsPerRow}
                cellIndex={highlightCellIndex}
              />
            )}
        </>
      )}
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] animate-pulse">
            loading photo…
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            warped photo not available
          </div>
          {result.image_url && (
            <a
              href={result.image_url} target="_blank" rel="noreferrer"
              className="font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-primary)] hover:underline underline-offset-2"
            >
              open original
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Primary-tinted box around the focused cell on the warped image,
 *  with a 32% black mask outside so the cell pops. The overlay shares
 *  the image's viewBox so its placement tracks ``object-contain``
 *  letterboxing exactly — no separate <img> rect math required. A
 *  tiny "FOCUSED · #N" label hugs the box's top-right corner; it
 *  flips to the inside of the rect when there isn't room outside. */
function CellHighlightOverlay({
  layout,
  cellsPerRow,
  cellIndex,
}: {
  layout: GridLayout;
  cellsPerRow: number;
  cellIndex: number;
}) {
  const physicalRow = Math.floor(cellIndex / cellsPerRow);
  const displayedCol = cellIndex % cellsPerRow;
  const rect = cellRectInImagePx(layout, { physicalRow, displayedCol });
  const imgW = layout.image_width_px;
  const imgH = layout.image_height_px;
  // Visually-tuned strokes; image-pixel dimensions can be 1000+ px so
  // a 1 px stroke would render as a hairline at modal-fit scale.
  const stroke = Math.max(3, Math.min(imgW, imgH) / 180);
  const labelFontPx = Math.max(11, Math.min(imgW, imgH) / 75);
  const labelTextX = rect.left + rect.width / 2;
  // Place the caption above the box if there's room; otherwise tuck
  // it just below the bottom edge.
  const labelAbove = rect.top - labelFontPx * 1.6 > 0;
  const labelTextY = labelAbove
    ? rect.top - labelFontPx * 0.6
    : rect.top + rect.height + labelFontPx * 1.2;
  return (
    <svg
      viewBox={`0 0 ${imgW} ${imgH}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    >
      {/* Even-odd fill: outer rect minus the cell rect → ring-shaped
          dimmer that sells the highlight without obscuring the cell
          itself. */}
      <path
        d={`M0 0 H${imgW} V${imgH} H0 Z M${rect.left} ${rect.top} V${rect.top + rect.height} H${rect.left + rect.width} V${rect.top} Z`}
        fillRule="evenodd"
        fill="rgba(0,0,0,0.42)"
      />
      <rect
        x={rect.left}
        y={rect.top}
        width={rect.width}
        height={rect.height}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={stroke}
      />
      <text
        x={labelTextX}
        y={labelTextY}
        textAnchor="middle"
        fill="var(--color-primary)"
        style={{
          font: `600 ${labelFontPx}px var(--font-mono)`,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          paintOrder: "stroke fill",
          stroke: "rgba(0,0,0,0.45)",
          strokeWidth: Math.max(3, labelFontPx / 4),
          strokeLinejoin: "round",
        }}
      >
        Focused · #{cellIndex}
      </text>
    </svg>
  );
}

/* ─── Stat pane ────────────────────────────────────────────────────────── */

function StatPane({ result, stat }: { result: ResultRecord; stat: PerResultStats }) {
  return (
    <div className="overflow-y-auto p-4 flex flex-col gap-4 bg-[color:var(--color-surface)]">
      {stat.sampleCount === 0 ? (
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] text-center py-6">
          No matched cells
        </div>
      ) : (
        <>
          <Group label="Mean Δ">
            <NumLine label="ΔL" value={signedNum(stat.meanDeltaL)} />
            <NumLine label="Δa" value={signedNum(stat.meanDeltaA)} />
            <NumLine label="Δb" value={signedNum(stat.meanDeltaB)} />
          </Group>
          <Group label="Median ΔE"><BigValue value={stat.medianDeltaE.toFixed(2)} /></Group>
          <Group label="Max ΔE">
            <BigValue value={stat.maxDeltaE.toFixed(2)} />
            {stat.worstCellIndex != null && (
              <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)]">
                cell #{stat.worstCellIndex}
              </div>
            )}
          </Group>
          <Group label="Δh° mean"><BigValue value={`${signedNum(stat.meanDeltaHue, 1)}°`} /></Group>
        </>
      )}
      <div className="mt-auto pt-3 border-t border-[color:var(--color-border)]/60">
        <Label>Photographed</Label>
        <div className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)]">
          {longStamp(result.uploaded_at)}
        </div>
      </div>
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="font-mono text-[9px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] mb-1">{children}</div>
);

const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><Label>{label}</Label>{children}</div>
);

const NumLine = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-muted)] w-7">{label}</span>
    <span className="font-mono text-[14px] tabular-nums text-[color:var(--color-ink)]">{value}</span>
  </div>
);

const BigValue = ({ value }: { value: string }) => (
  <div className="font-mono text-[18px] tabular-nums text-[color:var(--color-ink)] font-semibold leading-none">{value}</div>
);

/* ─── Image fetch hook ─────────────────────────────────────────────────── */

type ImageStatus = "loading" | "ok" | "error";

/** Distinguishes loading vs error (the shared ``useAuthedImage`` returns
 *  null for both). Stable Object URL, cleaned up on unmount / id change. */
function useWarpedImage(rid: number): { blobUrl: string | null; status: ImageStatus } {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ImageStatus>("loading");
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setStatus("loading");
    setBlobUrl(null);
    fetch(`/api/results/${rid}/warped-image`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
        setStatus("ok");
      })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created); };
  }, [rid]);
  return { blobUrl, status };
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function buildSeriesEntry(test: TestRecord, result: ResultRecord): StatsSeriesEntry {
  const cellsPerRow = inferCellsPerRow(test);
  const cells = new Map<number, { hex: string; lab: Lab }>();
  if (cellsPerRow != null) {
    for (const sw of result.swatches) {
      if (!Array.isArray(sw.lab) || sw.lab.length !== 3) continue;
      cells.set(sw.row * cellsPerRow + sw.col, {
        hex: sw.hex,
        lab: [sw.lab[0], sw.lab[1], sw.lab[2]],
      });
    }
  }
  return { result, cells, label: shortStamp(result.uploaded_at) };
}

/** Mirror of ``StabilityPage.inferCellsPerRow`` — re-derived locally so
 *  the modal doesn't need yet another threaded prop. */
function inferCellsPerRow(t: TestRecord): number | null {
  const direct = t.spec.cells_per_row;
  if (direct != null && direct > 0) return direct;
  const xs = t.spec.x_steps;
  const rows = Math.max(1, t.spec.rows);
  if (xs > 0 && rows > 0) return Math.ceil(xs / rows);
  return null;
}

function shortStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${time}`;
}

function longStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // ISO-ish UTC stamp — calmer to read than a locale string and keeps
  // the modal's "instrument readout" register.
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}
