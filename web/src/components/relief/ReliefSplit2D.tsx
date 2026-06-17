/**
 * Relief — 2D side-by-side compare.
 *
 * The static alternative to ``ReliefCompare2D``'s draggable wipe: shows the
 * ORIGINAL and CLEANED depth maps in two panels, each contain-fit so they
 * line up at the same scale. The host behind supplies the checkerboard, so
 * the cleaned map's removed-background (alpha 0) regions read as transparent.
 *
 * The original panel doubles as the eyedropper target — clicking it samples a
 * pixel (mapped through the contain-fit letterbox), matching the wipe view's
 * pick behaviour so the workflow is identical in either compare mode.
 */

import { useRef } from "react";

export interface ReliefSplit2DProps {
  originalUrl: string | null;
  cleanedUrl: string | null;
  /** Eyedropper armed: a click on the ORIGINAL panel samples a pixel. */
  picking?: boolean;
  /** Called with the clicked position as image fractions (0..1) when picking. */
  onPick?: (fracX: number, fracY: number) => void;
}

/** Contain-fit rect of a ``natW×natH`` image inside a ``boxW×boxH`` box. */
function containedRect(
  natW: number,
  natH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; w: number; h: number } | null {
  if (natW <= 0 || natH <= 0 || boxW <= 0 || boxH <= 0) return null;
  const scale = Math.min(boxW / natW, boxH / natH);
  const w = natW * scale;
  const h = natH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

function Panel({
  url,
  label,
  picking,
  onPick,
}: {
  url: string | null;
  label: string;
  picking?: boolean;
  onPick?: (fracX: number, fracY: number) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const armed = !!picking && !!onPick;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!armed) return;
    const img = imgRef.current;
    const wrap = wrapRef.current;
    if (!img || !wrap || !img.naturalWidth) return;
    const r = wrap.getBoundingClientRect();
    const fit = containedRect(img.naturalWidth, img.naturalHeight, r.width, r.height);
    if (!fit) return;
    const fx = (e.clientX - r.left - fit.x) / fit.w;
    const fy = (e.clientY - r.top - fit.y) / fit.h;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    onPick!(fx, fy);
  };

  return (
    <div
      ref={wrapRef}
      onClick={handleClick}
      className={
        "relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[6px] border border-[color:var(--color-border)] " +
        (armed ? "cursor-crosshair" : "")
      }
    >
      {url ? (
        <img
          ref={imgRef}
          src={url}
          alt={label}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
        />
      ) : (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)]">
          …
        </span>
      )}
      <span className="pointer-events-none absolute left-2 top-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55 mix-blend-difference">
        {label}
      </span>
    </div>
  );
}

export function ReliefSplit2D({
  originalUrl,
  cleanedUrl,
  picking,
  onPick,
}: ReliefSplit2DProps) {
  return (
    <div className="flex h-full w-full gap-2 p-1">
      <Panel
        url={originalUrl}
        label="original"
        picking={picking}
        onPick={onPick}
      />
      <Panel url={cleanedUrl} label="cleaned" />
    </div>
  );
}
