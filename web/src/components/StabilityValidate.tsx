import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  validateBatch,
  type ValidateBatchEntry,
  type ValidateBatchResponse,
  type ValidateBatchSkipped,
} from "../api/palette";
import { labToHex, type Lab } from "../color/math";
import type { ValidationCell } from "../types";
import { cn } from "../ui";
import type { SeriesInput } from "./stabilityChartMath";

/* StabilityValidate — sixth canvas of the stability page. Asks the
 * backend to bucket each validation cell into stable / drifted /
 * skipped by *cross-run stability* (max ΔE between any single run's
 * per-cell mean and the across-run consensus). Save creates a fresh
 * palette entry from the burn-mean for every accepted cell. Linked
 * source entries stay untouched — the new entry sits alongside.
 *
 * The ΔE-vs-original is shown as informational only and never gates
 * the bucketing; the original entry might itself be wrong from a bad
 * first-ingest photo. Math lives in
 * src/xcs_gen_web/services/validate.py.
 */

type Bucket = "stable" | "drifted" | "skipped";

interface RowEntry {
  bucket: "stable" | "drifted";
  data: ValidateBatchEntry;
}

interface RowSkipped {
  bucket: "skipped";
  data: ValidateBatchSkipped;
}

type Row = RowEntry | RowSkipped;

const TOLERANCE_MIN = 2;
const TOLERANCE_MAX = 20;
const TOLERANCE_DEFAULT = 8;

interface Props {
  cells: ValidationCell[];
  series: SeriesInput[];
  testId: number | null;
  onSaved?: () => void;
}

export function StabilityValidate({ cells, series, testId, onSaved }: Props) {
  const [tolerance, setTolerance] = useState<number>(TOLERANCE_DEFAULT);
  const [preview, setPreview] = useState<ValidateBatchResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Per-cell user overrides applied on top of the preview's bucket
  // assignment. ``true`` accepts, ``false`` skips; absent => default
  // bucket from the API. Overrides survive tolerance changes only when
  // the cell still appears in the new preview.
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());

  // Save state — split from preview state so a slow save doesn't
  // wedge subsequent tolerance changes, and so the success banner can
  // linger after the loading spinner has cleared.
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const resultIds = useMemo(() => series.map((s) => s.resultId), [series]);
  const resultIdsKey = resultIds.join(",");

  // Quick cell_index → ValidationCell lookup so the row renderer can
  // pull the original expected hex for the EXPECTED swatch column
  // without re-iterating the cells array.
  const cellByIndex = useMemo(() => {
    const m = new Map<number, ValidationCell>();
    for (const c of cells) m.set(c.cell_index, c);
    return m;
  }, [cells]);

  // Re-fetch the dry-run preview whenever testId / tolerance / the
  // selected result-id set changes. AbortController prevents an
  // earlier slow request from clobbering a later one.
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
      const res = await validateBatch(testId, {
        tolerance_de: tolerance,
        result_ids: resultIds.length > 0 ? resultIds : undefined,
        dry_run: true,
      });
      if (ctrl.signal.aborted) return;
      setPreview(res);
      // Drop overrides for cells that no longer appear so the
      // override map doesn't grow unbounded across tolerance sweeps.
      setOverrides((prev) => {
        const visible = new Set<number>();
        res.stable.forEach((e) => visible.add(e.cell_index));
        res.drifted.forEach((e) => visible.add(e.cell_index));
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
  }, [testId, tolerance, resultIds]);

  useEffect(() => {
    void refresh();
    // resultIdsKey is the array-equality marker for refresh's resultIds
    // dep — we re-fetch whenever the selected result set actually
    // changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, tolerance, resultIdsKey]);

  // Compose ordered rows: stable (sorted by cell_index), then
  // drifted (worst stability_de first so the user reviews the
  // wobbliest cells first), then skipped. Tone follows the bucket
  // so the table reads like a triage list.
  const rows = useMemo<Row[]>(() => {
    if (preview == null) return [];
    const stable: RowEntry[] = preview.stable.map((e) => ({
      bucket: "stable",
      data: e,
    }));
    stable.sort((a, b) => a.data.cell_index - b.data.cell_index);
    const drifted: RowEntry[] = preview.drifted.map((e) => ({
      bucket: "drifted",
      data: e,
    }));
    drifted.sort((a, b) => b.data.stability_de - a.data.stability_de);
    const skipped: RowSkipped[] = preview.skipped.map((s) => ({
      bucket: "skipped",
      data: s,
    }));
    skipped.sort((a, b) => a.data.cell_index - b.data.cell_index);
    return [...stable, ...drifted, ...skipped];
  }, [preview]);

  // Accept-state per cell, after applying user overrides on top of the
  // bucket default. Skipped cells are never accepted (the backend
  // refuses to persist them — no measurements or fewer than two runs).
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
    let drifted = 0;
    let skipped = 0;
    for (const r of rows) {
      if (r.bucket === "skipped") skipped++;
      else if (acceptStateOf(r)) toAccept++;
      else drifted++;
    }
    return { toAccept, drifted, skipped };
  }, [rows, acceptStateOf]);

  // Build the override list to send on save: any cell whose effective
  // accept state diverges from the API's bucket default.
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
    for (const e of preview.drifted) {
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
      await validateBatch(testId, {
        tolerance_de: tolerance,
        result_ids: resultIds.length > 0 ? resultIds : undefined,
        overrides: buildSaveOverrides(),
        dry_run: false,
      });
      setSavedAt(Date.now());
      setOverrides(new Map());
      onSaved?.();
      // Re-fetch so the row tone reflects the now-persisted state on
      // the next batch (e.g. a second save after another result is
      // recorded).
      void refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    testId,
    preview,
    tolerance,
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
      <Empty message="Pick a validation test from the picker to validate its palette entries." />
    );
  }
  if (series.length === 0) {
    return (
      <Empty message="Pick at least one result to validate against." />
    );
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
      <ValidateCaption
        testName={preview.test_name}
        runCount={preview.result_count}
      />
      <ToleranceBar
        tolerance={tolerance}
        onToleranceChange={setTolerance}
        loading={loading}
        counts={counts}
      />
      <RowsTable
        rows={rows}
        acceptStateOf={acceptStateOf}
        toggleAccept={toggleAccept}
        cellByIndex={cellByIndex}
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
 * Explains what saving does and which test we're operating on. The
 * line about "burn-mean across N runs" mirrors what the backend
 * actually computes (robust mean per cell across the chosen result
 * set), so the user knows that picking different runs in the picker
 * directly changes the validated value.
 */
function ValidateCaption({
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
          Stable cells save by default; drifted cells need a manual
          call. Save creates a new palette entry from the consensus —
          the original entry, if any, is left untouched. ΔE-vs-original
          is shown for context but never gates the bucket.
        </span>
      </p>
    </div>
  );
}

/* ─── Tolerance + counts ───────────────────────────────────────────── */

function ToleranceBar({
  tolerance,
  onToleranceChange,
  loading,
  counts,
}: {
  tolerance: number;
  onToleranceChange: (v: number) => void;
  loading: boolean;
  counts: { toAccept: number; drifted: number; skipped: number };
}) {
  return (
    <div className="px-5 py-3 border-b border-[color:var(--color-border)] flex flex-wrap items-center gap-x-6 gap-y-2">
      <label className="flex items-center gap-3">
        <span className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          Stability ΔE
        </span>
        <input
          type="range"
          min={TOLERANCE_MIN}
          max={TOLERANCE_MAX}
          step={0.5}
          value={tolerance}
          onChange={(e) => onToleranceChange(Number(e.target.value))}
          className="w-40 accent-[color:var(--color-primary)]"
        />
        <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)] min-w-[3ch] text-right">
          {tolerance.toFixed(1)}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2 ml-auto">
        <CountPill tone="success" label="stable" value={counts.toAccept} />
        <CountPill tone="warning" label="drifted" value={counts.drifted} />
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
  cellByIndex,
}: {
  rows: Row[];
  acceptStateOf: (r: Row) => boolean;
  toggleAccept: (r: Row) => void;
  cellByIndex: Map<number, ValidationCell>;
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
        subtitle="Accept rows individually; drifted rows are off by default."
      />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full font-mono text-[10.5px] tabular-nums">
          <thead>
            <tr className="text-left text-[9px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
              <th className="px-2 py-1 w-[44px]">Cell</th>
              <th className="px-2 py-1">Expected</th>
              <th className="px-2 py-1">Burn-mean</th>
              <th className="px-2 py-1 text-right">Stability ΔE</th>
              <th className="px-2 py-1 text-right">vs expected</th>
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
                cellInfo={cellByIndex.get(row.data.cell_index) ?? null}
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
  cellInfo,
}: {
  row: Row;
  accepted: boolean;
  onToggle: () => void;
  cellInfo: ValidationCell | null;
}) {
  const cellIndex = row.data.cell_index;
  const expectedHex = cellInfo?.expected_hex ?? "—";

  if (row.bucket === "skipped") {
    return (
      <tr className="border-t border-[color:var(--color-border)]/60 opacity-70">
        <td className="px-2 py-1.5 text-[color:var(--color-ink-subtle)]">
          #{cellIndex}
        </td>
        <td className="px-2 py-1.5">
          {expectedHex === "—" ? (
            <span className="text-[color:var(--color-ink-subtle)]">—</span>
          ) : (
            <Swatch hex={expectedHex} label={expectedHex} />
          )}
        </td>
        <td className="px-2 py-1.5 text-[color:var(--color-ink-subtle)]" colSpan={4}>
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
  const isUnlinked = burn.palette_entry_id == null;
  return (
    <tr
      className={cn(
        "border-t border-[color:var(--color-border)]/60",
        !accepted && "opacity-60",
      )}
    >
      <td className="px-2 py-1.5 text-[color:var(--color-ink-subtle)]">
        <span title={isUnlinked ? "Cell has no palette entry — save creates a new one" : undefined}>
          #{cellIndex}
          {isUnlinked && (
            <span className="ml-1 text-[8px] tracking-[0.16em] uppercase text-[color:var(--color-primary)]">
              new
            </span>
          )}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <Swatch hex={expectedHex} label={expectedHex} />
      </td>
      <td className="px-2 py-1.5">
        <Swatch hex={burnHex} label={burnHex} />
      </td>
      <td className={cn("px-2 py-1.5 text-right font-semibold", stabilityTone)}>
        {burn.stability_de.toFixed(1)}
      </td>
      <td className="px-2 py-1.5 text-right text-[color:var(--color-ink-muted)]">
        {burn.de_vs_expected.toFixed(1)}
      </td>
      <td className="px-2 py-1.5 text-right text-[color:var(--color-ink-muted)]">
        {burn.run_count}
        {burn.n_inputs !== burn.run_count ? (
          <span className="text-[color:var(--color-ink-subtle)]">
            {" "}
            / {burn.n_inputs}
          </span>
        ) : null}
      </td>
      <td className="px-2 py-1.5 text-center">
        <AcceptToggle
          accepted={accepted}
          drifted={row.bucket === "drifted"}
          onToggle={onToggle}
        />
      </td>
    </tr>
  );
}

function AcceptToggle({
  accepted,
  drifted,
  onToggle,
}: {
  accepted: boolean;
  drifted: boolean;
  onToggle: () => void;
}) {
  // Bucket (stable / drifted) is already conveyed by the row's
  // colour-coded stability_de and dim tone, so the button itself just
  // shows the toggle action. The title attribute carries the longer
  // explanation for drifted rows so the affordance isn't lost.
  const title = drifted
    ? accepted
      ? "Accepted — will save despite drift"
      : "Drifted — click to accept anyway"
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
  counts: { toAccept: number; drifted: number; skipped: number };
  saving: boolean;
  savedAt: number | null;
  saveError: string | null;
  canSave: boolean;
  onSave: () => void;
}) {
  const ageS = savedAt == null ? null : Math.max(0, (Date.now() - savedAt) / 1000);
  const recent = ageS != null && ageS < 8;
  return (
    <div className="border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-5 py-3 flex flex-wrap items-center gap-3">
      <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
        will create: <span className="text-[color:var(--color-ink)]">{counts.toAccept}</span>{" "}
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
        {saving ? "Saving…" : "Save as new palette entries"}
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

function skipReasonLabel(
  reason: ValidateBatchSkipped["reason"],
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

// Re-export Bucket for any future parent that wants to render a count
// sidebar without re-deriving the union.
export type { Bucket };
