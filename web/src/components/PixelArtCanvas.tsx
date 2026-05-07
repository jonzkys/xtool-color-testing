/**
 * PixelArtCanvas — two-stack workshop preview for the Pixel Art page.
 *
 *  Top:    the original raster, with a draggable + aspect-locked crop
 *          frame overlay. The frame's aspect ratio matches the chosen
 *          material's width/height so the crop directly drives what
 *          the burn occupies.
 *  Bottom: the post-quantise pixel preview, rendered as one ``<path>``
 *          per enabled colour (compound path, one subpath per cell)
 *          inside an ``<svg viewBox>`` that scales to fill its
 *          container. Mirrors the .xcs export structure.
 *
 *  The crop frame is a sibling absolutely-positioned ``<div>`` (not a
 *  second canvas) so pointer events stay simple. Coordinates everywhere
 *  are in image-pixel space; on-screen positions are derived per render.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../ui";

export interface CroppedRegion {
  /** Image-pixel space. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PreviewState {
  cols: number;
  rows: number;
  /** Per-cell centroid hex, indexed row-major. ``null`` for skipped
   *  (transparent) cells; an 8-digit hex (``#rrggbbaa``) for
   *  disabled-colour cells so the canvas dims them in place — the
   *  download path skips disabled colours entirely. */
  cellCentroidHex: (string | null)[];
  /** Number of distinct enabled centroid colours — drives the
   *  "K paths" header readout. */
  pathCount: number;
  kColors: number;
  /** Per-cell raw mean hex (#rrggbb) before quantisation, indexed
   *  row-major. ``null`` for skipped cells. Used by the "Original"
   *  preview-mode toggle so the user can A/B the source-mean
   *  rendering vs. the centroid-quantised one. */
  cellMeansHex: (string | null)[];
}

export type PreviewRenderMode = "representative" | "original";

export interface PixelArtCanvasProps {
  image: ImageBitmap | null;
  /** Material dimensions — drive the crop frame's aspect lock and the
   *  derived crop-mm readout. */
  materialWidthMm: number;
  materialHeightMm: number;
  crop: CroppedRegion;
  onCropChange: (crop: CroppedRegion) => void;
  preview: PreviewState | null;
  /** Bottom preview rendering mode. ``representative`` paints each
   *  cell with its k-means centroid colour (i.e. what gets burned).
   *  ``original`` paints each cell with its raw source-mean colour
   *  so the user can A/B against the quantised result. */
  previewMode: PreviewRenderMode;
  onPreviewModeChange: (mode: PreviewRenderMode) => void;
  /** When true, the crop frame snaps to the material's W/H aspect
   *  ratio (the original behaviour). When false, the crop is free
   *  and the burn ends up rendering at whatever aspect the user
   *  picked — the new default. */
  lockAspect: boolean;
  /** When true, the crop frame is shown and draggable. When false
   *  the burn uses the whole image and the frame + corner handles
   *  are hidden — the simpler default for users who just want to
   *  burn the picture as-is. */
  cropEnabled: boolean;
  onCropEnabledChange: (enabled: boolean) => void;
}

type DragKind =
  | { kind: "idle" }
  | {
      kind: "move";
      /** Pointer offset (screen px) at drag-start, relative to the
       *  crop frame's top-left. */
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: "resize-tl" | "resize-tr" | "resize-bl" | "resize-br";
      /** The image-pixel anchor that stays fixed during the resize. */
      anchorX: number;
      anchorY: number;
    };

const HANDLE_SIZE = 12;

/** Clamp a number into ``[lo, hi]``. Returns ``lo`` if ``hi < lo``. */
function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fit a ``W×H`` viewport into ``maxW×maxH`` preserving aspect, returning
 *  the scale factor + the centred origin in screen px. */
function fitContain(
  w: number,
  h: number,
  maxW: number,
  maxH: number,
): { scale: number; offsetX: number; offsetY: number; drawW: number; drawH: number } {
  if (w <= 0 || h <= 0 || maxW <= 0 || maxH <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0, drawW: 0, drawH: 0 };
  }
  const s = Math.min(maxW / w, maxH / h);
  const drawW = w * s;
  const drawH = h * s;
  return {
    scale: s,
    offsetX: (maxW - drawW) / 2,
    offsetY: (maxH - drawH) / 2,
    drawW,
    drawH,
  };
}

/** Try to keep the requested crop inside the image bounds while
 *  honouring the material aspect. Mutates nothing — returns a new
 *  ``CroppedRegion``. */
function clampCropToImage(
  crop: CroppedRegion,
  imgW: number,
  imgH: number,
): CroppedRegion {
  const w = clamp(crop.w, 1, imgW);
  const h = clamp(crop.h, 1, imgH);
  const x = clamp(crop.x, 0, imgW - w);
  const y = clamp(crop.y, 0, imgH - h);
  return { x, y, w, h };
}

export function PixelArtCanvas({
  image,
  materialWidthMm,
  materialHeightMm,
  crop,
  onCropChange,
  preview,
  previewMode,
  onPreviewModeChange,
  lockAspect,
  cropEnabled,
  onCropEnabledChange,
}: PixelArtCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(0);

  // Track the container width + height in CSS px so we can compute the
  // canvas contain-fit. ResizeObserver keeps this honest under window
  // resize. In test environments (jsdom) ResizeObserver may be
  // undefined — fall back to a one-shot measurement plus a window-
  // resize listener.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerW(el.clientWidth);
    setContainerH(el.clientHeight);
    if (typeof ResizeObserver === "undefined") {
      const onResize = () => {
        if (containerRef.current) {
          setContainerW(containerRef.current.clientWidth);
          setContainerH(containerRef.current.clientHeight);
        }
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerW(entry.contentRect.width);
        setContainerH(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Top canvas: image + the crop frame's coordinate system ──────────
  // Canvas's internal resolution matches the source image so the
  // ``drawImage`` call doesn't need any extra scaling. We then size it
  // via CSS to fit the container (preserving aspect).
  const imgW = image?.width ?? 0;
  const imgH = image?.height ?? 0;

  // Split the available vertical space between the original (top) and
  // the pixelated preview (bottom). Each header strip eats ~30px and
  // the gap-3 between the stacks eats another 12. The min floors keep
  // the panes usable on stubby viewports; on a tall page each stack
  // gets ~half of the parent height so the canvas grows with the
  // window.
  const HEADER_H = 30;
  const STACK_GAP = 12;
  const stackBudget = Math.max(
    220,
    (containerH - 2 * HEADER_H * 2 - STACK_GAP) / 2,
  );
  const MAX_TOP_H = stackBudget;
  const MAX_BOTTOM_H = stackBudget;

  const topFit = fitContain(
    imgW || 1,
    imgH || 1,
    Math.max(1, containerW),
    MAX_TOP_H,
  );
  const topDrawW = imgW > 0 ? topFit.drawW : Math.max(1, containerW);
  const topDrawH = imgW > 0 ? topFit.drawH : 220;

  // Paint the image whenever it changes (or the canvas DOM remounts).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = imgW || 1;
    canvas.height = imgH || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (image) {
      ctx.drawImage(image, 0, 0);
    }
  }, [image, imgW, imgH]);

  // Paint the bottom preview imperatively on every preview / mode
  // change. Doing this with ImageData keeps the work O(cells) rather
  // than O(SVG-nodes) — the previous SVG approach materialised one
  // <rect> per cell which on 1024-cell grids made the toggle feel
  // queued because each click triggered a giant React reconcile.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !preview) return;
    canvas.width = preview.cols;
    canvas.height = preview.rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, preview.cols, preview.rows);
    const source =
      previewMode === "original"
        ? preview.cellMeansHex
        : preview.cellCentroidHex;
    // ImageData is faster than fillRect for cell-grid blits because
    // each rect call costs path setup + state changes.
    const buf = ctx.createImageData(preview.cols, preview.rows);
    const arr = buf.data;
    for (let i = 0; i < source.length; i++) {
      const hex = source[i];
      const o = i * 4;
      if (!hex) {
        arr[o + 3] = 0; // transparent
        continue;
      }
      // Accept "#rrggbb" or "#rrggbbaa".
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
      arr[o] = r;
      arr[o + 1] = g;
      arr[o + 2] = b;
      arr[o + 3] = a;
    }
    ctx.putImageData(buf, 0, 0);
  }, [preview, previewMode]);

  // ── Crop frame state machine ────────────────────────────────────────
  const [drag, setDrag] = useState<DragKind>({ kind: "idle" });

  // Image-pixel space → on-screen px (relative to the canvas top-left).
  const toScreenX = useCallback(
    (px: number) => (imgW > 0 ? (px / imgW) * topDrawW : 0),
    [imgW, topDrawW],
  );
  const toScreenY = useCallback(
    (px: number) => (imgH > 0 ? (px / imgH) * topDrawH : 0),
    [imgH, topDrawH],
  );
  const toImageX = useCallback(
    (sx: number) => (topDrawW > 0 ? (sx / topDrawW) * imgW : 0),
    [imgW, topDrawW],
  );
  const toImageY = useCallback(
    (sy: number) => (topDrawH > 0 ? (sy / topDrawH) * imgH : 0),
    [imgH, topDrawH],
  );

  const aspect =
    materialWidthMm > 0 && materialHeightMm > 0
      ? materialWidthMm / materialHeightMm
      : 1;

  // Build the next crop honouring the material aspect lock when the
  // page asks for it. With ``lockAspect=false`` the crop is free —
  // the user can pick any rectangle and the burn footprint follows.
  const constrainedCrop = useCallback(
    (next: CroppedRegion): CroppedRegion => {
      let { x, y, w, h } = next;
      if (lockAspect && aspect > 0) {
        // Pick whichever dimension is "more constrained" by the image
        // bounds and recompute the other from it.
        const wFromH = h * aspect;
        const hFromW = w / aspect;
        if (wFromH <= imgW && hFromW > imgH) {
          w = wFromH;
        } else {
          h = hFromW;
        }
      }
      return clampCropToImage({ x, y, w, h }, imgW, imgH);
    },
    [aspect, imgW, imgH, lockAspect],
  );

  // Window-level pointer move/up listeners while dragging — set up
  // imperatively so we don't need to listen on the body all the time.
  useEffect(() => {
    if (drag.kind === "idle") return;
    const active = drag; // TS narrowing — keeps the union resolved inside onMove.
    function onMove(e: PointerEvent) {
      const canvas = canvasRef.current;
      if (!canvas || !image) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (active.kind === "move") {
        const newX = toImageX(sx - active.offsetX);
        const newY = toImageY(sy - active.offsetY);
        onCropChange(
          clampCropToImage({ x: newX, y: newY, w: crop.w, h: crop.h }, imgW, imgH),
        );
        return;
      }
      // Resize: anchor stays fixed, opposite corner follows cursor.
      const px = toImageX(sx);
      const py = toImageY(sy);
      let x = Math.min(active.anchorX, px);
      let y = Math.min(active.anchorY, py);
      let w = Math.abs(active.anchorX - px);
      let h = Math.abs(active.anchorY - py);
      // Floor at 8 image-px so the frame doesn't collapse.
      w = Math.max(8, w);
      h = Math.max(8, h);
      onCropChange(constrainedCrop({ x, y, w, h }));
    }
    function onUp() {
      setDrag({ kind: "idle" });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [
    drag,
    crop.w,
    crop.h,
    image,
    imgW,
    imgH,
    onCropChange,
    constrainedCrop,
    toImageX,
    toImageY,
  ]);

  // ── On-screen coords for the crop frame ─────────────────────────────
  const frameLeft = toScreenX(crop.x);
  const frameTop = toScreenY(crop.y);
  const frameW = toScreenX(crop.w);
  const frameH = toScreenY(crop.h);

  // ── Burn footprint readout ──────────────────────────────────────────
  // Shows the actual mm size the burn will take on the material —
  // not the crop's fraction of the material outline. With aspect
  // locked the two coincide; with aspect unlocked the burn fits the
  // crop's own aspect (W stays = materialWidthMm, H follows from the
  // crop's aspect ratio) so a square crop on an 18×80 mm material
  // burns as an 18×18 square, not an 18-mm-tall slice of the 80-mm
  // long material.
  const cropAspect =
    crop.w > 0 && crop.h > 0 ? crop.w / crop.h : 1;
  const burnWMm = materialWidthMm;
  const burnHMm = lockAspect
    ? materialHeightMm
    : cropAspect > 0
      ? materialWidthMm / cropAspect
      : materialHeightMm;
  const cropMmW = burnWMm.toFixed(1);
  const cropMmH = burnHMm.toFixed(1);

  // ── Bottom preview SVG sizing ───────────────────────────────────────
  const previewAspect =
    preview && preview.cols > 0 && preview.rows > 0
      ? preview.cols / preview.rows
      : aspect;
  const bottomFit = fitContain(
    previewAspect,
    1,
    Math.max(1, containerW),
    MAX_BOTTOM_H,
  );
  const bottomDrawW = bottomFit.drawW;
  const bottomDrawH = bottomFit.drawH;

  return (
    <div ref={containerRef} className="flex flex-col gap-3 flex-1 min-h-0">
      {/* ── ORIGINAL ─────────────────────────────────────────────────── */}
      <div className="flex flex-col">
        <div
          className={cn(
            "px-3 py-2 rounded-t-[8px] border border-[color:var(--color-border)] border-b-0",
            "bg-[color:var(--color-surface-elevated)]",
            "flex items-center justify-between gap-2",
            "font-mono text-[10.5px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]",
          )}
        >
          <span>
            <span className="text-[color:var(--color-ink-muted)] font-semibold">
              Original
            </span>
            {image && (
              <span className="ml-2 text-[color:var(--color-ink)]">
                {cropMmW}×{cropMmH} mm
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 normal-case tracking-normal">
            {image && (
              <div
                role="tablist"
                aria-label="Crop mode"
                className="inline-flex rounded-[4px] border border-[color:var(--color-border)] overflow-hidden"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={!cropEnabled}
                  onClick={() => onCropEnabledChange(false)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-mono",
                    !cropEnabled
                      ? "bg-[color:var(--color-primary)] text-white"
                      : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface)]",
                  )}
                >
                  Full image
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={cropEnabled}
                  onClick={() => onCropEnabledChange(true)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-mono border-l border-[color:var(--color-border)]",
                    cropEnabled
                      ? "bg-[color:var(--color-primary)] text-white"
                      : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface)]",
                  )}
                >
                  Crop
                </button>
              </div>
            )}
            <span className="text-[10px] tracking-[0.12em]">
              {image ? `${imgW}×${imgH} px` : "no image"}
            </span>
          </div>
        </div>
        <div
          className={cn(
            "relative rounded-b-[8px] border border-[color:var(--color-border)]",
            "bg-[color:var(--color-bg)] overflow-hidden",
            "flex items-center justify-center",
          )}
          style={{ height: image ? topDrawH : 220 }}
        >
          {image ? (
            <>
              <canvas
                ref={canvasRef}
                style={{
                  width: topDrawW,
                  height: topDrawH,
                  imageRendering: "pixelated",
                  display: "block",
                }}
              />
              {/* Crop frame overlay — absolutely positioned over the
                  canvas. Hidden entirely when the user is in
                  full-image mode. The dim mask + frame body + corner
                  handles all stay together so a single conditional
                  flips them in / out. */}
              {cropEnabled && (
              <div
                className="absolute"
                style={{
                  left: `calc(50% - ${topDrawW / 2}px)`,
                  top: `calc(50% - ${topDrawH / 2}px)`,
                  width: topDrawW,
                  height: topDrawH,
                  pointerEvents: "none",
                }}
              >
                {/* Outside-of-crop dim mask. Four rectangles around
                    the crop frame keep the cropped region untouched. */}
                <div
                  className="absolute bg-[color:var(--color-bg)]/60"
                  style={{ left: 0, top: 0, right: 0, height: frameTop }}
                />
                <div
                  className="absolute bg-[color:var(--color-bg)]/60"
                  style={{
                    left: 0,
                    top: frameTop + frameH,
                    right: 0,
                    bottom: 0,
                  }}
                />
                <div
                  className="absolute bg-[color:var(--color-bg)]/60"
                  style={{
                    left: 0,
                    top: frameTop,
                    width: frameLeft,
                    height: frameH,
                  }}
                />
                <div
                  className="absolute bg-[color:var(--color-bg)]/60"
                  style={{
                    left: frameLeft + frameW,
                    top: frameTop,
                    right: 0,
                    height: frameH,
                  }}
                />

                {/* Frame body — pointer-events on so drag works. */}
                <div
                  className={cn(
                    "absolute border-2 border-[color:var(--color-primary)]/80",
                    "shadow-[0_0_0_1px_rgba(0,0,0,0.35)]",
                    "cursor-move",
                  )}
                  style={{
                    left: frameLeft,
                    top: frameTop,
                    width: frameW,
                    height: frameH,
                    pointerEvents: "auto",
                  }}
                  onPointerDown={(e) => {
                    if (drag.kind !== "idle") return;
                    const canvas = canvasRef.current;
                    if (!canvas) return;
                    e.preventDefault();
                    const rect = canvas.getBoundingClientRect();
                    const sx = e.clientX - rect.left;
                    const sy = e.clientY - rect.top;
                    setDrag({
                      kind: "move",
                      offsetX: sx - frameLeft,
                      offsetY: sy - frameTop,
                    });
                  }}
                />

                {/* Corner handles. Each anchors the OPPOSITE corner. */}
                {(
                  [
                    { kind: "resize-tl", left: frameLeft, top: frameTop, anchorX: crop.x + crop.w, anchorY: crop.y + crop.h, cursor: "nwse-resize" },
                    { kind: "resize-tr", left: frameLeft + frameW, top: frameTop, anchorX: crop.x, anchorY: crop.y + crop.h, cursor: "nesw-resize" },
                    { kind: "resize-bl", left: frameLeft, top: frameTop + frameH, anchorX: crop.x + crop.w, anchorY: crop.y, cursor: "nesw-resize" },
                    { kind: "resize-br", left: frameLeft + frameW, top: frameTop + frameH, anchorX: crop.x, anchorY: crop.y, cursor: "nwse-resize" },
                  ] as const
                ).map((h) => (
                  <div
                    key={h.kind}
                    className={cn(
                      "absolute rounded-[2px] border border-[color:var(--color-primary)]",
                      "bg-[color:var(--color-surface)]",
                    )}
                    style={{
                      left: h.left - HANDLE_SIZE / 2,
                      top: h.top - HANDLE_SIZE / 2,
                      width: HANDLE_SIZE,
                      height: HANDLE_SIZE,
                      cursor: h.cursor,
                      pointerEvents: "auto",
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDrag({
                        kind: h.kind,
                        anchorX: h.anchorX,
                        anchorY: h.anchorY,
                      });
                    }}
                  />
                ))}
              </div>
              )}
            </>
          ) : (
            <div className="text-[12.5px] text-[color:var(--color-ink-subtle)] font-mono tracking-[0.04em]">
              upload an image to begin
            </div>
          )}
        </div>
      </div>

      {/* The bottom preview paints to a single canvas indexed by
        * cell position. Both modes (representative + original) draw
        * cells imperatively so the toggle is one redraw, not a 1024-
        * node SVG diff. */}
      {/* ── PIXELATED ────────────────────────────────────────────────── */}
      <div className="flex flex-col">
        <div
          className={cn(
            "px-3 py-2 rounded-t-[8px] border border-[color:var(--color-border)] border-b-0",
            "bg-[color:var(--color-surface-elevated)]",
            "flex items-center justify-between gap-2",
            "font-mono text-[10.5px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]",
          )}
        >
          <span>
            <span className="text-[color:var(--color-ink-muted)] font-semibold">
              {previewMode === "representative" ? "Pixelated" : "Source means"}
            </span>
            {preview && (
              <span className="opacity-60">
                {" · "}
                {preview.cols}×{preview.rows} cells · {preview.kColors}{" "}
                {previewMode === "representative"
                  ? `colours · ${preview.pathCount} paths`
                  : "centroids"}
              </span>
            )}
          </span>
          <div className="flex items-center gap-1 normal-case tracking-normal">
            <span className="text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
              show
            </span>
            <div
              role="tablist"
              aria-label="Preview rendering mode"
              className="inline-flex rounded-[4px] border border-[color:var(--color-border)] overflow-hidden"
            >
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "representative"}
                onClick={() => onPreviewModeChange("representative")}
                className={cn(
                  "px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-mono",
                  previewMode === "representative"
                    ? "bg-[color:var(--color-primary)] text-white"
                    : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface)]",
                )}
              >
                Representative
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "original"}
                onClick={() => onPreviewModeChange("original")}
                className={cn(
                  "px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-mono border-l border-[color:var(--color-border)]",
                  previewMode === "original"
                    ? "bg-[color:var(--color-primary)] text-white"
                    : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface)]",
                )}
              >
                Original
              </button>
            </div>
          </div>
        </div>
        <div
          className={cn(
            "rounded-b-[8px] border border-[color:var(--color-border)]",
            "bg-[color:var(--color-bg)]",
            "flex items-center justify-center",
          )}
          style={{ height: preview ? bottomDrawH : 220 }}
        >
          {preview ? (
            <canvas
              ref={previewCanvasRef}
              width={preview.cols}
              height={preview.rows}
              style={{
                width: bottomDrawW,
                height: bottomDrawH,
                imageRendering: "pixelated",
                display: "block",
              }}
              role="img"
              aria-label={
                previewMode === "representative"
                  ? "pixelated preview"
                  : "source means preview"
              }
            />
          ) : (
            <div className="text-[12.5px] text-[color:var(--color-ink-subtle)] font-mono tracking-[0.04em]">
              preview appears once an image is uploaded
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
