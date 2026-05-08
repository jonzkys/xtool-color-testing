import * as React from "react";
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
import { buildFamilies, type FamilyMember, type VaryingAxis } from "../components/exposure/recipeFamilies";
import { EmptyState, Button, MetalBar } from "../ui";

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
    test_id: p.test_id,
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
  total_exposure_index: "Total Exposure",
  ablation_aggression_index: "Ablation Aggression",
  delivery_smoothness_index: "Delivery Smoothness",
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
  const [xKey, setXKey] = useState<IndexRow>("total_exposure_index");
  const [mode, setMode] = useState<ScatterMode>("bivariate");
  const [yKeyUni, setYKeyUni] = useState<ChannelCol>("L");
  const [yKeyBi, setYKeyBi] = useState<IndexRow>("pulse_intensity_index");
  const [xScale, setXScale] = useState<ScaleKind>("log");
  const [yScale, setYScale] = useState<ScaleKind>("log");

  // ── filter state ───────────────────────────────────────────────────────
  const [sourceFilter, setSourceFilter] = useState<Set<"averaged" | "single_result" | "manual">>(
    new Set(["averaged", "manual"]),
  );
  const [validatedOnly, setValidatedOnly] = useState(false);
  const [brushRange, setBrushRange] = useState<readonly [number, number] | null>(null);

  interface FamilyFilter {
    axis: VaryingAxis;
    anchorRowId: number;
  }
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter | null>(null);

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

  // ── reset focus + brush + family filter when material changes ─────────
  useEffect(() => {
    setPinnedFocusId(null);
    setTransientFocusId(null);
    setBrushRange(null);
    setFamilyFilter(null);
  }, [materialId]);

  // ── bivariate same-index collapse guard ───────────────────────────────
  useEffect(() => {
    if (mode === "bivariate" && yKeyBi === xKey) {
      // Find the first INDEX_ROWS entry that isn't xKey.
      const next = INDEX_ROWS.find((k) => k !== xKey);
      if (next) setYKeyBi(next);
    }
  }, [mode, xKey, yKeyBi]);

  // ── correlation matrix (derived from rows) ────────────────────────────
  const correlationMatrix = useMemo(() => buildCorrelationMatrix(rows), [rows]);

  // ── recipe families (derived from rows) ───────────────────────────────
  const families = useMemo(() => buildFamilies(rows), [rows]);

  const focusedFamily = useMemo<FamilyMember[] | null>(() => {
    if (focusedId == null) return null;
    let best: FamilyMember[] | null = null;
    for (const members of families.values()) {
      if (members.some((m) => m.row.id === focusedId)) {
        if (
          !best ||
          members.length > best.length ||
          (members.length === best.length &&
            members[0].varyingAxis < best[0].varyingAxis)
        ) {
          best = members;
        }
      }
    }
    return best;
  }, [families, focusedId]);

  // ── all families the focused entry belongs to (for filter buttons) ────
  const focusedAvailableFamilies = useMemo<FamilyMember[][]>(() => {
    if (focusedId == null) return [];
    return Array.from(families.values()).filter((m) =>
      m.some((fm) => fm.row.id === focusedId),
    );
  }, [families, focusedId]);

  // ── member set for the active family filter ────────────────────────────
  const visibleIdsViaFilter = useMemo<Set<number> | null>(() => {
    if (!familyFilter) return null;
    for (const members of families.values()) {
      if (
        members.some((m) => m.row.id === familyFilter.anchorRowId) &&
        members[0].varyingAxis === familyFilter.axis
      ) {
        return new Set(members.map((m) => m.row.id));
      }
    }
    return null;
  }, [families, familyFilter]);

  // ── filtered rows for downstream panels ───────────────────────────────
  const displayRows = useMemo(
    () =>
      visibleIdsViaFilter
        ? rows.filter((r) => visibleIdsViaFilter.has(r.id))
        : rows,
    [rows, visibleIdsViaFilter],
  );

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

  const currentMaterialName = materials.find((m) => m.id === materialId)?.name;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[color:var(--color-bg)]">

      {/* ── TOP BAR ───────────────────────────────────────────────────── */}
      <header className="shrink-0 px-4 py-2 bg-[color:var(--color-surface)] flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="text-[14px] font-semibold text-[color:var(--color-ink)] whitespace-nowrap">
          How does the burn relate to laser dose?
        </h1>
        <div className="font-mono text-[10.5px] tabular-nums tracking-[0.06em] text-[color:var(--color-ink-muted)] flex items-baseline gap-2">
          {currentMaterialName && (
            <>
              <span>{currentMaterialName}</span>
              <span className="text-[color:var(--color-ink-subtle)]">·</span>
            </>
          )}
          <span>n = {rows.length}</span>
          <span className="text-[color:var(--color-ink-subtle)]">·</span>
          <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.18em]">v1</span>
        </div>
      </header>
      <MetalBar />

      {/* ── BODY ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── LEFT RAIL ───────────────────────────────────────────────── */}
        <aside className="w-56 shrink-0 flex flex-col gap-5 px-4 py-5 border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-y-auto">

          {/* Material picker */}
          <RailSection title="Material">
            <div className="flex flex-col gap-0.5">
              {materials.map((m) => (
                <RailPickerButton
                  key={m.id}
                  active={m.id === materialId}
                  onClick={() => setMaterialId(m.id)}
                >
                  {m.name}
                </RailPickerButton>
              ))}
            </div>
          </RailSection>

          {/* Source filters */}
          <RailSection title="Sources">
            <div className="flex flex-col gap-0.5">
              {(["averaged", "single_result", "manual"] as const).map((src) => (
                <RailCheckbox
                  key={src}
                  checked={sourceFilter.has(src)}
                  onChange={(checked) => {
                    setSourceFilter((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(src);
                      else next.delete(src);
                      return next;
                    });
                  }}
                >
                  {src}
                </RailCheckbox>
              ))}
              <RailCheckbox
                checked={validatedOnly}
                onChange={setValidatedOnly}
              >
                validated only
              </RailCheckbox>
            </div>
          </RailSection>

          {/* X-axis picker */}
          <RailSection title="X axis">
            <div className="flex flex-col gap-0.5">
              {INDEX_ROWS.map((k) => (
                <RailPickerButton
                  key={k}
                  active={k === xKey}
                  onClick={() => setXKey(k)}
                  small
                >
                  {INDEX_LABELS[k]}
                </RailPickerButton>
              ))}
            </div>
            <RailCheckbox
              checked={xScale === "log"}
              onChange={(checked) => setXScale(checked ? "log" : "linear")}
              className="mt-2"
            >
              log scale
            </RailCheckbox>
          </RailSection>

          {/* Y-axis picker */}
          <RailSection title="Y axis">
            <div className="flex flex-col gap-0.5">
              {mode === "univariate"
                ? CHANNEL_COLS.map((k) => (
                    <RailPickerButton
                      key={k}
                      active={k === yKeyUni}
                      onClick={() => setYKeyUni(k)}
                      small
                    >
                      {CHANNEL_LABELS[k]}
                    </RailPickerButton>
                  ))
                : INDEX_ROWS.map((k) => (
                    <RailPickerButton
                      key={k}
                      active={k === yKeyBi}
                      onClick={() => setYKeyBi(k)}
                      small
                    >
                      {INDEX_LABELS[k]}
                    </RailPickerButton>
                  ))}
            </div>
            <RailCheckbox
              checked={yScale === "log"}
              onChange={(checked) => setYScale(checked ? "log" : "linear")}
              className="mt-2"
            >
              log scale
            </RailCheckbox>
          </RailSection>
        </aside>

        {/* ── MAIN COLUMN ───────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[color:var(--color-bg)]">

          {/* Mode toggle */}
          <div className="flex items-center gap-2 px-5 pt-3 pb-2.5 border-b border-[color:var(--color-border)] shrink-0 bg-[color:var(--color-surface)]">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold mr-2">
              Mode
            </span>
            <div
              className="inline-flex border border-[color:var(--color-border)] rounded-[5px] overflow-hidden"
              role="tablist"
              aria-label="scatter mode"
            >
              {(["univariate", "bivariate"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={m === mode}
                  onClick={() => setMode(m)}
                  className={[
                    "px-3.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.18em] transition-colors",
                    m === mode
                      ? "bg-[color:var(--color-primary)] text-white"
                      : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-ink)]",
                  ].join(" ")}
                >
                  {m}
                </button>
              ))}
            </div>
            {mode === "bivariate" && (
              <span className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)] ml-2">
                index × index — colour coordinates only
              </span>
            )}
          </div>

          {/* Body: scatter + lower panels */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {rowsLoading ? (
              <div className="flex items-center justify-center h-64">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] animate-pulse">
                  Loading entries…
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
                title={materialId === null ? "Pick a material" : "No exposure data yet"}
                description={
                  materialId === null
                    ? "Choose a material from the rail to explore how its palette colours map to laser dose."
                    : "This material has no palette entries with computed exposure indices. Burn a few cells, save them, then return."
                }
              />
            ) : (
              <div className="flex flex-col gap-0">

                {/* Scatter — hero */}
                <div
                  className="px-5 pt-5 pb-3"
                  onClick={handleBackgroundClear}
                >
                  <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)] p-4">
                    <ExposureScatter
                      rows={displayRows}
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
                      family={focusedFamily ?? undefined}
                    />
                  </div>
                </div>

                {/* Hue ribbon + correlation matrix row */}
                <div className="flex gap-4 px-5 pb-3">
                  <div className="flex-1 min-w-0 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
                    <PanelLabel title="Hue ribbon" subtitle={`ordered by ${xKey}`} />
                    <ExposureHueRibbon
                      rows={displayRows}
                      orderBy={xKey}
                      focusedId={focusedId}
                      onHover={handleHover}
                      onLeave={handleLeave}
                      onClick={handleClick}
                      dimRange={brushRange}
                    />
                  </div>
                  <div className="shrink-0 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
                    <PanelLabel title="Correlations" subtitle="|r| heatmap" />
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
                <div className="px-5 pb-5">
                  <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
                    <PanelLabel title="Exposure range" subtitle="total_exposure_index, log scale" />
                    <ExposureRangeBrush
                      rows={displayRows}
                      range={brushRange}
                      onRangeChange={setBrushRange}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ── RIGHT RAIL ────────────────────────────────────────────────── */}
        <aside className="w-60 shrink-0 flex flex-col gap-4 px-4 py-5 border-l border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-y-auto">

          {/* Stats hero — Pearson r is the anchor */}
          <section>
            <RailHeading>Stats</RailHeading>
            <MetalBar variant="soft" className="mb-3" />

            {/* Hero r = */}
            <div className="flex flex-col gap-0.5 mb-3">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold">
                Pearson r
              </span>
              <span
                className="font-mono text-[28px] leading-none tabular-nums text-[color:var(--color-primary)] font-semibold"
                title="Linear correlation between X and Y, computed on log-X if log scale is on"
              >
                {fmtR(stats.pearsonR)}
              </span>
            </div>

            {/* Sub-stats — denser stack */}
            <div className="grid grid-cols-2 gap-y-2 gap-x-3 font-mono">
              <SubStat label="Spearman ρ" value={fmtR(stats.spearmanRho)} />
              <SubStat label="R² (log·lin)" value={fmtR2(stats.fit.r2)} />
              <SubStat
                label="Slope"
                value={Number.isFinite(stats.fit.slope) ? stats.fit.slope.toFixed(3) : "—"}
              />
              <SubStat label="n" value={String(stats.fit.n)} />
            </div>

            {mode === "bivariate" && (
              <p className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)] leading-relaxed mt-3">
                No Y outcome — bivariate r is between two indices, not a fit quality.
              </p>
            )}
          </section>

          {/* Focused entry card */}
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <RailHeading>
                {pinnedFocusId != null ? "Pinned" : "Focused"}
              </RailHeading>
              {focusedId != null && (
                <button
                  type="button"
                  onClick={handleBackgroundClear}
                  className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink-muted)] transition-colors"
                  title={pinnedFocusId != null ? "Unpin" : "Clear hover"}
                >
                  clear
                </button>
              )}
            </div>
            <MetalBar variant="soft" className="mb-3" />
            <ExposureFocusedCard
              rows={rows}
              focusedId={focusedId}
              highlightIndex={xKey}
              onDiscHover={handleHover}
              onDiscLeave={handleLeave}
              onDiscClick={handleClick}
              dimRange={brushRange}
              focusedFamily={focusedFamily}
              availableFamilies={focusedAvailableFamilies}
              activeFilterAxis={familyFilter?.axis ?? null}
              onSetFilter={(axis, anchorRowId) => setFamilyFilter({ axis, anchorRowId })}
              onClearFilter={() => setFamilyFilter(null)}
            />
          </section>

          {/* Clear brush shortcut */}
          {brushRange != null && (
            <section>
              <button
                onClick={() => setBrushRange(null)}
                className="w-full text-center px-2 py-1.5 rounded-[5px] border border-[color:var(--color-border)] font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-ink)] transition-colors"
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

/* ── Right-rail primitives ──────────────────────────────────────────────── */

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold mb-1.5">
      {children}
    </div>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span className="text-[13px] tabular-nums text-[color:var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

/* ── Left-rail primitives ───────────────────────────────────────────────── */

function RailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold mb-1.5">
        {title}
      </div>
      <MetalBar variant="soft" className="mb-2" />
      {children}
    </section>
  );
}

function RailPickerButton({
  active,
  onClick,
  children,
  small = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "text-left rounded-[4px] font-mono truncate transition-colors",
        small ? "px-2 py-1 text-[11px]" : "px-2 py-1.5 text-[11.5px]",
        active
          ? "bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)] font-semibold"
          : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-ink)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function RailCheckbox({
  checked,
  onChange,
  children,
  className = "",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 py-1 cursor-pointer select-none ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--color-primary)]"
      />
      <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
        {children}
      </span>
    </label>
  );
}

/* ── Main-column panel label ───────────────────────────────────────────── */

function PanelLabel({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold">
        {title}
      </span>
      {subtitle && (
        <span className="font-mono text-[10px] text-[color:var(--color-ink-subtle)] truncate">
          {subtitle}
        </span>
      )}
    </div>
  );
}
