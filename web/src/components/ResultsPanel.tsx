import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, RotateCcw, Trash2, Upload } from "lucide-react";
import type { AveragedSwatch, ResultRecord } from "../types";
import { useAuthedImage } from "../hooks/useAuthedImage";
import { ResultDetailDialog } from "./ResultDetailDialog";
import {
  listResults,
  uploadResult,
  patchResult,
  deleteResult,
  reingestResult,
  getAveragedSwatches,
  ingestToPalette,
} from "../api/results";
import { useIsDemo } from "../hooks/useIsDemo";
import { formatMissingCorners } from "./captureWarnings";
import {
  Badge,
  Button,
  Card,
  cn,
  DemoLock,
  EmptyState,
  Section,
  Select,
} from "../ui";

const SIGMA_WARN = 10;

export function ResultsPanel({
  testId,
  locked: _locked,
}: {
  testId: number;
  locked: boolean;
}) {
  const isDemo = useIsDemo();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [averaged, setAveragedSwatches] = useState<AveragedSwatch[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<"averaged" | "single_result">("averaged");
  const [sourceResultId, setSourceResultId] = useState<number | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailResult = results.find((r) => r.id === detailId) ?? null;
  const [reingestingId, setReingestingId] = useState<number | null>(null);

  async function refresh(opts: { autoSelect?: boolean } = {}) {
    try {
      const [r, a] = await Promise.all([
        listResults(testId),
        getAveragedSwatches(testId),
      ]);
      setResults(r);
      setAveragedSwatches(a);
      if (opts.autoSelect) {
        const picks: Record<number, boolean> = {};
        a.forEach((s, i) => {
          if (s.sample_count > 0) picks[i] = true;
        });
        setSelected(picks);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh({ autoSelect: true });
  }, [testId]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectAll() {
    const picks: Record<number, boolean> = {};
    averaged.forEach((s, i) => {
      if (s.sample_count > 0) picks[i] = true;
    });
    setSelected(picks);
  }
  function clearSelection() {
    setSelected({});
  }
  const availableCount = averaged.filter((s) => s.sample_count > 0).length;
  const allSelected =
    availableCount > 0 &&
    availableCount === Object.values(selected).filter(Boolean).length;

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      await uploadResult(testId, file);
      await refresh({ autoSelect: true });
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

  const indices = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => Number(k));

  async function doIngest() {
    if (indices.length === 0) return;
    try {
      await ingestToPalette(testId, {
        swatch_indices: indices,
        mode,
        result_id:
          mode === "single_result" && sourceResultId !== null
            ? sourceResultId
            : undefined,
        replace_existing: replaceExisting,
      });
      setSelected({});
      setReplaceExisting(false);
      alert("Ingested.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    void onUpload(e);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-5 p-4">
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
            <div className="rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
              {error}
            </div>
          )}
    
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
    
          <Section
            title="Averaged swatches"
            dense
            actions={
              availableCount > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={allSelected ? clearSelection : selectAll}
                >
                  {allSelected ? "Clear selection" : `Select all (${availableCount})`}
                </Button>
              ) : undefined
            }
          >
            {averaged.length === 0 ? (
              <p className="text-[12.5px] text-[color:var(--color-ink-subtle)]">
                No swatches yet — upload a result.
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-1.5">
                {averaged.map((s, i) => {
                  const unavailable = s.sample_count === 0;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        !unavailable &&
                        setSelected((p) => ({ ...p, [i]: !p[i] }))
                      }
                      disabled={unavailable}
                      className={cn(
                        "flex flex-col gap-1 p-1 rounded-[6px] text-left",
                        "border transition-colors",
                        selected[i]
                          ? "border-[color:var(--color-primary)] ring-2 ring-[color:var(--color-primary-tint)]"
                          : unavailable
                            ? "border-dashed border-[color:var(--color-border-strong)]"
                            : "border-[color:var(--color-border)] hover:border-[color:var(--color-ink-subtle)]",
                        unavailable ? "opacity-40 cursor-default" : "cursor-pointer",
                      )}
                    >
                      <div
                        className="h-8 rounded-[3px] border border-[color:var(--color-border)]"
                        style={{ background: s.hex }}
                      />
                      <div className="font-mono text-[9px] text-[color:var(--color-ink)] leading-none">
                        {s.hex}
                      </div>
                      <div
                        className={cn(
                          "font-mono text-[9px] tabular-nums leading-none",
                          s.sigma >= SIGMA_WARN
                            ? "text-[color:var(--color-warning)]"
                            : "text-[color:var(--color-ink-subtle)]",
                        )}
                      >
                        n={s.sample_count} σ={s.sigma.toFixed(1)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
    
          <Card variant="elevated" className="flex flex-col gap-3">
            <div className="text-[13px] font-medium text-[color:var(--color-ink)]">
              Ingest {indices.length} swatch{indices.length === 1 ? "" : "es"} to palette
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-[color:var(--color-ink-muted)]">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "averaged"}
                  onChange={() => setMode("averaged")}
                />
                averaged
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "single_result"}
                  onChange={() => setMode("single_result")}
                />
                from specific result
              </label>
              {mode === "single_result" && (
                <Select
                  value={sourceResultId ?? ""}
                  onChange={(e) => setSourceResultId(Number(e.target.value))}
                  className="w-[120px]"
                >
                  <option value="">— pick —</option>
                  {results
                    .filter((r) => !r.excluded)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        #{r.id}
                      </option>
                    ))}
                </Select>
              )}
            </div>
            <label className="flex items-center gap-1.5 text-[12px] text-[color:var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
              />
              replace existing palette entries for this test
            </label>
            <div className="flex items-center justify-between gap-3">
              <DemoLock label="Saving to palette is disabled in the demo.">
                <Button
                  variant="primary"
                  onClick={doIngest}
                  disabled={indices.length === 0}
                >
                  Ingest to palette
                </Button>
              </DemoLock>
              {indices.length > 0 && (
                <Badge variant="info" size="sm">
                  {indices.length} selected
                </Badge>
              )}
            </div>
          </Card>
    
          <ResultDetailDialog
            open={detailId !== null}
            onOpenChange={(o) => !o && setDetailId(null)}
            result={detailResult}
          />
        </div>
      </div>
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
