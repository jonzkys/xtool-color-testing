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
 *
 * The smoothing controls themselves land in the next task — the left
 * column is a placeholder Card for now.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, PageContainer, Section, Toolbar } from "../ui";
import { ReliefCompare2D } from "../components/relief/ReliefCompare2D";
import {
  DEFAULT_RELIEF_PARAMS,
  downscaleForPreview,
  reliefSmooth,
  scaleParamsForPreview,
  type ReliefParams,
} from "./reliefHelpers";

/** Preview re-render debounce. Long enough to coalesce a slider drag,
 *  short enough that a single change feels responsive. */
const DEBOUNCE_MS = 250;
/** Longest-edge cap for the preview smooth. The full-res export
 *  ignores this. */
const PREVIEW_MAX_EDGE = 800;

type Status = "idle" | "smoothing" | "ready" | "error";

export function ReliefPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [params, setParams] = useState<ReliefParams>(DEFAULT_RELIEF_PARAMS);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Bumping forces the preview effect to re-run even when nothing else
  // changed — drives the manual "Re-render" button.
  const [renderTick, setRenderTick] = useState(0);

  // Object-URL bookkeeping so we can revoke on replace / unmount and
  // never leak. ``cleanedUrl`` is also stored in a ref so the async
  // preview effect can revoke the PREVIOUS one without listing the URL
  // as a dependency (which would re-fire the effect on every render).
  const cleanedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    cleanedUrlRef.current = cleanedUrl;
  }, [cleanedUrl]);

  // Monotonic request id — the latest async preview wins; any earlier
  // in-flight smooth that resolves late is discarded so a slow request
  // can't clobber a newer result.
  const reqIdRef = useRef(0);

  // ── File decode ───────────────────────────────────────────────────
  const onFile = useCallback(async (file: File) => {
    setErrorMsg(null);
    try {
      const bmp = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      setBitmap(bmp);
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
          const cleaned = await reliefSmooth(
            blob,
            scaleParamsForPreview(params, ratio),
          );
          // Stale guard: a newer request started while we awaited.
          if (cancelled || myReq !== reqIdRef.current) return;
          const url = URL.createObjectURL(cleaned);
          // Revoke the previous cleaned URL before swapping in the new
          // one. Read from the ref so we don't depend on cleanedUrl.
          if (cleanedUrlRef.current) URL.revokeObjectURL(cleanedUrlRef.current);
          setCleanedUrl(url);
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
  }, [bitmap, params, renderTick]);

  // ── Unmount cleanup ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (cleanedUrlRef.current) URL.revokeObjectURL(cleanedUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on unmount only
  }, []);

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
      const cleaned = await reliefSmooth(fullBlob, params);
      const url = URL.createObjectURL(cleaned);
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
  }, [bitmap, params]);

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

  // Keep params referenced until the controls task wires real inputs —
  // setParams is what the next task will hang sliders off of.
  void setParams;

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
          {/* ── Settings (left) — controls land next task ───────────── */}
          <div className="flex min-h-0 flex-col overflow-y-auto pr-1">
            <Card padded={false} className="flex flex-col gap-3 p-4">
              <Section
                title="Smoothing"
                dense
                titleHint="Bilateral / median smoothing of the depth map."
              >
                <p className="text-[12px] leading-relaxed text-[color:var(--color-ink-muted)]">
                  Smoothing controls land in the next step — strength,
                  edge preservation, and spike removal. For now the
                  preview runs with the default profile.
                </p>
              </Section>
              <Section title="Profile" dense>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 font-mono text-[11px] tabular-nums">
                  <RowStat label="Strength" value={String(params.strength)} />
                  <RowStat
                    label="Edge preserve"
                    value={params.edgePreserve ? "on" : "off"}
                  />
                  <RowStat
                    label="Edge thresh"
                    value={String(params.edgeThreshold)}
                  />
                  <RowStat
                    label="Spike removal"
                    value={params.spikeRemoval ? "on" : "off"}
                  />
                  <RowStat
                    label="Median k"
                    value={String(params.medianKsize)}
                  />
                </dl>
              </Section>
            </Card>
          </div>

          {/* ── Compare (centre) ────────────────────────────────────── */}
          <div className="flex min-h-0 min-w-0">
            <Card padded={false} className="flex min-h-0 flex-1 flex-col p-3">
              {bitmap ? (
                <div ref={hostCallbackRef} className="min-h-0 min-w-0 flex-1">
                  <ReliefCompare2D
                    originalUrl={originalUrl}
                    cleanedUrl={cleanedUrl}
                    width={hostW}
                    height={hostH}
                  />
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

          {/* ── Source / export (right) ─────────────────────────────── */}
          <div className="flex min-h-0 flex-col self-start max-h-full">
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
                {bitmap && (
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
          </div>
        </div>
      </PageContainer>
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
