import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ingestBatch,
  type IngestBatchEntry,
  type IngestBatchResponse,
  type IngestBatchSkipped,
} from "../api/palette";
import { labToHex, type Lab } from "../color/math";
import type { TestRecord } from "../types";
import { cn } from "../ui";
import type { SeriesInput } from "./stabilityChartMath";

/* StabilityIngest — sister to StabilityValidate, but for sweep tests.
 * Sweep tests have no authored expected colour, so bucketing
 * collapses to "stable across runs" (within the σ slider) vs
 * "unstable", with ``skipped`` reserved for cells with too few runs
 * or no measurements. Save creates a brand-new validated palette
 * entry per accepted cell, keyed on (test_id, cell_index) so re-runs
 * upsert rather than duplicate.
 *
 * Math lives in src/xcs_gen_web/services/ingest.py. See its module
 * docstring for the robust-mean algorithm — it's the same one
 * validate uses, kept in lockstep deliberately.
 */

interface RowEntry {
  bucket: "stable" | "unstable";
  data: IngestBatchEntry;
}

interface RowSkipped {
  bucket: "skipped";
  data: IngestBatchSkipped;
}

type Row = RowEntry | RowSkipped;

const SIGMA_MIN = 1;
const SIGMA_MAX = 10;
const SIGMA_DEFAULT = 3;

interface Props {
  test: TestRecord | null;
  series: SeriesInput[];
  onSaved?: () => void;
}

export function StabilityIngest({ test, series, onSaved }: Props) {
  const testId = test?.id ?? null;
  const [maxSigma, setMaxSigma] = useState<number>(SIGMA_DEFAULT);
  const [preview, setPreview] = useState<IngestBatchResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Per-cell user overrides on top of the preview's bucket assignment.
  // Same convention as validate — ``true`` accepts, ``false`` skips,
  // absent means "use the bucket default".
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());

  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const resultIds = useMemo(() => series.map((s) => s.resultId), [series]);
  const resultIdsKey = resultIds.join(",");

  const xParam = test?.spec.x_param ?? null;
  const yParam = test?.spec.y_param ?? null;

  const lastReqRef = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (testId == null) {
      setPreview(null);
      return;
    }
    lastReqRef.current?.abort();
    const ctrl = new AbortController();
    lastReqRef.current = ctrl;
    setLoading(true);
    setPreviewError(null);
    try {
      const res = await ingestBatch(testId, {
        max_sigma_de: maxSigma,
        result_ids: resultIds.length > 0 ? resultIds : undefined,
        dry_run: true,
      });
      if (ctrl.signal.aborted) return;
      setPreview(res);
      setOverrides((prev) => {
        const visible = new Set<number>();
        res.stable.forEach((e) => visible.add(e.cell_index));
        res.unstable.forEach((e) => visible.add(e.cell_index));
        res.skipped.forEach((e) => visible.add(e.cell_index));
        const next = new Map<number, boolean>();
        for (const [k, v] of prev) if (visible.has(k)) next.set(k, v);
        return next;
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setPreview(null);
      setPreviewError(
        e instanceof Error ? e.message : "Failed to load preview",
      );
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [testId, maxSigma, resultIds]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, maxSigma, resultIdsKey]);

  const rows = useMemo<Row[]>(() => {
    if (preview == null) return [];
    const stable: RowEntry[] = preview.stable.map((e) => ({
      bucket: "stable",
      data: e,
    }));
    stable.sort((a, b) => a.data.cell_index - b.data.cell_index);
    // Worst-σ unstable rows first so the user reviews the wobbliest
    // cells before deciding whether to override any.
    const unstable: RowEntry[] = preview.unstable.map((e) => ({
      bucket: "unstable",
      data: e,
    }));
    unstable.sort((a, b) => b.data.stability_de - a.data.stability_de);
    const skipped: RowSkipped[] = preview.skipped.map((s) => ({
      bucket: "skipped",
      data: s,
    }));
    skipped.sort((a, b) => a.data.cell_index - b.data.cell_index);
    return [...stable, ...unstable, ...skipped];
  }, [preview]);

  const acceptStateOf = useCallback(
    (row: Row): boolean => {
      if (row.bucket === "skipped") return false;
      const ov = overrides.get(row.data.cell_index);
      if (ov != null) return ov;
      return row.bucket === "stable";
    },
    [overrides],
  );

  const counts = useMemo(() => {
    let toAccept = 0;
    let unstable = 0;
    let skipped = 0;
    for (const r of rows) {
      if (r.bucket === "skipped") skipped++;
      else if (acceptStateOf(r)) toAccept++;
      else unstable++;
    }
    return { toAccept, unstable, skipped };
  }, [rows, acceptStateOf]);

  const buildSaveOverrides = useCallback((): {
    cell_index: number;
    accept: boolean;
  }[] => {
    if (preview == null) return [];
    const out: { cell_index: number; accept: boolean }[] = [];
    for (const e of preview.stable) {
      const accept = overrides.get(e.cell_index);
      if (accept === false) out.push({ cell_index: e.cell_index, accept: false });
    }
    for (const e of preview.unstable) {
      const accept = overrides.get(e.cell_index);
      if (accept === true) out.push({ cell_index: e.cell_index, accept: true });
    }
    return out;
  }, [preview, overrides]);

  const onSave = useCallback(async () => {
    if (testId == null || preview == null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await ingestBatch(testId, {
        max_sigma_de: maxSigma,
        result_ids: resultIds.length > 0 ? resultIds : undefined,
        overrides: buildSaveOverrides(),
        dry_run: false,
      });
      setSavedAt(Date.now());
      setOverrides(new Map());
      onSaved?.();
      void refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    testId,
    preview,
    maxSigma,
    resultIds,
    buildSaveOverrides,
    onSaved,
    refresh,
  ]);

  const toggleAccept = useCallback(
    (row: Row) => {
      if (row.bucket === "skipped") return;
      const cellIndex = row.data.cell_index;
      const current = acceptStateOf(row);
      const next = !current;
      setOverrides((prev) => {
        const m = new Map(prev);
        const defaultAccept = row.bucket === "stable";
        if (next === defaultAccept) m.delete(cellIndex);
        else m.set(cellIndex, next);
        return m;
      });
    },
    [acceptStateOf],
  );

  /* ─── Empty / error states ─────────────────────────────────────────── */
  if (testId == null) {
    return (
      <Empty message="Pick a sweep test from the picker to ingest its cells into the palette." />
    );
  }
  if (series.length === 0) {
    return <Empty message="Pick at least one result to compute consensus across." />;
  }
  if (previewError) {
    return <Empty tone="warning" message={previewError} />;
  }
  if (loading && preview == null) {
    return <Empty message="Measuring per-cell stability across runs…" />;
  }
  if (preview == null) {
    return <Empty message="No preview yet." />;
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
      <Caption testName={preview.test_name} runCount={preview.result_count} />
      <SigmaBar
        maxSigma={maxSigma}
        onMaxSigmaChange={setMaxSigma}
        loading={loading}
        counts={counts}
      />
      <RowsTable
        rows={rows}
        acceptStateOf={acceptStateOf}
        toggleAccept={toggleAccept}
        xParam={xParam}
        yParam={yParam}
      />
      <SaveBar
        counts={counts}
        saving={saving}
        savedAt={savedAt}
        saveError={saveError}
        canSave={!loading}
        onSave={onSave}
      />
    </div>
  );
}

/* ─── Caption ──────────────────────────────────────────────────────────
 *
 * Sweep tests don't carry an authored expected colour, so the
 * caption emphasises that we're trusting the consensus across the
 * picked runs as the truth. Stable cells save by default; unstable
 * cells need a manual call.
 */
function Caption({
  testName,
  runCount,
}: {
  testName: string;
  runCount: number;
}) {
  return (
    <div className="px-5 py-3 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      <p className="font-mono text-[11px] text-[color:var(--color-ink-muted)] leading-relaxed m-0">
        Bucket each cell of{" "}
        <span className="font-semibold text-[color:var(--color-ink)]">
          {testName}
        </span>{" "}
        ({runCount} run{runCount === 1 ? "" : "s"}) by{" "}
        <span className="font-semibold text-[color:var(--color-ink)]">
          stability across runs
        </span>{" "}
        — i.e. how tightly the per-run burn-mean clusters.{" "}
        <span className="text-[color:var(--color-ink-subtle)]">
          Stable cells save by default; unstable cells need a manual
          call. Save creates a new validated palette entry per cell —
          keyed on (test, cell), so re-running upserts rather than
          duplicates.
        </span>
      </p>
    </div>
  );
}

/* ─── σ threshold + counts ─────────────────────────────────────────── */

function SigmaBar({
  maxSigma,
  onMaxSigmaChange,
  loading,
  counts,
}: {
  maxSigma: number;
  onMaxSigmaChange: (v: number) => void;
  loading: boolean;
  counts: { toAccept: number; unstable: number; skipped: number };
}) {
  return (
    <div className="px-5 py-3 border-b border-[color:var(--color-border)] flex flex-wrap items-center gap-x-6 gap-y-2">
      <label className="flex items-center gap-3">
        <span className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          Max σ ΔE
        </span>
        <input
          type="range"
          min={SIGMA_MIN}
          max={SIGMA_MAX}
          step={0.5}
          value={maxSigma}
          onChange={(e) => onMaxSigmaChange(Number(e.target.value))}
          className="w-40 accent-[color:var(--color-primary)]"
        />
        <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)] min-w-[3ch] text-right">
          {maxSigma.toFixed(1)}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2 ml-auto">
        <CountPill tone="success" label="stable" value={counts.toAccept} />
        <CountPill tone="warning" label="unstable" value={counts.unstable} />
        <CountPill tone="muted" label="skipped" value={counts.skipped} />
        {loading && (
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
            updating…
          </span>
        )}
      </div>
    </div>
  );
}

function CountPill({
  tone,
  label,
  value,
}: {
  tone: "success" | "warning" | "muted";
  label: string;
  value: number;
}) {
  const cls =
    tone === "success"
      ? "bg-[color:var(--color-success)]/10 text-[color:var(--color-success)] border-[color:var(--color-success)]/30"
      : tone === "warning"
        ? "bg-[color:var(--color-warning,#b8860b)]/10 text-[color:var(--color-warning,#b8860b)] border-[color:var(--color-warning,#b8860b)]/30"
        : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-subtle)] border-[color:var(--color-border)]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[6px] border px-2 h-6",
        "font-mono text-[10px] font-semibold tracking-[0.14em] uppercase",
        cls,
      )}
    >
      <span className="tabular-nums">{value}</span>
      <span>{label}</span>
    </span>
  );
}

/* ─── Rows table ───────────────────────────────────────────────────── */

function RowsTable({
  rows,
  acceptStateOf,
  toggleAccept,
  xParam,
  yParam,
}: {
  rows: Row[];
  acceptStateOf: (r: Row) => boolean;
  toggleAccept: (r: Row) => void;
  xParam: string | null;
  yParam: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="p-5">
        <Empty message="No comparable cells in this test." />
      </div>
    );
  }
  return (
    <section className="p-5">
      <PanelHeading
        title="Per-cell preview"
        subtitle="Accept rows individually; unstable rows are off by default."
      />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full font-mono text-[10.5px] tabular-nums">
          <thead>
            <tr className="text-left text-[9px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
              <th className="px-2 py-1 w-[44px]">Cell</th>
              <th className="px-2 py-1">Burn-mean</th>
              <th className="px-2 py-1">Recipe</th>
              <th className="px-2 py-1 text-right">σ ΔE</th>
              <th className="px-2 py-1 text-right">N runs</th>
              <th className="px-2 py-1 text-center w-[120px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RowItem
                key={`${row.bucket}-${row.data.cell_index}`}
                row={row}
                accepted={acceptStateOf(row)}
                onToggle={() => toggleAccept(row)}
                xParam={xParam}
                yParam={yParam}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RowItem({
  row,
  accepted,
  onToggle,
  xParam,
  yParam,
}: {
  row: Row;
  accepted: boolean;
  onToggle: () => void;
  xParam: string | null;
  yParam: string | null;
}) {
  const cellIndex = row.data.cell_index;

  if (row.bucket === "skipped") {
    return (
      <tr className="border-t border-[color:var(--color-border)]/60 opacity-70">
        <td className="px-2 py-1.5 text-[color:var(--color-ink-subtle)]">
          #{cellIndex}
        </td>
        <td
          className="px-2 py-1.5 text-[color:var(--color-ink-subtle)]"
          colSpan={4}
        >
          {skipReasonLabel(row.data.reason, row.data.run_count ?? null)}
        </td>
        <td className="px-2 py-1.5 text-center">
          <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
            skipped
          </span>
        </td>
      </tr>
    );
  }

  const burn = row.data;
  const burnHex = labToHex(burn.burn_mean_lab as Lab);
  const stabilityTone =
    row.bucket === "stable"
      ? "text-[color:var(--color-success)]"
      : "text-[color:var(--color-warning,#b8860b)]";
  return (
    <tr
      className={cn(
        "border-t border-[color:var(--color-border)]/60",
        !accepted && "opacity-60",
      )}
    >
      <td className="px-2 py-1.5 text-[color:var(--color-ink-subtle)]">
        #{cellIndex}
      </td>
      <td className="px-2 py-1.5">
        <Swatch hex={burnHex} label={burnHex} />
      </td>
      <td className="px-2 py-1.5 text-[color:var(--color-ink-muted)]">
        {recipeLabel(burn, xParam, yParam)}
      </td>
      <td className={cn("px-2 py-1.5 text-right font-semibold", stabilityTone)}>
        {burn.stability_de.toFixed(1)}
      </td>
      <td className="px-2 py-1.5 text-right text-[color:var(--color-ink-muted)]">
        {burn.run_count}
        {burn.n_inputs !== burn.run_count ? (
          <span className="text-[color:var(--color-ink-subtle)]">
            {" "}/ {burn.n_inputs}
          </span>
        ) : null}
      </td>
      <td className="px-2 py-1.5 text-center">
        <AcceptToggle
          accepted={accepted}
          unstable={row.bucket === "unstable"}
          onToggle={onToggle}
        />
      </td>
    </tr>
  );
}

function AcceptToggle({
  accepted,
  unstable,
  onToggle,
}: {
  accepted: boolean;
  unstable: boolean;
  onToggle: () => void;
}) {
  const title = unstable
    ? accepted
      ? "Accepted — will save despite drift"
      : "Unstable — click to accept anyway"
    : accepted
      ? "Stable — will save by default"
      : "Skipped — won't save";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={accepted}
      title={title}
      className={cn(
        "h-6 px-2 min-w-[68px] rounded-[4px] inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
        "font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase",
        "border transition-colors focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        accepted
          ? "bg-[color:var(--color-success)]/15 text-[color:var(--color-success)] border-[color:var(--color-success)]/40 hover:bg-[color:var(--color-success)]/20"
          : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-subtle)] border-[color:var(--color-border)] hover:text-[color:var(--color-ink)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          accepted
            ? "bg-[color:var(--color-success)]"
            : "bg-[color:var(--color-ink-subtle)]",
        )}
      />
      {accepted ? "Accept" : "Skip"}
    </button>
  );
}

function Swatch({ hex, label }: { hex: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span
        aria-hidden
        className="inline-block h-4 w-7 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
        style={{ background: hex }}
      />
      <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)] uppercase">
        {hex}
      </span>
    </span>
  );
}

/* ─── Save bar ─────────────────────────────────────────────────────── */

function SaveBar({
  counts,
  saving,
  savedAt,
  saveError,
  canSave,
  onSave,
}: {
  counts: { toAccept: number; unstable: number; skipped: number };
  saving: boolean;
  savedAt: number | null;
  saveError: string | null;
  canSave: boolean;
  onSave: () => void;
}) {
  const ageS =
    savedAt == null ? null : Math.max(0, (Date.now() - savedAt) / 1000);
  const recent = ageS != null && ageS < 8;
  return (
    <div className="border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-5 py-3 flex flex-wrap items-center gap-3">
      <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
        will create:{" "}
        <span className="text-[color:var(--color-ink)]">{counts.toAccept}</span>{" "}
        new entr{counts.toAccept === 1 ? "y" : "ies"}
      </span>
      {saveError && (
        <span className="font-mono text-[10.5px] text-[color:var(--color-warning,#b8860b)]">
          {saveError}
        </span>
      )}
      {recent && !saving && !saveError && (
        <span className="font-mono text-[10.5px] text-[color:var(--color-success)]">
          Saved.
        </span>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave || saving || counts.toAccept === 0}
        className={cn(
          "ml-auto h-7 px-3 rounded-[6px] inline-flex items-center gap-2",
          "font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase",
          "border transition-colors focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
          "bg-[color:var(--color-primary)] text-white border-[color:var(--color-primary)]",
          "hover:bg-[color:var(--color-primary-strong,var(--color-primary))]",
          "disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        {saving ? "Saving…" : "Add to palette"}
      </button>
    </div>
  );
}

/* ─── Shared bits ──────────────────────────────────────────────────── */

function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
        {title}
      </div>
      <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)]">
        {subtitle}
      </div>
    </div>
  );
}

function Empty({ message, tone }: { message: string; tone?: "warning" }) {
  return (
    <div className="flex-1 min-h-0 rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] flex items-center justify-center px-6 py-10">
      <div
        className={cn(
          "font-mono text-[11px] tracking-[0.16em] uppercase text-center max-w-[60ch]",
          tone === "warning"
            ? "text-[color:var(--color-warning,#b8860b)]"
            : "text-[color:var(--color-ink-subtle)]",
        )}
      >
        {message}
      </div>
    </div>
  );
}

function recipeLabel(
  entry: IngestBatchEntry,
  xParam: string | null,
  yParam: string | null,
): string {
  // Compact "param value · param value" line for the per-cell row.
  // Uses the first run's swatch axes (the route projects these into
  // the saved palette entry's params dict so what the user sees in
  // this column is what gets persisted on save).
  const parts: string[] = [];
  if (xParam && entry.x_value != null) {
    parts.push(`${xParam} ${formatRecipeValue(entry.x_value)}`);
  }
  if (yParam && entry.y_value != null) {
    parts.push(`${yParam} ${formatRecipeValue(entry.y_value)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function formatRecipeValue(v: number): string {
  // Integer-ish values stay as integers; non-integer values get one
  // decimal so the column doesn't blow up to "586.5832134" widths.
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  return v.toFixed(1);
}

function skipReasonLabel(
  reason: IngestBatchSkipped["reason"],
  runCount: number | null,
): string {
  switch (reason) {
    case "insufficient_runs":
      return runCount != null
        ? `Only ${runCount} run${runCount === 1 ? "" : "s"} — need ≥ 2 to measure stability.`
        : "Not enough runs to measure stability.";
    case "no_measurements":
      return "No measurements found in the selected results.";
  }
}
