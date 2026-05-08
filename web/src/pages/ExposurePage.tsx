import { useEffect, useMemo, useState, useCallback } from "react";
import { listMaterials } from "../api/library";
import { listPaletteEntries } from "../api/palette";
import type { Material } from "../library";
import type { PaletteEntry } from "../types";
import {
  ExposureScatter,
  type ScaleKind,
  type ScatterMode,
} from "../components/exposure/ExposureScatter";
import { ExposureHueRibbon } from "../components/exposure/ExposureHueRibbon";
import { ExposureCorrelationMatrix } from "../components/exposure/ExposureCorrelationMatrix";
import { ExposureRangeBrush } from "../components/exposure/ExposureRangeBrush";
import { ExposureFocusedCard } from "../components/exposure/ExposureFocusedCard";
import {
  buildCorrelationMatrix,
  CHANNEL_COLS,
  INDEX_ROWS,
  type ChannelCol,
  type ExposureRow,
  type IndexRow,
} from "../components/exposure/exposureCorrelations";
import { pearson, spearman, logLinearRegression } from "../components/exposure/exposureMath";
import { EmptyState, Button } from "../ui";

// ── types ──────────────────────────────────────────────────────────────────

export interface ExposurePageProps {
  materialId: number | null;
}

// ── helpers ────────────────────────────────────────────────────────────────

function paletteToExposureRow(p: PaletteEntry): ExposureRow {
  return {
    id: p.id,
    hex: p.hex,
    lab: [p.lab[0], p.lab[1], p.lab[2]],
    indices: p.indices!,
    params: p.params as Record<string, number | string>,
  };
}

function fmtR(r: number): string {
  if (!Number.isFinite(r)) return "—";
  return r.toFixed(3);
}

function fmtR2(r2: number): string {
  if (!Number.isFinite(r2)) return "—";
  return r2.toFixed(3);
}

const INDEX_LABELS: Record<IndexRow, string> = {
  pulse_spacing_mm: "Pulse Spacing (mm)",
  line_spacing_index: "Line Spacing Index",
  pulse_energy_index: "Pulse Energy Index",
  pulse_intensity_index: "Pulse Intensity Index",
  surface_exposure_index: "Surface Exposure Index",
};

const CHANNEL_LABELS: Record<ChannelCol, string> = {
  L: "L*",
  a: "a*",
  b: "b*",
  hue: "Hue°",
  chroma: "Chroma",
};

// ── component ──────────────────────────────────────────────────────────────

export function ExposurePage({ materialId: propMaterialId }: ExposurePageProps) {
  // ── material + data state ──────────────────────────────────────────────
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialId, setMaterialId] = useState<number | null>(propMaterialId);
  const [rows, setRows] = useState<ExposureRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);

  // ── axis / mode state ──────────────────────────────────────────────────
  const [xKey, setXKey] = useState<IndexRow>("surface_exposure_index");
  const [mode, setMode] = useState<ScatterMode>("univariate");
  const [yKeyUni, setYKeyUni] = useState<ChannelCol>("L");
  const [yKeyBi, setYKeyBi] = useState<IndexRow>("pulse_intensity_index");
  const [xScale, setXScale] = useState<ScaleKind>("log");
  const [yScale, setYScale] = useState<ScaleKind>("linear");

  // ── filter state ───────────────────────────────────────────────────────
  const [sourceFilter, setSourceFilter] = useState<Set<"averaged" | "single_result" | "manual">>(
    new Set(["averaged", "manual"]),
  );
  const [validatedOnly, setValidatedOnly] = useState(false);
  const [brushRange, setBrushRange] = useState<readonly [number, number] | null>(null);

  // ── focus state (mirrors StabilityPage transient/pinned pattern) ───────
  const [transientFocusId, setTransientFocusId] = useState<number | null>(null);
  const [pinnedFocusId, setPinnedFocusId] = useState<number | null>(null);

  const focusedId = transientFocusId ?? pinnedFocusId;

  const handleHover = useCallback((id: number) => {
    setTransientFocusId(id);
  }, []);

  const handleLeave = useCallback(() => {
    setTransientFocusId(null);
  }, []);

  const handleClick = useCallback((id: number) => {
    setTransientFocusId(null);
    setPinnedFocusId((prev) => (prev === id ? null : id));
  }, []);

  const handleBackgroundClear = useCallback(() => {
    setTransientFocusId(null);
    setPinnedFocusId(null);
  }, []);

  // ── derived ─────────────────────────────────────────────────────────────
  const yKey: ChannelCol | IndexRow = mode === "univariate" ? yKeyUni : yKeyBi;

  // ── fetch: materials on mount ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    listMaterials()
      .then((mats) => {
        if (cancelled) return;
        setMaterials(mats);
        // If no materialId prop, default to first material
        if (propMaterialId === null && mats.length > 0) {
          setMaterialId(mats[0].id);
        }
      })
      .catch(() => {
        // silently ignore — materials list failure is non-fatal
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep internal materialId in sync if prop changes
  useEffect(() => {
    if (propMaterialId !== null) {
      setMaterialId(propMaterialId);
    }
  }, [propMaterialId]);

  // ── fetch: palette entries on materialId / validatedOnly change ────────
  useEffect(() => {
    if (materialId === null) return;
    let cancelled = false;
    setRowsLoading(true);
    setRowsError(null);
    listPaletteEntries({ material_id: materialId, validated_only: validatedOnly })
      .then((entries) => {
        if (cancelled) return;
        // Post-fetch source filter
        const filtered = entries.filter(
          (e) => sourceFilter.has(e.source) && e.indices != null,
        );
        setRows(filtered.map(paletteToExposureRow));
        setRowsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setRowsError(err instanceof Error ? err.message : "Failed to load palette entries");
        setRowsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // sourceFilter is intentionally excluded — source filtering is applied
    // at fetch-projection time but does NOT re-trigger a network request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId, validatedOnly]);

  // ── correlation matrix (derived from rows) ────────────────────────────
  const correlationMatrix = useMemo(() => buildCorrelationMatrix(rows), [rows]);

  // ── per-axis stats for right-rail hero ────────────────────────────────
  const stats = useMemo(() => {
    const xs = rows.map((r) => (r.indices[xKey] as number | null) ?? NaN);
    let ys: number[];
    if (mode === "univariate") {
      const ch = yKeyUni;
      ys = rows.map((r) => {
        const [l, a, b] = r.lab;
        switch (ch) {
          case "L":      return l;
          case "a":      return a;
          case "b":      return b;
          case "hue":    return Math.atan2(b, a) * (180 / Math.PI);
          case "chroma": return Math.sqrt(a * a + b * b);
        }
      });
    } else {
      ys = rows.map((r) => (r.indices[yKeyBi] as number | null) ?? NaN);
    }
    return {
      pearsonR: pearson(xs, ys),
      spearmanRho: spearman(xs, ys),
      fit: logLinearRegression(xs, ys),
    };
  }, [rows, xKey, mode, yKeyUni, yKeyBi]);

  // ── (currentMaterial available for future use — not shown in top bar) ─

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0 bg-[color:var(--color-surface)]">

      {/* ── TOP BAR ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-[color:var(--color-border)] shrink-0">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-[color:var(--color-ink-subtle)]">
          Exposure Indices
        </span>
        <span className="text-[color:var(--color-ink-subtle)] opacity-40">·</span>
        <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
          N={rows.length}
        </span>
        <div className="flex-1" />
        {/* Version badge */}
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] opacity-60">
          v1
        </span>
      </div>

      {/* ── BODY ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── LEFT RAIL ───────────────────────────────────────────────── */}
        <aside className="w-52 shrink-0 flex flex-col gap-4 px-4 py-4 border-r border-[color:var(--color-border)] overflow-y-auto">

          {/* Material picker */}
          <section>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-2">
              Material
            </div>
            <div className="flex flex-col gap-1">
              {materials.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMaterialId(m.id)}
                  className={[
                    "text-left px-2 py-1.5 rounded text-xs font-mono truncate transition-colors",
                    m.id === materialId
                      ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]"
                      : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]",
                  ].join(" ")}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </section>

          {/* Source filters */}
          <section>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-2">
              Sources
            </div>
            {(["averaged", "single_result", "manual"] as const).map((src) => (
              <label key={src} className="flex items-center gap-2 py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sourceFilter.has(src)}
                  onChange={(e) => {
                    setSourceFilter((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(src);
                      else next.delete(src);
                      return next;
                    });
                  }}
                  className="accent-[color:var(--color-accent)]"
                />
                <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
                  {src}
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2 py-1 mt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={validatedOnly}
                onChange={(e) => setValidatedOnly(e.target.checked)}
                className="accent-[color:var(--color-accent)]"
              />
              <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
                validated only
              </span>
            </label>
          </section>

          {/* X-axis picker */}
          <section>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-2">
              X Axis
            </div>
            <div className="flex flex-col gap-0.5">
              {INDEX_ROWS.map((k) => (
                <button
                  key={k}
                  onClick={() => setXKey(k)}
                  className={[
                    "text-left px-2 py-1 rounded text-[11px] font-mono truncate transition-colors",
                    k === xKey
                      ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]"
                      : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]",
                  ].join(" ")}
                >
                  {INDEX_LABELS[k]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 py-1 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={xScale === "log"}
                onChange={(e) => setXScale(e.target.checked ? "log" : "linear")}
                className="accent-[color:var(--color-accent)]"
              />
              <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
                log scale
              </span>
            </label>
          </section>

          {/* Y-axis picker */}
          <section>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-2">
              Y Axis
            </div>
            {mode === "univariate" ? (
              <div className="flex flex-col gap-0.5">
                {CHANNEL_COLS.map((k) => (
                  <button
                    key={k}
                    onClick={() => setYKeyUni(k)}
                    className={[
                      "text-left px-2 py-1 rounded text-[11px] font-mono truncate transition-colors",
                      k === yKeyUni
                        ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]"
                        : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]",
                    ].join(" ")}
                  >
                    {CHANNEL_LABELS[k]}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {INDEX_ROWS.map((k) => (
                  <button
                    key={k}
                    onClick={() => setYKeyBi(k)}
                    className={[
                      "text-left px-2 py-1 rounded text-[11px] font-mono truncate transition-colors",
                      k === yKeyBi
                        ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]"
                        : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]",
                    ].join(" ")}
                  >
                    {INDEX_LABELS[k]}
                  </button>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 py-1 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={yScale === "log"}
                onChange={(e) => setYScale(e.target.checked ? "log" : "linear")}
                className="accent-[color:var(--color-accent)]"
              />
              <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
                log scale
              </span>
            </label>
          </section>
        </aside>

        {/* ── MAIN COLUMN ───────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Mode toggle */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-[color:var(--color-border)] shrink-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mr-1">
              Mode
            </span>
            {(["univariate", "bivariate"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={[
                  "px-3 py-1 rounded text-[11px] font-mono uppercase tracking-[0.14em] transition-colors",
                  m === mode
                    ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-fg)]"
                    : "text-[color:var(--color-ink-muted)] border border-[color:var(--color-border)] hover:bg-[color:var(--color-surface-elevated)]",
                ].join(" ")}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Body: scatter + lower panels */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {rowsLoading ? (
              <div className="flex items-center justify-center h-48">
                <span className="font-mono text-xs text-[color:var(--color-ink-subtle)] animate-pulse">
                  Loading…
                </span>
              </div>
            ) : rowsError ? (
              <EmptyState
                title="Failed to load entries"
                description={rowsError}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRowsError(null);
                      if (materialId !== null) {
                        setRowsLoading(true);
                        listPaletteEntries({ material_id: materialId, validated_only: validatedOnly })
                          .then((entries) => {
                            const filtered = entries.filter(
                              (e) => sourceFilter.has(e.source) && e.indices != null,
                            );
                            setRows(filtered.map(paletteToExposureRow));
                            setRowsLoading(false);
                          })
                          .catch((err) => {
                            setRowsError(err instanceof Error ? err.message : "Failed to load");
                            setRowsLoading(false);
                          });
                      }
                    }}
                  >
                    Retry
                  </Button>
                }
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title="No entries"
                description={
                  materialId === null
                    ? "Select a material to explore its exposure indices."
                    : "This material has no palette entries with computed exposure indices."
                }
              />
            ) : (
              <div className="flex flex-col gap-0">

                {/* Scatter */}
                <div
                  className="px-4 pt-4 pb-2"
                  onClick={handleBackgroundClear}
                >
                  <ExposureScatter
                    rows={rows}
                    mode={mode}
                    xKey={xKey}
                    yKey={yKey}
                    xScale={xScale}
                    yScale={yScale}
                    focusedId={focusedId}
                    onHover={handleHover}
                    onLeave={handleLeave}
                    onClick={handleClick}
                    dimRange={brushRange}
                  />
                </div>

                {/* Hue ribbon + correlation matrix row */}
                <div className="flex gap-4 px-4 pb-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-1.5">
                      Hue Ribbon
                    </div>
                    <ExposureHueRibbon
                      rows={rows}
                      orderBy={xKey}
                      focusedId={focusedId}
                      onHover={handleHover}
                      onLeave={handleLeave}
                      onClick={handleClick}
                    />
                  </div>
                  <div className="shrink-0">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-1.5">
                      Correlation Matrix
                    </div>
                    <ExposureCorrelationMatrix
                      matrix={correlationMatrix}
                      selectedIndex={xKey}
                      selectedChannel={mode === "univariate" ? yKeyUni : "L"}
                      onSelect={(idx, ch) => {
                        setXKey(idx);
                        if (mode === "univariate") setYKeyUni(ch);
                      }}
                    />
                  </div>
                </div>

                {/* Exposure range brush */}
                <div className="px-4 pb-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-1.5">
                    Exposure Range
                  </div>
                  <ExposureRangeBrush
                    rows={rows}
                    range={brushRange}
                    onRangeChange={setBrushRange}
                  />
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ── RIGHT RAIL ────────────────────────────────────────────────── */}
        <aside className="w-52 shrink-0 flex flex-col gap-4 px-4 py-4 border-l border-[color:var(--color-border)] overflow-y-auto">

          {/* Stats hero */}
          <section>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-3">
              Stats
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
                  Pearson r
                </span>
                <span className="font-mono text-lg tabular-nums text-[color:var(--color-ink)] font-semibold">
                  {fmtR(stats.pearsonR)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
                  Spearman ρ
                </span>
                <span className="font-mono text-lg tabular-nums text-[color:var(--color-ink)] font-semibold">
                  {fmtR(stats.spearmanRho)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
                  R² (log-linear)
                </span>
                <span className="font-mono text-lg tabular-nums text-[color:var(--color-ink)] font-semibold">
                  {fmtR2(stats.fit.r2)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
                  Slope
                </span>
                <span className="font-mono text-sm tabular-nums text-[color:var(--color-ink-muted)]">
                  {Number.isFinite(stats.fit.slope) ? stats.fit.slope.toFixed(3) : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
                  n
                </span>
                <span className="font-mono text-sm tabular-nums text-[color:var(--color-ink-muted)]">
                  {stats.fit.n}
                </span>
              </div>
            </div>
          </section>

          {/* Focused entry card */}
          <section>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] mb-3">
              {pinnedFocusId != null ? "Pinned" : "Focused"}
            </div>
            <ExposureFocusedCard
              rows={rows}
              focusedId={focusedId}
              highlightIndex={xKey}
              onDiscHover={handleHover}
              onDiscLeave={handleLeave}
              onDiscClick={handleClick}
            />
            {focusedId == null && (
              <p className="font-mono text-[11px] text-[color:var(--color-ink-subtle)] leading-relaxed mt-1">
                Hover or click a point to inspect.
              </p>
            )}
          </section>

          {/* Clear brush shortcut */}
          {brushRange != null && (
            <section>
              <button
                onClick={() => setBrushRange(null)}
                className="w-full text-left px-2 py-1.5 rounded border border-[color:var(--color-border)] font-mono text-[11px] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)] transition-colors"
              >
                Clear range filter
              </button>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
