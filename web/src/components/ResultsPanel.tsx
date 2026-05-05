import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bug, Camera, LineChart, RotateCcw, Trash2, Upload } from "lucide-react";
import type { ResultRecord } from "../types";
import { useAuthedImage } from "../hooks/useAuthedImage";
import { ResultDetailDialog } from "./ResultDetailDialog";
import { ResultDebugDialog } from "./ResultDebugDialog";
import {
  listResults,
  uploadResult,
  patchResult,
  deleteResult,
  reingestResult,
} from "../api/results";
import { useIsDemo } from "../hooks/useIsDemo";
import { formatMissingCorners } from "./captureWarnings";
import { useRoute } from "../router";
import {
  Badge,
  Button,
  cn,
  DemoLock,
  EmptyState,
  Section,
} from "../ui";

export function ResultsPanel({
  testId,
  locked: _locked,
}: {
  testId: number;
  locked: boolean;
}) {
  const isDemo = useIsDemo();
  const [, navigate] = useRoute();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailResult = results.find((r) => r.id === detailId) ?? null;
  const [debugId, setDebugId] = useState<number | null>(null);
  const [reingestingId, setReingestingId] = useState<number | null>(null);

  async function refresh() {
    try {
      const r = await listResults(testId);
      setResults(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [testId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-page refresh signal — dispatched by UploadResultDialog
  // after a successful upload (and by other places that mutate
  // results out-of-band, e.g. the aggregator change in
  // ResultDetailDialog). Triggers a refetch when the new/updated
  // result belongs to this test.
  useEffect(() => {
    function onRefetch(e: Event) {
      const detail = (e as CustomEvent<{ testId?: number }>).detail;
      if (detail?.testId == null || detail.testId === testId) {
        void refresh();
      }
    }
    window.addEventListener("result:refetch", onRefetch);
    return () => window.removeEventListener("result:refetch", onRefetch);
  }, [testId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      await uploadResult(testId, file);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function toggleExclude(rid: number, excluded: boolean) {
    await patchResult(rid, { excluded });
    await refresh();
  }

  async function onDeleteResult(rid: number) {
    if (!confirm("Delete this result?")) return;
    await deleteResult(rid);
    await refresh();
  }

  async function reingest(rid: number) {
    setReingestingId(rid);
    try {
      await reingestResult(rid);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      console.error("Reingest failed:", err);
    } finally {
      setReingestingId(null);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    void onUpload(e);
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="shrink-0 flex flex-col gap-2">
        <DemoLock label="Uploading photos is disabled in the demo.">
          <Button
            variant="primary"
            className="w-full"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? (
              <Upload className="h-4 w-4 animate-pulse" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            {busy ? "Uploading…" : "Upload photo"}
          </Button>
        </DemoLock>
        {/* Cross-link to the Stability page's deep-dive view for this
         *  test — handles burn-vs-camera σ stats, calibrate fits, and
         *  the per-cell consensus → palette ingest flow. The averaged-
         *  swatch picker that used to live below the results list got
         *  removed once Stability gained the same capability with a
         *  much roomier canvas. */}
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => navigate({ name: "stability", id: testId })}
          title="Open this test in Stability — multi-result analysis, calibration, and palette ingest live there"
        >
          <LineChart className="h-4 w-4" />
          View in Stability
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={busy || isDemo}
        onChange={handleFileChange}
        className="hidden"
      />
      {error && (
        <div className="shrink-0 rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      )}

      {/* Results fill the remaining panel height. The averaged-swatch
       *  selection grid + "Ingest to palette" card that used to share
       *  this column got moved to the Stability page (INGEST mode for
       *  sweep tests, VALIDATE for validation), so the results list
       *  no longer needs to compete for vertical space. */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <Section
          title={`Results (${results.length})`}
          dense
        >
          {results.length === 0 ? (
            <EmptyState
              icon={<Camera className="h-5 w-5" />}
              title="No results yet"
              description="Burn the test and photograph the sheet, then upload the image. Fiducial markers align it automatically."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {results.map((r) => (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailId(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailId(r.id);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-[8px] border px-2.5 py-2 bg-[color:var(--color-surface)]",
                    "cursor-pointer transition-colors",
                    "hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-elevated)]",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40",
                    r.excluded
                      ? "border-[color:var(--color-border)] opacity-50"
                      : "border-[color:var(--color-border)]",
                  )}
                >
                  <ResultThumbnail imageUrl={r.image_url} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 font-mono text-[12px] text-[color:var(--color-ink)]">
                      <span>#{r.id}</span>
                      {(r.retest_index ?? 0) > 0 && (
                        <span
                          title="Retest index from the QR — distinguishes repeat burns of this test"
                          className={cn(
                            "inline-flex items-center h-4 px-1.5 rounded-[3px]",
                            "font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase",
                            "border border-[color:var(--color-primary)]/40",
                            "bg-[color:var(--color-primary-tint)]",
                            "text-[color:var(--color-primary)]",
                          )}
                        >
                          retest #{r.retest_index}
                        </span>
                      )}
                      {(r.missing_markers?.length ?? 0) > 0 && (
                        <Badge
                          variant="warning"
                          size="sm"
                          title={`${r.missing_markers!.length} of 3 ArUco markers missing — colours near ${formatMissingCorners(r.missing_markers!)} may be inaccurate`}
                          aria-label="Capture warning"
                        >
                          <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} />
                          {r.missing_markers!.length}/3
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-[color:var(--color-ink-muted)]">
                      {new Date(r.uploaded_at).toLocaleString()}
                    </div>
                    <div className="text-[11px] text-[color:var(--color-ink-subtle)]">
                      {r.swatches.length} swatches · max σ{" "}
                      {Math.max(...r.swatches.map((s) => s.sigma), 0).toFixed(1)}
                    </div>
                  </div>
                  <label
                    className="flex items-center gap-1 text-[11px] text-[color:var(--color-ink-muted)]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={r.excluded}
                      onChange={(e) => toggleExclude(r.id, e.target.checked)}
                      disabled={isDemo}
                      title={isDemo ? "Excluding results is disabled in the demo." : undefined}
                    />
                    exclude
                  </label>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDebugId(r.id);
                    }}
                    className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-tint)]"
                    title="Debug — warped+grid overlay and per-row actual vs captured"
                    aria-label="Debug result"
                  >
                    <Bug className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void reingest(r.id);
                    }}
                    disabled={isDemo || reingestingId === r.id}
                    className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-tint)] disabled:opacity-50"
                    title={isDemo
                      ? "Reingesting is disabled in the demo."
                      : "Reingest — re-run capture on the saved photo"}
                    aria-label="Reingest result"
                  >
                    <RotateCcw className={cn(
                      "h-3.5 w-3.5",
                      reingestingId === r.id && "animate-spin",
                    )} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteResult(r.id);
                    }}
                    className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
                    title={isDemo ? "Deleting results is disabled in the demo." : "Delete result"}
                    disabled={isDemo}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <ResultDetailDialog
        open={detailId !== null}
        onOpenChange={(o) => !o && setDetailId(null)}
        result={detailResult}
      />
      <ResultDebugDialog
        open={debugId !== null}
        onOpenChange={(o) => !o && setDebugId(null)}
        resultId={debugId}
      />
    </div>
  );
}

// Result image URLs are auth-gated ``/api/results/{rid}/image`` endpoints.
// In split-origin deployments (CloudFront frontend + separate API host) a
// bare ``<img src={image_url}>`` fetches relative to the page origin and
// can't carry the ``X-User-Id`` header either way. useAuthedImage fetches
// the bytes through the app's auth-decorated fetch and hands us a blob URL.
function ResultThumbnail({ imageUrl }: { imageUrl: string }) {
  const blobUrl = useAuthedImage(imageUrl);
  return (
    <div
      aria-hidden={!blobUrl}
      className={cn(
        "w-12 h-12 rounded-[6px] border border-[color:var(--color-border-strong)] shrink-0 overflow-hidden",
        blobUrl
          ? "bg-[color:var(--color-surface)]"
          : "bg-[color:var(--color-surface-elevated)] animate-pulse",
      )}
    >
      {blobUrl && (
        <img
          src={blobUrl}
          alt=""
          className="w-full h-full object-cover"
        />
      )}
    </div>
  );
}
