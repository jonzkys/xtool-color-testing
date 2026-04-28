import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui";
import { simplifySvg, type SimplifyResult } from "../svg/simplify";

// Both sliders snap to two-decimal mm. Defaults bias towards the
// area filter (which is what fixes xTool studio's many-shapes
// crash); vertex simplification is opt-in via a non-zero tolerance.
const AREA_MIN = 0;
const AREA_MAX = 5;
const AREA_STEP = 0.05;
const AREA_DEFAULT = 0.3;

const TOL_MIN = 0;
const TOL_MAX = 0.5;
const TOL_STEP = 0.01;
const TOL_DEFAULT = 0;

export interface SimplifyShapesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live SVG content the dialog runs simplification against. The
   *  parent (SvgLayersPage) owns the source of truth — the dialog
   *  only previews and emits the final svg via ``onConfirm``. */
  svgContent: string;
  /** Project width in mm — needed to translate the dialog's mm
   *  thresholds into the SVG's user units. */
  widthMm: number;
  onConfirm: (result: SimplifyResult) => void;
}

export function SimplifyShapesDialog({
  open,
  onOpenChange,
  svgContent,
  widthMm,
  onConfirm,
}: SimplifyShapesDialogProps) {
  const [minAreaMm2, setMinAreaMm2] = useState(AREA_DEFAULT);
  const [toleranceMm, setToleranceMm] = useState(TOL_DEFAULT);
  useEffect(() => {
    if (open) {
      setMinAreaMm2(AREA_DEFAULT);
      setToleranceMm(TOL_DEFAULT);
    }
  }, [open]);

  // Defer the slider values so dragging is smooth — the simplify
  // pass on a 5k-shape SVG can be a few ms but enough to chunk
  // animation frames at every tick.
  const deferredArea = useDeferredValue(minAreaMm2);
  const deferredTol = useDeferredValue(toleranceMm);

  const result = useMemo<SimplifyResult | { error: string }>(() => {
    if (!svgContent) {
      return { svgText: svgContent, beforeShapes: 0, afterShapes: 0, pathsSimplified: 0 };
    }
    try {
      return simplifySvg(svgContent, {
        minAreaMm2: deferredArea,
        toleranceMm: deferredTol,
        widthMm,
      });
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [svgContent, deferredArea, deferredTol, widthMm]);

  const isErr = "error" in result;
  const before = isErr ? 0 : result.beforeShapes;
  const after = isErr ? 0 : result.afterShapes;
  const dropped = isErr ? 0 : before - after;
  const pathsSimplified = isErr ? 0 : result.pathsSimplified;
  const noChange =
    !isErr && dropped === 0 && pathsSimplified === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="md">
        <DialogHeader>
          <DialogTitle>Simplify shapes</DialogTitle>
        </DialogHeader>

        <p className="text-[12.5px] text-[color:var(--color-ink-muted)] mb-4 leading-snug">
          xTool studio gets sluggish past ~1k shapes. Drop tiny artefacts
          (vtracer often leaves hundreds of single-pixel ones) and
          reduce vertex count on long polylines. Curves are preserved
          untouched.
        </p>

        {/* Min area slider */}
        <div className="flex items-baseline justify-between mb-1">
          <label
            htmlFor="simplify-min-area"
            className="text-[12px] text-[color:var(--color-ink-muted)]"
          >
            Drop shapes smaller than
          </label>
          <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
            {minAreaMm2.toFixed(2)} mm²
          </span>
        </div>
        <input
          id="simplify-min-area"
          type="range"
          min={AREA_MIN}
          max={AREA_MAX}
          step={AREA_STEP}
          value={minAreaMm2}
          onChange={(e) => setMinAreaMm2(parseFloat(e.target.value))}
          className="w-full accent-[color:var(--color-primary)]"
        />
        <div className="flex justify-between text-[10px] text-[color:var(--color-ink-subtle)] mb-4">
          <span>off</span>
          <span>{AREA_MAX} mm²</span>
        </div>

        {/* Tolerance slider */}
        <div className="flex items-baseline justify-between mb-1">
          <label
            htmlFor="simplify-tolerance"
            className="text-[12px] text-[color:var(--color-ink-muted)]"
          >
            Path simplification tolerance
          </label>
          <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
            {toleranceMm.toFixed(2)} mm
          </span>
        </div>
        <input
          id="simplify-tolerance"
          type="range"
          min={TOL_MIN}
          max={TOL_MAX}
          step={TOL_STEP}
          value={toleranceMm}
          onChange={(e) => setToleranceMm(parseFloat(e.target.value))}
          className="w-full accent-[color:var(--color-primary)]"
        />
        <div className="flex justify-between text-[10px] text-[color:var(--color-ink-subtle)] mb-4">
          <span>off</span>
          <span>{TOL_MAX} mm</span>
        </div>

        {/* Result summary */}
        <div
          className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-3 mb-2"
        >
          {isErr ? (
            <span className="text-[12.5px] text-[color:var(--color-destructive)]">
              {result.error}
            </span>
          ) : (
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[18px] tabular-nums text-[color:var(--color-ink)]">
                  {before.toLocaleString()}
                </span>
                <span className="text-[color:var(--color-ink-subtle)]">→</span>
                <span className="font-mono text-[18px] tabular-nums text-[color:var(--color-primary)]">
                  {after.toLocaleString()}
                </span>
                <span className="text-[12px] text-[color:var(--color-ink-muted)]">
                  shapes
                </span>
              </div>
              <div className="text-right text-[11px] text-[color:var(--color-ink-subtle)] tabular-nums">
                {dropped > 0 && (
                  <div>
                    {dropped.toLocaleString()} dropped
                  </div>
                )}
                {pathsSimplified > 0 && (
                  <div>
                    {pathsSimplified.toLocaleString()} paths simplified
                  </div>
                )}
                {noChange && <div>no changes at these settings</div>}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={isErr || noChange}
            onClick={() => {
              if (!isErr) onConfirm(result);
            }}
          >
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
