/**
 * Relief — depth-map smoothing.
 *
 * A grayscale depth map (height map for a relief carve) almost always
 * carries pepper noise, single-pixel spikes, and quantisation banding
 * that translate into ugly chatter when the laser rasters Z. This page
 * lets the user upload a depth map, dial in a bilateral / median smooth
 * on the backend (``POST /api/relief/smooth``), and A/B the raw vs.
 * cleaned result through a draggable wipe before exporting a full-res
 * cleaned PNG.
 *
 * Pipeline:
 *   - centre: ``ReliefCompare2D`` — original | cleaned split-compare.
 *   - preview runs on a downscaled copy (<=800px longest edge) with the
 *     spatial radius scaled to match, so dragging a slider re-renders in
 *     a few hundred ms instead of grinding on a 4k map.
 *   - export re-runs the smooth on the FULL-RES bitmap with the
 *     UNSCALED params, then downloads the PNG.
 *   - left:  two collapsible groups — ``CutoutControls`` (background +
 *     edge shaping) and ``SurfaceControls`` (denoise / stretch / layers).
 *   - right: source + export, plus ``ReliefInspect`` (luminance
 *     histogram, gradient thumbnail, % pixels changed).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, PageContainer, Section, Toolbar } from "../ui";
import { ReliefCompare2D } from "../components/relief/ReliefCompare2D";
import { ReliefSplit2D } from "../components/relief/ReliefSplit2D";
import { ReliefInspect } from "../components/relief/ReliefInspect";
import { ReliefSurface3D } from "../components/relief/ReliefSurface3D";
import { CollapsibleGroup } from "../components/relief/CollapsibleGroup";
import { CutoutControls } from "../components/relief/CutoutControls";
import { SurfaceControls } from "../components/relief/SurfaceControls";
import {
  DEFAULT_RELIEF_PARAMS,
  downscaleForPreview,
  reliefSmooth,
  sampleRgb,
  scaleParamsForPreview,
  type ReliefParams,
} from "./reliefHelpers";
import {
  DEFAULT_STRETCH_PARAMS,
  buildLut,
  applyLut,
  histogram,
  type StretchParams,
} from "../components/relief/stretch";

/** Preview re-render debounce. Long enough to coalesce a slider drag,
 *  short enough that a single change feels responsive. */
const DEBOUNCE_MS = 250;
/** Longest-edge cap for the preview smooth. The full-res export
 *  ignores this. */
const PREVIEW_MAX_EDGE = 800;

type Status = "idle" | "smoothing" | "ready" | "error";
/** Centre-preview view mode. */
type PreviewView = "2d" | "3d";
/** Overlay (2D wipe / single 3D surface) vs. side-by-side compare. */
type CompareMode = "overlay" | "split";
/** Which height-field the 3D surface displays. */
type SurfaceShow = "original" | "cleaned";

export function ReliefPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [params, setParams] = useState<ReliefParams>(DEFAULT_RELIEF_PARAMS);
  const [stretchParams, setStretchParams] = useState<StretchParams>(
    DEFAULT_STRETCH_PARAMS,
  );
  // Build the background removal opts passed to reliefSmooth at BOTH call
  // sites (debounced preview + export).  Extracted so adding new fields here
  // automatically propagates to both.
  const bgOpts = useCallback(
    () =>
      stretchParams.removeBackground
        ? {
            mode: stretchParams.bgMode,
            threshold: stretchParams.bgThreshold,
            color: stretchParams.bgColor,
            tolerance: stretchParams.bgTolerance,
            perimeterPct: stretchParams.perimeterEnabled
              ? stretchParams.perimeterPct
              : 0,
            trimPct: stretchParams.trimEnabled ? stretchParams.trimPct : 0,
            falloffPct: stretchParams.falloffEnabled
              ? stretchParams.falloffPct
              : 0,
            falloffMode: stretchParams.falloffMode,
            falloffTarget: stretchParams.falloffTarget,
            falloffIntensity: stretchParams.falloffIntensity,
          }
        : undefined,
    [
      stretchParams.removeBackground,
      stretchParams.bgMode,
      stretchParams.bgThreshold,
      stretchParams.bgColor,
      stretchParams.bgTolerance,
      stretchParams.perimeterEnabled,
      stretchParams.perimeterPct,
      stretchParams.trimEnabled,
      stretchParams.trimPct,
      stretchParams.falloffEnabled,
      stretchParams.falloffPct,
      stretchParams.falloffMode,
      stretchParams.falloffTarget,
      stretchParams.falloffIntensity,
    ],
  );

  // Active LUT (monotonic modes) — passed to the inspect curve overlay; null
  // for none/clahe so the overlay draws nothing.
  const [lut, setLut] = useState<Uint8Array | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [smoothedUrl, setSmoothedUrl] = useState<string | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null); // final (post-stretch)
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Bumping forces the preview effect to re-run even when nothing else
  // changed — drives the manual "Re-render" button.
  const [renderTick, setRenderTick] = useState(0);

  // Centre preview: 2D wipe-compare vs. orbitable 3D surface. The 3D
  // surface flips between the source and cleaned height-fields via `show`
  // (default cleaned — the result is what the user is dialling in).
  const [view, setView] = useState<PreviewView>("2d");
  const [compare, setCompare] = useState<CompareMode>("overlay");
  const [show, setShow] = useState<SurfaceShow>("cleaned");

  // Object-URL bookkeeping so we can revoke on replace / unmount and
  // never leak. ``cleanedUrl`` is also stored in a ref so the async
  // preview effect can revoke the PREVIOUS one without listing the URL
  // as a dependency (which would re-fire the effect on every render).
  const smoothedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    smoothedUrlRef.current = smoothedUrl;
  }, [smoothedUrl]);
  const cleanedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    cleanedUrlRef.current = cleanedUrl;
  }, [cleanedUrl]);

  // Mirror the current bitmap into a ref so the unmount cleanup can close
  // it (freeing the decoded buffer) without re-running on every change.
  const bitmapRef = useRef<ImageBitmap | null>(null);
  useEffect(() => {
    bitmapRef.current = bitmap;
  }, [bitmap]);

  // Monotonic request id — the latest async preview wins; any earlier
  // in-flight smooth that resolves late is discarded so a slow request
  // can't clobber a newer result.
  const reqIdRef = useRef(0);

  // Decoded pixel buffers for the inspect strip (histogram / gradient /
  // % changed). We deliberately sample the SAME downscaled geometry for
  // both so "% pixels changed" is meaningful: ``originalData`` is the
  // source bitmap drawn to the cleaned preview's dimensions, and
  // ``cleanedData`` is the cleaned preview itself. If the cleaned image
  // hasn't loaded yet they simply stay null and the panel shows muted
  // placeholders — never a crash.
  const [originalData, setOriginalData] = useState<ImageData | null>(null);
  const [smoothedData, setSmoothedData] = useState<ImageData | null>(null);
  const [cleanedData, setCleanedData] = useState<ImageData | null>(null); // final (post-stretch)

  // Eyedropper: when true, the next click on the source thumbnail samples a colour.
  const [pickingColor, setPickingColor] = useState(false);

  // Click handler for the source-image wrapper (eyedropper mode). The source
  // thumbnail is displayed at width:100% with natural aspect, so
  // (clientX - r.left) / r.width maps directly to a fractional pixel in
  // originalData (same aspect as the source bitmap).
  const onSourceClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!pickingColor || !originalData) return;
      const r = e.currentTarget.getBoundingClientRect();
      const rgb = sampleRgb(
        originalData,
        (e.clientX - r.left) / r.width,
        (e.clientY - r.top) / r.height,
      );
      setStretchParams((p) => ({
        ...p,
        bgColor: rgb,
        bgMode: "colour",
        removeBackground: true,
      }));
      setPickingColor(false);
    },
    [pickingColor, originalData],
  );

  // Eyedropper pick from the main 2D preview: ReliefCompare2D hands back the
  // clicked position as image fractions (letterbox already accounted for).
  const onPickFraction = useCallback(
    (fx: number, fy: number) => {
      if (!originalData) return;
      const rgb = sampleRgb(originalData, fx, fy);
      setStretchParams((p) => ({ ...p, bgColor: rgb, bgMode: "colour", removeBackground: true }));
      setPickingColor(false);
    },
    [originalData],
  );

  // ── File decode ───────────────────────────────────────────────────
  const onFile = useCallback(async (file: File) => {
    setErrorMsg(null);
    try {
      const bmp = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      // Close the previous bitmap before swapping — ImageBitmap memory is
      // not GC'd promptly, so a 4k depth map would leak on every Replace.
      setBitmap((prev) => {
        prev?.close();
        return bmp;
      });
      // Swap in the new original URL, revoking the old one first.
      setOriginalUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    } catch (err) {
      setStatus("error");
      setErrorMsg(`Couldn't read that image: ${(err as Error).message}`);
    }
  }, []);

  // ── Debounced preview smooth ──────────────────────────────────────
  useEffect(() => {
    if (!bitmap) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const myReq = ++reqIdRef.current;
      setStatus("smoothing");
      setErrorMsg(null);
      void (async () => {
        try {
          const { blob, ratio } = await downscaleForPreview(
            bitmap,
            PREVIEW_MAX_EDGE,
          );
          const opts = {
            clahe:
              stretchParams.mode === "clahe"
                ? {
                    clipLimit: stretchParams.claheClipLimit,
                    tiles: stretchParams.claheTiles,
                  }
                : undefined,
            background: bgOpts(),
          };
          const smoothed = await reliefSmooth(
            blob,
            scaleParamsForPreview(params, ratio),
            opts,
          );
          // Stale guard: a newer request started while we awaited.
          if (cancelled || myReq !== reqIdRef.current) return;
          const url = URL.createObjectURL(smoothed);
          // Revoke the previous smoothed URL before swapping in the new
          // one. Read from the ref so we don't depend on smoothedUrl.
          if (smoothedUrlRef.current) URL.revokeObjectURL(smoothedUrlRef.current);
          setSmoothedUrl(url);
          setStatus("ready");
        } catch (err) {
          if (cancelled || myReq !== reqIdRef.current) return;
          setStatus("error");
          setErrorMsg(`Smoothing failed: ${(err as Error).message}`);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // Only the SMOOTHING fields re-trigger a preview. targetLayers /
    // zDescentPerLayers are Phase-2 pass-through and must NOT cost a
    // backend round-trip, so they're deliberately excluded here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bitmap,
    params.strength,
    params.edgePreserve,
    params.edgeThreshold,
    params.spikeRemoval,
    params.medianKsize,
    params.smoothEnabled,
    // CLAHE and background removal are the stretch features that touch the
    // backend. A boolean for CLAHE so switching between monotonic modes
    // doesn't cost a round-trip. bgOpts covers all background-removal fields.
    stretchParams.mode === "clahe",
    stretchParams.claheClipLimit,
    stretchParams.claheTiles,
    bgOpts,
    renderTick,
  ]);

  // ── Unmount cleanup ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (smoothedUrlRef.current) URL.revokeObjectURL(smoothedUrlRef.current);
      if (cleanedUrlRef.current) URL.revokeObjectURL(cleanedUrlRef.current);
      bitmapRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on unmount only
  }, []);

  // ── Inspect buffers: decode bitmap + smoothed preview to ImageData ─
  // The smoothed preview (backend result, pre-stretch) is a downscaled PNG;
  // we draw the source bitmap to the SAME dimensions so the histogram,
  // gradient, and "% changed" all line up. The client stretch effect below
  // turns ``smoothedData`` into the final ``cleanedData``.
  useEffect(() => {
    if (!bitmap || !smoothedUrl) {
      setOriginalData(null);
      setSmoothedData(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w <= 0 || h <= 0) return;
      try {
        // Smoothed preview → ImageData.
        const cc = document.createElement("canvas");
        cc.width = w;
        cc.height = h;
        const cctx = cc.getContext("2d", { willReadFrequently: true });
        if (!cctx) return;
        cctx.drawImage(img, 0, 0);
        const smoothed = cctx.getImageData(0, 0, w, h);

        // Source bitmap drawn to the SAME box → ImageData (so the diff is
        // apples-to-apples even though the preview is downscaled).
        const oc = document.createElement("canvas");
        oc.width = w;
        oc.height = h;
        const octx = oc.getContext("2d", { willReadFrequently: true });
        if (!octx) return;
        octx.drawImage(bitmap, 0, 0, w, h);
        const original = octx.getImageData(0, 0, w, h);

        if (cancelled) return;
        setOriginalData(original);
        setSmoothedData(smoothed);
      } catch {
        // getImageData can throw on a tainted canvas; degrade gracefully.
        if (!cancelled) {
          setOriginalData(null);
          setSmoothedData(null);
        }
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setOriginalData(null);
        setSmoothedData(null);
      }
    };
    img.src = smoothedUrl;
    return () => {
      cancelled = true;
    };
  }, [bitmap, smoothedUrl]);

  // ── Client tone-stretch: smoothedData → final cleanedData (+ URL) ─────
  // Monotonic modes (linear/gamma/asinh/equalize) are a 256-LUT applied here
  // in the browser — instant, no backend round-trip. CLAHE is resolved on the
  // backend already, so its LUT is identity and this just forwards the result.
  useEffect(() => {
    if (!smoothedData) {
      setCleanedData(null);
      setLut(null);
      if (cleanedUrlRef.current) {
        URL.revokeObjectURL(cleanedUrlRef.current);
        setCleanedUrl(null);
      }
      return;
    }
    const built = buildLut(stretchParams, histogram(smoothedData));
    const out = applyLut(smoothedData, built);
    setCleanedData(out);
    setLut(
      stretchParams.mode === "none" || stretchParams.mode === "clahe"
        ? null
        : built,
    );

    // Re-encode for the 2D wipe (cleanedUrl). Cheap at the ≤800px preview size.
    let cancelled = false;
    const canvas = document.createElement("canvas");
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.putImageData(out, 0, 0);
      canvas.toBlob((b) => {
        if (cancelled || !b) return;
        const url = URL.createObjectURL(b);
        if (cleanedUrlRef.current) URL.revokeObjectURL(cleanedUrlRef.current);
        setCleanedUrl(url);
      }, "image/png");
    }
    return () => {
      cancelled = true;
    };
  }, [
    smoothedData,
    stretchParams.mode,
    stretchParams.clipLowPct,
    stretchParams.clipHighPct,
    stretchParams.clipPct,
    stretchParams.gamma,
    stretchParams.asinhStrength,
    stretchParams.removeEmptyLayers,
  ]);

  // ── Export: full-res, unscaled params ─────────────────────────────
  const onExport = useCallback(async () => {
    if (!bitmap) return;
    setExporting(true);
    setErrorMsg(null);
    try {
      // Re-encode the FULL-RES bitmap to a PNG blob via a hidden canvas.
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2D context");
      ctx.drawImage(bitmap, 0, 0);
      const fullBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/png",
        ),
      );
      const opts = {
        clahe:
          stretchParams.mode === "clahe"
            ? {
                clipLimit: stretchParams.claheClipLimit,
                tiles: stretchParams.claheTiles,
              }
            : undefined,
        background: bgOpts(),
      };
      const smoothed = await reliefSmooth(fullBlob, params, opts);

      // Apply the SAME client LUT to the full-res result (identity for CLAHE),
      // so the exported PNG matches the preview exactly.
      const smoothedBitmap = await createImageBitmap(smoothed);
      const oc = document.createElement("canvas");
      oc.width = smoothedBitmap.width;
      oc.height = smoothedBitmap.height;
      const octx = oc.getContext("2d", { willReadFrequently: true });
      if (!octx) throw new Error("Failed to get 2D context");
      octx.drawImage(smoothedBitmap, 0, 0);
      smoothedBitmap.close();
      const srcData = octx.getImageData(0, 0, oc.width, oc.height);
      const finalData = applyLut(
        srcData,
        buildLut(stretchParams, histogram(srcData)),
      );
      octx.putImageData(finalData, 0, 0);
      const finalBlob = await new Promise<Blob>((resolve, reject) =>
        oc.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/png",
        ),
      );
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "relief.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setStatus("error");
      setErrorMsg(`Export failed: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [bitmap, params, stretchParams, bgOpts]);

  // ── Centre host: measure CSS box for the compare canvas ───────────
  // The host is mounted only once a depth map exists, so attach the
  // ResizeObserver via a CALLBACK REF — a mount-time effect would run
  // before the (conditionally-rendered) host is in the DOM and would
  // measure nothing, leaving the canvas stuck at 0×0.
  const [hostW, setHostW] = useState(0);
  const [hostH, setHostH] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const hostCallbackRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const measure = () => {
      setHostW(el.clientWidth);
      setHostH(el.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const statusLabel: Record<Status, string> = {
    idle: "Awaiting depth map",
    smoothing: "Smoothing…",
    ready: "Ready",
    error: "Error",
  };

  return (
    <div
      className="relative flex flex-col"
      style={{ height: "calc(100dvh - 56px)" }}
    >
      {/* Diagonal warp backdrop — quiet, always-on brand motif. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--color-ink) 0 1px, transparent 1px 24px)",
        }}
      />
      <PageContainer
        maxWidth="wide"
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden pt-3 pb-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />

        {/* ── Toolbar: title + status + page actions ─────────────────── */}
        <Toolbar
          trailing={
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={!bitmap || status === "smoothing"}
                onClick={() => setRenderTick((t) => t + 1)}
              >
                Re-render
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!bitmap}
                onClick={() => fileInputRef.current?.click()}
              >
                {bitmap ? "Replace…" : "Upload…"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!bitmap || exporting}
                onClick={() => void onExport()}
              >
                {exporting ? "Exporting…" : "Export cleaned PNG"}
              </Button>
            </>
          }
        >
          <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-ink)]">
            Relief
          </span>
          <span
            className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-[color:var(--color-ink-muted)]"
            aria-live="polite"
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  status === "error"
                    ? "var(--color-destructive)"
                    : status === "smoothing"
                      ? "var(--color-secondary)"
                      : status === "ready"
                        ? "var(--color-primary)"
                        : "var(--color-ink-subtle)",
              }}
            />
            {statusLabel[status]}
          </span>
        </Toolbar>

        {errorMsg && (
          <div className="mb-3 shrink-0 rounded-[8px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
            {errorMsg}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_300px] items-stretch gap-4">
          {/* ── Settings (left) — Cutout + Surface groups ────────────── */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            <CollapsibleGroup
              title="Cutout"
              storageKey="relief.group.cutout"
              hint="Lift the object off its background, then shape the cut edge. The edge controls depend on background removal."
            >
              <CutoutControls
                params={stretchParams}
                onChange={setStretchParams}
                onPickColor={() => setPickingColor(true)}
              />
            </CollapsibleGroup>
            <CollapsibleGroup
              title="Surface"
              storageKey="relief.group.surface"
              hint="Shape the height-field itself: denoise, tone stretch, and layer hints."
            >
              <SurfaceControls
                reliefParams={params}
                onReliefChange={setParams}
                stretchParams={stretchParams}
                onStretchChange={setStretchParams}
              />
            </CollapsibleGroup>
          </div>

          {/* ── Compare (centre) ────────────────────────────────────── */}
          <div className="flex min-h-0 min-w-0">
            <Card padded={false} className="flex min-h-0 flex-1 flex-col p-3">
              {bitmap ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
                  {/* View chrome: 2D ↔ 3D, overlay ↔ side-by-side, plus the
                      3D orig/clean flip (overlay only). */}
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <SegmentedControl<PreviewView>
                      label="preview view"
                      value={view}
                      onChange={setView}
                      options={[
                        { id: "2d", label: "2D" },
                        { id: "3d", label: "3D" },
                      ]}
                    />
                    <SegmentedControl<CompareMode>
                      label="compare mode"
                      value={compare}
                      onChange={setCompare}
                      options={[
                        { id: "overlay", label: "Overlay" },
                        { id: "split", label: "Side-by-side" },
                      ]}
                    />
                    {view === "3d" && compare === "overlay" && (
                      <SegmentedControl<SurfaceShow>
                        label="surface source"
                        value={show}
                        onChange={setShow}
                        className="ml-auto"
                        options={[
                          { id: "original", label: "Original" },
                          { id: "cleaned", label: "Cleaned" },
                        ]}
                      />
                    )}
                  </div>

                  <div
                    ref={hostCallbackRef}
                    className="min-h-0 min-w-0 flex-1 rounded-[6px]"
                    style={{
                      backgroundColor: "var(--color-surface)",
                      backgroundImage:
                        "repeating-conic-gradient(var(--color-border) 0% 25%, transparent 0% 50%)",
                      backgroundSize: "16px 16px",
                    }}
                  >
                    {view === "2d" ? (
                      compare === "split" ? (
                        <ReliefSplit2D
                          originalUrl={originalUrl}
                          cleanedUrl={cleanedUrl}
                          picking={pickingColor}
                          onPick={onPickFraction}
                        />
                      ) : (
                        <ReliefCompare2D
                          originalUrl={originalUrl}
                          cleanedUrl={cleanedUrl}
                          width={hostW}
                          height={hostH}
                          picking={pickingColor}
                          onPick={onPickFraction}
                        />
                      )
                    ) : compare === "split" ? (
                      <ReliefSurface3D
                        heightData={originalData}
                        compareData={cleanedData}
                        labels={["original", "cleaned"]}
                        show="original"
                        width={hostW}
                        height={hostH}
                      />
                    ) : (
                      <ReliefSurface3D
                        heightData={
                          show === "cleaned" ? cleanedData : originalData
                        }
                        show={show}
                        width={hostW}
                        height={hostH}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <EmptyState
                    title="Upload a grayscale depth map to begin"
                    description="Drop in a height map and Relief will smooth out pepper noise, single-pixel spikes, and banding before you carve."
                    action={
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Upload depth map
                      </Button>
                    }
                  />
                </div>
              )}
            </Card>
          </div>

          {/* ── Source / export / inspect (right) ───────────────────── */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pl-1">
            <Card padded={false} className="flex flex-col gap-3 p-4">
              <Section title="Source" dense>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {bitmap ? "Replace depth map…" : "Upload depth map…"}
                </Button>
                {bitmap && originalUrl && (
                  <>
                    {/* Source thumbnail — also the eyedropper click target.
                        Displayed at natural aspect so (clientX–r.left)/r.width
                        maps directly to a fractional pixel in originalData. */}
                    <div
                      onClick={onSourceClick}
                      style={
                        pickingColor && originalData
                          ? { cursor: "crosshair" }
                          : undefined
                      }
                      className="mt-1 overflow-hidden rounded-[4px]"
                      title={
                        pickingColor
                          ? "Click to sample a background colour"
                          : undefined
                      }
                    >
                      <img
                        src={originalUrl}
                        alt="Source depth map"
                        className="block w-full"
                        draggable={false}
                      />
                    </div>
                    <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 font-mono text-[11px] tabular-nums">
                      <RowStat
                        label="Dimensions"
                        value={`${bitmap.width} × ${bitmap.height}`}
                      />
                      <RowStat
                        label="Preview cap"
                        value={`${PREVIEW_MAX_EDGE}px`}
                      />
                    </dl>
                  </>
                )}
              </Section>
              <Section title="Export" dense>
                <p className="text-[12px] leading-relaxed text-[color:var(--color-ink-muted)]">
                  Re-smooths the full-resolution map (unscaled) and
                  downloads a cleaned PNG.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  disabled={!bitmap || exporting}
                  onClick={() => void onExport()}
                >
                  {exporting ? "Exporting…" : "Export cleaned PNG"}
                </Button>
              </Section>
            </Card>

            {/* Inspect strip — histogram, gradient, % changed. */}
            {bitmap && (
              <Card padded={false} className="flex flex-col p-4">
                <ReliefInspect
                  originalData={originalData}
                  cleanedData={cleanedData}
                  lut={lut}
                />
              </Card>
            )}
          </div>
        </div>
      </PageContainer>
    </div>
  );
}

/**
 * SegmentedControl — on-brand pill toggle.
 *
 * Matches the Workshop-instrument register used elsewhere (Exposure
 * toolbar, lens pills): a hairline-bordered ``inline-flex`` of mono
 * uppercase segments, the active one filled with the ember primary. A
 * 1-px metallic seam separates segments so the control reads as a milled
 * bar rather than plain buttons. ``role="radiogroup"`` for a11y.
 */
function SegmentedControl<Id extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: Id;
  onChange: (id: Id) => void;
  options: { id: Id; label: string }[];
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={
        "inline-flex overflow-hidden rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)]" +
        (className ? " " + className : "")
      }
    >
      {options.map((opt, i) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={
              "relative whitespace-nowrap px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-primary)]/50 " +
              (i > 0
                ? "border-l border-[color:var(--color-border)] "
                : "") +
              (active
                ? "bg-[color:var(--color-primary)] text-white"
                : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-ink)]")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Compact label / value row for the mono stat lists. */
function RowStat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="self-center text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-ink-subtle)]">
        {label}
      </dt>
      <dd className="self-center text-right text-[color:var(--color-ink)]">
        {value}
      </dd>
    </>
  );
}
