import { useEffect, useMemo, useRef, useState } from "react";
import { GcodeCanvas } from "./GcodeCanvas";
import type { Layer } from "../../lib/gcode/types";

interface LayerPanelProps {
  layer: Layer;
  /** 1-based layer index for display. */
  displayIndex: number;
  /** Block offset to highlight in this layer. Clamped to the layer's
   * own block range so panels with fewer blocks don't blank out when
   * the global slider runs past them. null = no offset chosen yet
   * (show all blocks). */
  blockOffset: number | null;
  showTravels: boolean;
}

function configuredPeakOf(layer: Layer): number | null {
  const p = layer.config.parsed as { power?: unknown } | null;
  if (!p) return null;
  const arr = (p as { power?: unknown }).power;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const last = arr[arr.length - 1];
  return typeof last === "number" ? last : null;
}

function isVectorLayer(layer: Layer): boolean {
  const p = layer.config.parsed as { isVector?: boolean } | null;
  return !!p && p.isVector === true;
}

/**
 * One layer's canvas + header + observed-stats footer, sized to fill
 * its grid cell. Used in the multi-layer comparison view: each
 * selected layer gets one panel, all driven by a shared block-offset
 * slider on the parent page.
 */
export function LayerPanel({
  layer,
  displayIndex,
  blockOffset,
  showTravels,
}: LayerPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 320, h: 240 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({ w: Math.round(width), h: Math.round(height) });
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const peak = useMemo(() => configuredPeakOf(layer), [layer]);
  const vec = isVectorLayer(layer);

  // Clamp the shared offset to this layer's own block range. Panels
  // with fewer blocks stay parked on their last block.
  const clampedIdx =
    blockOffset == null
      ? null
      : Math.min(Math.max(blockOffset, 0), layer.blocks.length - 1);

  const activeBlock = clampedIdx != null ? layer.blocks[clampedIdx] : null;

  const items = useMemo(() => {
    if (clampedIdx == null) {
      return layer.blocks.map((block) => ({ block, configuredPeak: peak }));
    }
    return [{ block: layer.blocks[clampedIdx], configuredPeak: peak }];
  }, [layer, clampedIdx, peak]);

  const caption =
    clampedIdx == null
      ? `${layer.blocks.length} blocks`
      : `block ${clampedIdx + 1} / ${layer.blocks.length}`;

  const isCleanup =
    activeBlock != null &&
    peak != null &&
    activeBlock.peakS > 0 &&
    activeBlock.peakS < peak * 0.5;

  return (
    <div className="rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden flex flex-col min-h-[260px]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[color:var(--color-border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] font-semibold bg-[color:var(--color-surface-elevated)] border border-[color:var(--color-border-strong)] rounded-[3px] px-1.5 py-[1px] min-w-[26px] text-center">
            L{displayIndex}
          </span>
          <span
            className={
              "font-mono text-[10px] uppercase tracking-[0.06em] px-1.5 py-[1px] rounded-[3px] " +
              (vec
                ? "text-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)]"
                : "text-[color:var(--color-secondary)] bg-[color:var(--color-secondary-tint,var(--color-surface-elevated))]")
            }
          >
            {vec ? "vector" : "bitmap"}
          </span>
          <span className="font-mono text-[11px] text-[color:var(--color-ink)] truncate">
            S {peak ?? "—"}
          </span>
        </div>
        <span className="font-mono text-[10px] text-[color:var(--color-ink-subtle)] whitespace-nowrap">
          {layer.blocks.length} blk
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={hostRef}
        className="flex-1 min-h-[180px] bg-[color:var(--color-substrate)] flex items-stretch"
      >
        <GcodeCanvas
          items={items}
          bbox={layer.bbox}
          caption={caption}
          width={size.w}
          height={size.h}
          showTravels={showTravels}
        />
      </div>

      {/* Footer — observed stats for the active block (when one is set) */}
      <div className="px-3 py-2 border-t border-[color:var(--color-border)] font-mono text-[10px] grid grid-cols-4 gap-2">
        {activeBlock ? (
          <>
            <div className="flex flex-col">
              <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.06em] text-[9px]">
                Peak S
              </span>
              <span
                className={
                  isCleanup
                    ? "text-[color:var(--color-destructive)] font-bold"
                    : "text-[color:var(--color-ink)]"
                }
              >
                {activeBlock.peakS}
                {peak ? ` / ${peak}` : ""}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.06em] text-[9px]">
                Speed
              </span>
              <span
                className={
                  isCleanup
                    ? "text-[color:var(--color-destructive)] font-bold"
                    : "text-[color:var(--color-ink)]"
                }
              >
                {activeBlock.feedF > 0
                  ? `${Math.round(activeBlock.feedF / 60).toLocaleString()} mm/s`
                  : "—"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.06em] text-[9px]">
                Type
              </span>
              <span
                className={
                  isCleanup
                    ? "text-[color:var(--color-destructive)] font-bold"
                    : "text-[color:var(--color-ink)]"
                }
              >
                {isCleanup ? "Cleanup" : "Normal"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.06em] text-[9px]">
                Z
              </span>
              {(() => {
                const running = activeBlock.zAtEnd;
                const fmt = (v: number) =>
                  v.toFixed(Math.abs(v) < 0.1 ? 3 : 2);
                // Filter zero-delta events — xTool sometimes re-emits the
                // same Z value before a scan-strip; that's not a change.
                const meaningful = activeBlock.zMoves.filter(
                  (m) => m.delta !== 0,
                );
                const hasChange = meaningful.length > 0;
                const colour =
                  running < 0
                    ? "var(--color-success)"
                    : running > 0
                    ? "var(--color-warning)"
                    : "var(--color-ink-muted)";
                let label = `${fmt(running)}`;
                if (hasChange) {
                  const total = meaningful.reduce((n, m) => n + m.delta, 0);
                  const arrow = total < 0 ? "↓" : total > 0 ? "↑" : "—";
                  label += `  ${arrow}${fmt(Math.abs(total))}`;
                }
                return (
                  <span
                    className={hasChange ? "font-bold" : ""}
                    style={{ color: colour }}
                  >
                    {label}
                  </span>
                );
              })()}
            </div>
          </>
        ) : (
          <span className="col-span-3 text-[color:var(--color-ink-subtle)]">
            All blocks shown — pick a block on the slider for observed stats.
          </span>
        )}
      </div>
    </div>
  );
}
