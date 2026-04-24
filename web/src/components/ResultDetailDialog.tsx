import { X } from "lucide-react";
import { DialogClose } from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  MetalBar,
  cn,
} from "../ui";
import type { ResultRecord, ResultSwatch } from "../types";
import { useAuthedImage } from "../hooks/useAuthedImage";

export interface ResultDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ResultRecord | null;
}

/**
 * Detailed view of a single test-result upload. Mirrors the palette
 * swatch modal's "specimen under examination" aesthetic: a hero image
 * on a dark mat, an instrument-panel readout strip, two inline
 * colour-distribution charts (Lab a*×b* scatter + luminance ramp), and
 * a grid of every detected swatch. Everything pulls from the record
 * that's already fetched by the parent — no extra network calls beyond
 * the blob-fetch for the photograph.
 */
export function ResultDetailDialog({
  open,
  onOpenChange,
  result,
}: ResultDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {result && <ResultDetailBody result={result} />}
    </Dialog>
  );
}

function ResultDetailBody({ result }: { result: ResultRecord }) {
  const blobUrl = useAuthedImage(result.image_url);
  const stats = swatchStats(result.swatches);
  const captured = formatCaptured(result.uploaded_at);

  return (
    <DialogContent
      width="lg"
      className="p-0 overflow-hidden max-w-[820px] max-h-[90vh] flex flex-col"
      aria-describedby={undefined}
    >
      <DialogTitle className="sr-only">
        Result #{result.id} · Test #{result.test_id}
      </DialogTitle>
      <div className="flex-1 overflow-y-auto">

      {/* Hero: the photograph on a dark mat, with lab-notebook crop
          marks and a mix-blend slug that stays legible against any
          photograph. */}
      <div className="relative h-[300px] bg-[color:var(--color-substrate)] overflow-hidden">
        {blobUrl ? (
          <img
            src={blobUrl}
            alt={`Photograph of test result #${result.id}`}
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 animate-pulse bg-[color:var(--color-substrate)]"
          />
        )}

        {/* Fine grain overlay — same print-shop noise motif as the
            palette hero chip. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />

        <TickMark corner="tl" />
        <TickMark corner="tr" />
        <TickMark corner="bl" />
        <TickMark corner="br" />

        {/* Slug block, top-right. */}
        <div
          className="absolute top-4 right-5 text-right leading-tight"
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase font-semibold">
            Result · Test {result.test_id}
          </div>
          {(result.retest_index ?? 0) > 0 && (
            <div className="mt-1 font-mono text-[9.5px] tracking-[0.18em] uppercase opacity-80">
              retest #{result.retest_index}
            </div>
          )}
        </div>

        {/* Bottom-left: upload ID in display mono. */}
        <div
          className="absolute bottom-4 left-5 font-mono text-[22px] tracking-[0.06em] font-semibold leading-none"
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          #{result.id}
        </div>

        {/* Bottom-right: capture timestamp. */}
        <div
          className="absolute bottom-4 right-5 font-mono text-[10px] tracking-[0.18em] uppercase font-semibold opacity-85"
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          {captured}
        </div>

        <DialogClose
          aria-label="Close"
          className="absolute top-3 left-3 h-7 w-7 inline-flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60"
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </DialogClose>
      </div>

      <MetalBar />

      {/* Instrument panel — four readout cells across the top, same
          cadence as the palette modal's HEX/RGB/Lab/HSL strip. */}
      <div className="grid grid-cols-4 divide-x divide-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
        <ReadoutCell label="Swatches" value={String(result.swatches.length)} />
        <ReadoutCell
          label="avg σ"
          value={stats.avgSigma == null ? "—" : stats.avgSigma.toFixed(2)}
        />
        <ReadoutCell
          label="max σ"
          value={stats.maxSigma == null ? "—" : stats.maxSigma.toFixed(2)}
        />
        <ReadoutCell label="L* range" value={stats.lStarRange} />
      </div>

      <MetalBar variant="soft" />

      {/* Distribution charts — two inline SVG mini-vizes in the same
          dense lab-notebook style as the Spectrum page's σ bar. */}
      <div className="grid grid-cols-2 gap-px bg-[color:var(--color-border)]">
        <div className="bg-[color:var(--color-surface)] px-5 pt-4 pb-4">
          <ChartLabel
            title="Lab plane · a*/b*"
            hint="how far the palette strays from neutral"
          />
          <LabScatter swatches={result.swatches} />
        </div>
        <div className="bg-[color:var(--color-surface)] px-5 pt-4 pb-4">
          <ChartLabel
            title="Luminance ramp · L*"
            hint="tonal range, darkest → lightest"
          />
          <LuminanceRamp swatches={result.swatches} />
        </div>
      </div>

      <MetalBar variant="soft" />

      {/* Swatch grid — every detected swatch as its own tile. Capped at
          45vh with an inner scroll so a 200+ swatch result can't push
          the rest of the modal off-screen. Tile size shrinks for large
          grids so more fit per row and the scroll region stays usable. */}
      <div className="px-5 pt-4 pb-5">
        <ChartLabel title={`Swatches (${result.swatches.length})`} />
        <div
          className={cn(
            "mt-3 grid gap-1.5 max-h-[45vh] overflow-y-auto pr-1",
            result.swatches.length > 120
              ? "[grid-template-columns:repeat(auto-fill,minmax(44px,1fr))]"
              : result.swatches.length > 60
                ? "[grid-template-columns:repeat(auto-fill,minmax(56px,1fr))]"
                : "[grid-template-columns:repeat(auto-fill,minmax(72px,1fr))]",
          )}
        >
          {result.swatches.map((s, i) => (
            <SwatchTile
              key={`${s.row}-${s.col}-${i}`}
              swatch={s}
              compact={result.swatches.length > 60}
            />
          ))}
        </div>
      </div>

      {result.notes && (
        <>
          <MetalBar variant="soft" />
          <div className="px-5 pt-4 pb-5">
            <ChartLabel title="Notes" />
            <p className="mt-2 text-[12.5px] text-[color:var(--color-ink)] leading-relaxed whitespace-pre-wrap">
              {result.notes}
            </p>
          </div>
        </>
      )}
      </div>
    </DialogContent>
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

function ChartLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
        {title}
      </span>
      {hint && (
        <span className="text-[10.5px] text-[color:var(--color-ink-muted)]">
          {hint}
        </span>
      )}
    </div>
  );
}

function TickMark({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const pos = {
    tl: "top-3 left-3",
    tr: "top-3 right-3 rotate-90",
    bl: "bottom-3 left-3 -rotate-90",
    br: "bottom-3 right-3 rotate-180",
  }[corner];
  return (
    <div
      aria-hidden
      className={cn("absolute h-3 w-3 pointer-events-none", pos)}
      style={{ mixBlendMode: "difference" }}
    >
      <div className="absolute top-0 left-0 h-px w-full" style={{ background: "white" }} />
      <div className="absolute top-0 left-0 w-px h-full" style={{ background: "white" }} />
    </div>
  );
}

// --- Charts --------------------------------------------------------

// Lab space: L ∈ [0,100]; a, b roughly ∈ [-80, 80] for natural surfaces.
// Clamp to ±60 for viewing so dots don't pin to the edge.
const AB_RANGE = 60;

function LabScatter({ swatches }: { swatches: ResultSwatch[] }) {
  const valid = swatches.filter((s) => s.lab && s.lab.length >= 3);
  return (
    <div
      className="mt-2 relative rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] overflow-hidden"
      style={{ aspectRatio: "1 / 1" }}
    >
      <svg
        viewBox={`${-AB_RANGE} ${-AB_RANGE} ${AB_RANGE * 2} ${AB_RANGE * 2}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full"
        aria-label={`${valid.length} swatches plotted on the a*/b* plane`}
      >
        {/* Neutral-axis crosshairs */}
        <line
          x1={-AB_RANGE} y1={0} x2={AB_RANGE} y2={0}
          stroke="var(--color-border-strong)"
          strokeWidth={0.4}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0} y1={-AB_RANGE} x2={0} y2={AB_RANGE}
          stroke="var(--color-border-strong)"
          strokeWidth={0.4}
          vectorEffect="non-scaling-stroke"
        />
        {/* Faint circle at ΔE ~ 30 from neutral for a visual sense of spread */}
        <circle
          cx={0} cy={0} r={30}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={0.3}
          vectorEffect="non-scaling-stroke"
        />
        {/* Swatch dots — each at (a*, -b*) because SVG y grows downward
            while Lab b* grows upward (yellow is +b, blue is -b). */}
        {valid.map((s, i) => {
          const a = clamp(s.lab[1], -AB_RANGE, AB_RANGE);
          const b = clamp(s.lab[2], -AB_RANGE, AB_RANGE);
          return (
            <circle
              key={i}
              cx={a}
              cy={-b}
              r={2.4}
              fill={s.hex}
              stroke="rgba(0,0,0,0.25)"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${s.hex} · a*${s.lab[1].toFixed(1)} b*${s.lab[2].toFixed(1)}`}</title>
            </circle>
          );
        })}
      </svg>
      <AxisLabel pos="tl" text="+b* yellow" />
      <AxisLabel pos="bl" text="-b* blue" />
      <AxisLabel pos="br" text="+a* red" />
      <AxisLabel pos="tr" text="-a* green" align="end" />
    </div>
  );
}

function AxisLabel({
  pos,
  text,
  align,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  text: string;
  align?: "start" | "end";
}) {
  const p = {
    tl: "top-1.5 left-2",
    tr: "top-1.5 right-2",
    bl: "bottom-1.5 left-2",
    br: "bottom-1.5 right-2",
  }[pos];
  return (
    <div
      className={cn(
        "absolute font-mono text-[8.5px] tracking-[0.14em] uppercase",
        "text-[color:var(--color-ink-subtle)]",
        align === "end" && "text-right",
        p,
      )}
    >
      {text}
    </div>
  );
}

function LuminanceRamp({ swatches }: { swatches: ResultSwatch[] }) {
  const sorted = [...swatches]
    .filter((s) => s.lab && s.lab.length >= 3)
    .sort((a, b) => a.lab[0] - b.lab[0]);
  if (sorted.length === 0) {
    return (
      <div
        className="mt-2 rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] h-[120px] flex items-center justify-center text-[11px] text-[color:var(--color-ink-subtle)]"
      >
        no swatches
      </div>
    );
  }
  return (
    <div className="mt-2">
      <div
        className="rounded-[4px] border border-[color:var(--color-border)] overflow-hidden flex"
        style={{ height: 92 }}
      >
        {sorted.map((s, i) => (
          <div
            key={i}
            className="flex-1 relative"
            style={{ background: s.hex }}
            title={`${s.hex} · L*${s.lab[0].toFixed(1)}`}
          >
            {/* Thin baseline marker at the swatch's L* position inside
                the tile — doubles as a mini histogram-bar. */}
            <div
              aria-hidden
              className="absolute bottom-0 left-0 right-0"
              style={{
                height: `${clamp(s.lab[0], 0, 100)}%`,
                background: "rgba(255,255,255,0.08)",
                mixBlendMode: "overlay",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] tracking-[0.2em] uppercase text-[color:var(--color-ink-subtle)] tabular-nums">
        <span>L* {sorted[0].lab[0].toFixed(0)}</span>
        <span>L* {sorted[sorted.length - 1].lab[0].toFixed(0)}</span>
      </div>
    </div>
  );
}

function SwatchTile({
  swatch,
  compact = false,
}: {
  swatch: ResultSwatch;
  /** Hide the hex+σ footer when the containing grid is packing lots
   *  of tiles. The per-swatch tooltip (on hover) still surfaces the
   *  full details. */
  compact?: boolean;
}) {
  const tooltip = `${swatch.hex} · σ ${swatch.sigma.toFixed(2)}`;
  return (
    <div
      className="group rounded-[4px] border border-[color:var(--color-border)] overflow-hidden bg-[color:var(--color-surface)]"
      title={tooltip}
    >
      <div
        className={compact ? "aspect-square w-full" : "aspect-[4/3] w-full"}
        style={{ background: swatch.hex }}
      />
      {!compact && (
        <div className="px-1.5 py-1 flex items-center justify-between border-t border-[color:var(--color-border)]">
          <span className="font-mono text-[9.5px] text-[color:var(--color-ink)] truncate">
            {swatch.hex}
          </span>
          <span
            className="font-mono text-[8.5px] text-[color:var(--color-ink-subtle)] tabular-nums"
            title="per-swatch ΔE sample deviation"
          >
            σ{swatch.sigma.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}

// --- Stats helpers -------------------------------------------------

function swatchStats(swatches: ResultSwatch[]): {
  avgSigma: number | null;
  maxSigma: number | null;
  lStarRange: string;
} {
  if (swatches.length === 0) {
    return { avgSigma: null, maxSigma: null, lStarRange: "—" };
  }
  const avg =
    swatches.reduce((n, s) => n + s.sigma, 0) / swatches.length;
  const max = Math.max(...swatches.map((s) => s.sigma));
  const lStars = swatches
    .filter((s) => s.lab && s.lab.length >= 3)
    .map((s) => s.lab[0]);
  const lRange =
    lStars.length === 0
      ? "—"
      : `${Math.min(...lStars).toFixed(0)}–${Math.max(...lStars).toFixed(0)}`;
  return { avgSigma: avg, maxSigma: max, lStarRange: lRange };
}

function formatCaptured(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
