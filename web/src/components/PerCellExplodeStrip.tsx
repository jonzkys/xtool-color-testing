import { cn } from "../ui";
import { hexToLab, deltaE76 } from "../color/math";
import type { AveragedSwatch } from "../types";

/**
 * The "this cell has history" micro-strip. Pops beneath a Spectrum
 * viz when the user pins a swatch — shows every run that contributed
 * to the averaged colour, in upload order, with the ΔE from each run
 * to the running centroid.
 */
export function PerCellExplodeStrip({
  label,
  cell,
  onClose,
}: {
  label: string;
  cell: AveragedSwatch;
  onClose: () => void;
}) {
  const per = cell.per_result ?? [];
  if (per.length < 2) return null;

  // Centroid and per-result ΔE76 — cheap, runs once per pin.
  const labs = per.map((r) => hexToLab(r.hex));
  const centroid: [number, number, number] = [0, 0, 0];
  for (const l of labs) {
    centroid[0] += l[0] / labs.length;
    centroid[1] += l[1] / labs.length;
    centroid[2] += l[2] / labs.length;
  }
  const deltas = labs.map((l) => deltaE76(l, centroid));
  const worst = Math.max(...deltas);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;

  return (
    <div className="mt-4 rounded-[8px] border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/40 px-3 py-3">
      <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)]">
            Pinned · per-run history
          </span>
          <span className="font-mono text-[11px] text-[color:var(--color-ink)] truncate">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <MiniMeta label="N">{per.length}</MiniMeta>
          <MiniMeta label="avg">ΔE {mean.toFixed(2)}</MiniMeta>
          <MiniMeta label="worst" tone={worst > 3 ? "warn" : worst > 1 ? "hint" : undefined}>
            ΔE {worst.toFixed(2)}
          </MiniMeta>
          <button
            onClick={onClose}
            className="h-6 w-6 rounded-full inline-flex items-center justify-center text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface)]"
            aria-label="Unpin"
            title="Unpin"
          >
            ×
          </button>
        </div>
      </div>

      {/* Per-result strip — each cell = one engraving. Label underneath
          with result id + ΔE from centroid. */}
      <div className="flex gap-1.5">
        {per.map((r, i) => {
          const d = deltas[i];
          const tone =
            d < 1 ? "calm" : d < 2 ? "hint" : d < 4 ? "warn" : "hot";
          return (
            <div key={`${r.result_id}-${i}`} className="flex flex-col gap-1 min-w-[64px] flex-1">
              <div
                className="h-16 rounded-[4px] border border-[color:var(--color-border)]"
                style={{ background: r.hex }}
                title={`${r.hex} · result #${r.result_id}`}
              />
              <div className="flex items-baseline justify-between gap-1">
                <span className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
                  #{r.result_id}
                </span>
                <span
                  className={cn(
                    "font-mono text-[10px] tabular-nums",
                    tone === "calm" && "text-[color:var(--color-ink-muted)]",
                    tone === "hint" && "text-[color:var(--color-ink)]",
                    tone === "warn" && "text-[color:var(--color-primary)] font-semibold",
                    tone === "hot" && "text-[color:var(--color-destructive)] font-semibold",
                  )}
                >
                  ΔE {d.toFixed(1)}
                </span>
              </div>
              <div className="font-mono text-[9px] tabular-nums text-[color:var(--color-ink-subtle)] truncate">
                {r.hex}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniMeta({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "hint" | "warn";
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono">
      <span className="text-[9px] font-semibold tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span
        className={cn(
          "text-[11px] tabular-nums",
          tone === "warn" && "text-[color:var(--color-primary)] font-semibold",
          tone === "hint" && "text-[color:var(--color-ink)]",
          !tone && "text-[color:var(--color-ink)]",
        )}
      >
        {children}
      </span>
    </span>
  );
}
