import { useEffect, useDeferredValue, useMemo, useState } from "react";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui";
import { deltaE2000, hexToLab, type Lab } from "../color/math";
import type { LayerSpec } from "../types";
import {
  computeColorMergeGroups,
  type MergeGroup,
} from "../svg/mergeColors";

// Slider range: 80% = ΔE 10, 100% = ΔE 0. Inverse of the existing
// ``deltaEToPercent`` helper in SvgLayersPage (``100 - dE*2`` clamped).
const MIN_PERCENT = 80;
const MAX_PERCENT = 100;
const DEFAULT_PERCENT = 95;

function percentToDeltaE(pct: number): number {
  return Math.max(0, (100 - pct) / 2);
}

export interface MergeColorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layers: LayerSpec[];
  shapeCountsByColor: Record<string, number>;
  onConfirm: (groups: MergeGroup[]) => void;
}

export function MergeColorsDialog({
  open,
  onOpenChange,
  layers,
  shapeCountsByColor,
  onConfirm,
}: MergeColorsDialogProps) {
  const [percent, setPercent] = useState(DEFAULT_PERCENT);
  // ``overrides`` lets the user click a source swatch to promote it as
  // representative — key is the cluster's default representativeColor.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setPercent(DEFAULT_PERCENT);
      setOverrides({});
    }
  }, [open]);

  const deferredPercent = useDeferredValue(percent);

  const threshold = percentToDeltaE(deferredPercent);
  const autoGroups = useMemo(
    () => computeColorMergeGroups(layers, shapeCountsByColor, threshold),
    [layers, shapeCountsByColor, threshold],
  );
  const groups = useMemo<MergeGroup[]>(
    () =>
      autoGroups.map((g) => ({
        ...g,
        representativeColor: overrides[g.representativeColor] ?? g.representativeColor,
      })),
    [autoGroups, overrides],
  );

  const totalSources = groups.reduce((n, g) => n + g.sourceColors.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg">
        <DialogHeader>
          <DialogTitle>Merge similar colors</DialogTitle>
        </DialogHeader>

        <div className="flex items-baseline justify-between mb-1">
          <label
            htmlFor="merge-threshold"
            className="text-[12px] text-[color:var(--color-ink-muted)]"
          >
            Similarity threshold
          </label>
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold text-[color:var(--color-ink)]">
              {percent}% match
            </span>
            <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
              ΔE {percentToDeltaE(percent).toFixed(1)}
            </span>
          </div>
        </div>
        <input
          id="merge-threshold"
          type="range"
          min={MIN_PERCENT}
          max={MAX_PERCENT}
          step={1}
          value={percent}
          onChange={(e) => setPercent(parseInt(e.target.value, 10))}
          className="w-full accent-[color:var(--color-primary)]"
        />
        <div className="flex justify-between text-[10px] text-[color:var(--color-ink-subtle)] mb-4">
          <span>{MIN_PERCENT}%</span>
          <span>{MAX_PERCENT}%</span>
        </div>

        <div className="max-h-[50vh] overflow-auto flex flex-col gap-2">
          {groups.length === 0 && (
            <p className="text-[12.5px] text-[color:var(--color-ink-subtle)] py-4 text-center">
              No colours within {percent}% similarity. Drag the slider
              left to find looser matches.
            </p>
          )}
          {groups.map((g) => {
            const shapeTotal = g.sourceColors.reduce(
              (n, c) => n + (shapeCountsByColor[c] ?? 0),
              0,
            );
            const maxDeltaE = maxDeltaEInGroup(g);
            return (
              <div
                key={g.sourceColors.join("|")}
                className={cn(
                  "rounded-[8px] border border-[color:var(--color-border)]",
                  "bg-[color:var(--color-surface-elevated)] p-3",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {g.sourceColors.map((src) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() =>
                          setOverrides((prev) => ({
                            ...prev,
                            [autoRepFor(autoGroups, g)]: src,
                          }))
                        }
                        title={`Promote ${src} as representative`}
                        className={cn(
                          "h-6 w-6 rounded-[4px] border",
                          src === g.representativeColor
                            ? "border-[color:var(--color-primary)]/60 ring-1 ring-[color:var(--color-primary)]/30"
                            : "border-[color:var(--color-border-strong)] hover:border-[color:var(--color-primary)]",
                        )}
                        style={{ background: src }}
                        aria-label={`Source colour ${src}`}
                      />
                    ))}
                  </div>
                  <div className="text-[color:var(--color-ink-subtle)] text-[14px] shrink-0">→</div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div
                      className="h-9 w-9 rounded-[6px] border border-[color:var(--color-primary)]/30 ring-1 ring-[color:var(--color-primary)]/20"
                      style={{ background: g.representativeColor }}
                      aria-hidden="true"
                    />
                    <span className="font-mono text-[11px] text-[color:var(--color-ink)]">
                      {g.representativeColor}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-[color:var(--color-ink-subtle)]">
                  {g.sourceColors.length} colors · {shapeTotal.toLocaleString()} shapes · ΔE ≤ {maxDeltaE.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={groups.length === 0}
            onClick={() => {
              onConfirm(groups);
              setOverrides({});
            }}
          >
            Merge {totalSources} colors → {groups.length}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The override key is the ORIGINAL dominant representative so that
// promoting swaps even after the user drags the slider.
function autoRepFor(
  autoGroups: MergeGroup[],
  current: MergeGroup,
): string {
  const match = autoGroups.find((g) =>
    g.sourceColors.every((c) => current.sourceColors.includes(c)) &&
    g.sourceColors.length === current.sourceColors.length,
  );
  return match?.representativeColor ?? current.representativeColor;
}

function maxDeltaEInGroup(g: MergeGroup): number {
  const repLab = /^#[0-9a-fA-F]{6}$/.test(g.representativeColor)
    ? hexToLab(g.representativeColor)
    : null;
  if (!repLab) return 0;
  let max = 0;
  for (const src of g.sourceColors) {
    if (src === g.representativeColor) continue;
    if (!/^#[0-9a-fA-F]{6}$/.test(src)) continue;
    const d = deltaE2000(repLab as Lab, hexToLab(src) as Lab);
    if (d > max) max = d;
  }
  return max;
}
