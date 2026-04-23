import { useEffect, useState } from "react";
import { Camera, Trash2, Upload } from "lucide-react";
import type { AveragedSwatch, ResultRecord } from "../types";
import {
  listResults,
  uploadResult,
  patchResult,
  deleteResult,
  getAveragedSwatches,
  ingestToPalette,
} from "../api/results";
import {
  Badge,
  Button,
  Card,
  cn,
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
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [averaged, setAveragedSwatches] = useState<AveragedSwatch[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<"averaged" | "single_result">("averaged");
  const [sourceResultId, setSourceResultId] = useState<number | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);

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

  return (
    <div className="flex flex-col gap-5 p-4">
      <label
        className={cn(
          "inline-flex items-center justify-center gap-2 w-full",
          "h-10 px-4 rounded-[6px] text-[13px] font-medium",
          "bg-[color:var(--color-primary)] text-white",
          "hover:bg-[color:var(--color-primary-hover)]",
          busy ? "opacity-50 cursor-wait" : "cursor-pointer",
        )}
      >
        {busy ? (
          <Upload className="h-4 w-4 animate-pulse" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
        {busy ? "Uploading…" : "Upload photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={onUpload}
          className="hidden"
        />
      </label>
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
                className={cn(
                  "flex items-center gap-3 rounded-[8px] border px-2.5 py-2 bg-[color:var(--color-surface)]",
                  r.excluded
                    ? "border-[color:var(--color-border)] opacity-50"
                    : "border-[color:var(--color-border)]",
                )}
              >
                <img
                  src={r.image_url}
                  alt=""
                  className="w-12 h-12 object-cover rounded-[6px] border border-[color:var(--color-border-strong)] shrink-0"
                />
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
                  </div>
                  <div className="text-[11px] text-[color:var(--color-ink-muted)]">
                    {new Date(r.uploaded_at).toLocaleString()}
                  </div>
                  <div className="text-[11px] text-[color:var(--color-ink-subtle)]">
                    {r.swatches.length} swatches · max σ{" "}
                    {Math.max(...r.swatches.map((s) => s.sigma), 0).toFixed(1)}
                  </div>
                </div>
                <label className="flex items-center gap-1 text-[11px] text-[color:var(--color-ink-muted)]">
                  <input
                    type="checkbox"
                    checked={r.excluded}
                    onChange={(e) => toggleExclude(r.id, e.target.checked)}
                  />
                  exclude
                </label>
                <button
                  type="button"
                  onClick={() => onDeleteResult(r.id)}
                  className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
                  title="Delete result"
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
          <Button
            variant="primary"
            onClick={doIngest}
            disabled={indices.length === 0}
          >
            Ingest to palette
          </Button>
          {indices.length > 0 && (
            <Badge variant="info" size="sm">
              {indices.length} selected
            </Badge>
          )}
        </div>
      </Card>
    </div>
  );
}
