import { useMemo, useState } from "react";
import { Check, Eye, RotateCw, X as XIcon } from "lucide-react";
import { Button, MetalBar, cn } from "../ui";
import { seedFarthestPointSample } from "../svg/colorSelection";
import type { PaletteEntry } from "../types";

/**
 * MaterialPalettePicker — "specimen tray for the validation burn"
 *
 * Two-up panel rendered inside the test-edit form's `palette` tab when
 * `kind === 'validation'`. Left column: an a*-b* scatter mini-map
 * (the same Lab-plane projection the result-detail modal uses), where
 * every palette entry is a small filled dot and the picked subset
 * gets a primary-colour ring. Right column: a swatch grid that mirrors
 * `displayedSwatches` from `ResultDetailDialog` — one tile per entry,
 * primary-ring + ✓ when selected, dimmed when not.
 *
 * Selection is seeded by farthest-point sampling in 3D Lab space (the
 * `seedFarthestPointSample` function below) but is freely editable
 * from there: clicking any tile or scatter dot toggles it on/off, and
 * the counter at the top shows the live `selected: N / M`. There is
 * no fixed cap — the seed `N` is just a starting point, the burn uses
 * whatever's selected at xcs-generation time.
 *
 * Hovering a tile or dot cross-highlights its twin in the other view
 * via a transient `hoveredId` so the user can navigate visually
 * between "where does this colour sit on the gamut" and "what
 * exactly is its hex".
 *
 * The result-modal augmentations (`ValidationSummaryStrip`,
 * `PairedSwatchTile`) live in this file too — they share the same
 * design register and the file stays small enough that one home is
 * cleaner than two.
 */

// ─── Picker ─────────────────────────────────────────────────────────────────

const AB_RANGE = 60;

export interface MaterialPalettePickerProps {
  /** All palette entries for the active material (already filtered by
   *  the parent — this component does not call the API). */
  entries: PaletteEntry[];
  /** Currently-selected palette ids. Lives in the parent so save/
   *  restore round-trips correctly. */
  selectedIds: Set<number>;
  /** Toggle / replace handlers. The parent owns the selection. */
  onSelectionChange: (next: Set<number>) => void;
  /** Seed `n` for the auto-pick button. Persisted on the test row.
   *  Defaults to `12` upstream. */
  seedN: number;
  onSeedNChange: (n: number) => void;
  /** Material name surfaced in the header — e.g. "SS Tag · red laser". */
  materialLabel?: string;
  /** Optional extra slot below the header — used to host the `cells_per_row`
   *  validation-only field next to the seed N input. Keeps form-shape
   *  decisions out of this component. */
  rightSlot?: React.ReactNode;
}

export function MaterialPalettePicker({
  entries,
  selectedIds,
  onSelectionChange,
  seedN,
  onSeedNChange,
  materialLabel,
  rightSlot,
}: MaterialPalettePickerProps) {
  // L*-sorted view used by the grid (= burn order at xcs time).
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => (a.lab?.[0] ?? 0) - (b.lab?.[0] ?? 0)),
    [entries],
  );
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  // "Show only selected" filter — scoped to the grid; the scatter
  // keeps the full gamut so the user retains spatial context for what
  // they've picked vs. what's still available.
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  const selectedCount = entries.filter((e) => selectedIds.has(e.id)).length;
  const totalCount = entries.length;
  const visibleGridEntries = useMemo(
    () =>
      showSelectedOnly
        ? sortedEntries.filter((e) => selectedIds.has(e.id))
        : sortedEntries,
    [showSelectedOnly, sortedEntries, selectedIds],
  );

  const toggle = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const autoPick = () => {
    onSelectionChange(seedFarthestPointSample(entries, seedN));
  };

  const clear = () => onSelectionChange(new Set());

  return (
    // ``min-h-[480px] max-h-[calc(100vh-240px)]`` lets the picker take
    // most of the viewport without depending on the parent being a
    // height-locked flex container. Grid + scatter lay out inside; the
    // grid scrolls internally when it overflows so the header stays
    // pinned.
    <div className="bg-[color:var(--color-surface)] flex flex-col min-h-[480px] max-h-[calc(100vh-240px)]">
      <PickerHeader
        materialLabel={materialLabel}
        selectedCount={selectedCount}
        totalCount={totalCount}
        seedN={seedN}
        onSeedNChange={onSeedNChange}
        onAutoPick={autoPick}
        onClear={clear}
        autoPickDisabled={entries.length === 0}
        clearDisabled={selectedCount === 0}
        showSelectedOnly={showSelectedOnly}
        onToggleSelectedOnly={() => setShowSelectedOnly((v) => !v)}
        toggleDisabled={selectedCount === 0 && !showSelectedOnly}
        rightSlot={rightSlot}
      />

      <MetalBar variant="soft" />

      {entries.length === 0 ? (
        <EmptyPaletteHint />
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-px bg-[color:var(--color-border)]">
          {/* Left: a-b scatter — fixed-aspect, doesn't scroll. */}
          <div className="bg-[color:var(--color-surface)] px-4 py-3 flex flex-col gap-2 min-h-0">
            <PanelLabel title="a*/b* gamut" />
            <LabScatterPicker
              entries={entries}
              selectedIds={selectedIds}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onToggle={toggle}
            />
            {/* Inline legend — same mono register as InspectMatchDialog's
                ReadoutCells; pads the column so the scatter stays
                top-aligned but the gamut info is still nearby. */}
            <div className="mt-1 flex items-baseline justify-between font-mono text-[9.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
              <span>L* range</span>
              <span className="tabular-nums text-[color:var(--color-ink-muted)]">
                {labRange(entries)}
              </span>
            </div>
          </div>

          {/* Right: swatch grid — scrolls internally to fill column. */}
          <div className="bg-[color:var(--color-surface)] px-4 py-3 flex flex-col gap-2 min-w-0 min-h-0">
            <PanelLabel
              title={
                showSelectedOnly
                  ? "Palette · selected only"
                  : "Palette · sorted by L*"
              }
              hint={
                showSelectedOnly
                  ? `${selectedCount} of ${totalCount}`
                  : selectedCount > 0
                    ? `${selectedCount} picked`
                    : `click any tile`
              }
            />
            <div
              className={cn(
                "flex-1 min-h-0 overflow-y-auto pr-1 -mr-1",
                // Tight scrollbar styling so the column doesn't gain a
                // fat track when there are many rows.
                "[&::-webkit-scrollbar]:w-[6px]",
                "[&::-webkit-scrollbar-thumb]:bg-[color:var(--color-border-strong)]",
                "[&::-webkit-scrollbar-thumb]:rounded-full",
                "[&::-webkit-scrollbar-track]:bg-transparent",
              )}
            >
              <div
                className={cn(
                  "grid gap-1.5",
                  "[grid-template-columns:repeat(auto-fill,minmax(56px,1fr))]",
                )}
              >
                {visibleGridEntries.map((e) => (
                  <SwatchPickerTile
                    key={e.id}
                    entry={e}
                    selected={selectedIds.has(e.id)}
                    hovered={hoveredId === e.id}
                    onHover={setHoveredId}
                    onToggle={toggle}
                  />
                ))}
              </div>
              {showSelectedOnly && visibleGridEntries.length === 0 && (
                <div className="py-6 text-center font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
                  No entries selected yet — auto-pick or click a tile
                  on the gamut scatter.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Format the L* range across the palette as a tight "min – max" pair
 *  for the gamut sidebar. Returns "—" when no entries are valid. */
function labRange(entries: PaletteEntry[]): string {
  const ls = entries
    .map((e) => e.lab?.[0])
    .filter((v): v is number => typeof v === "number");
  if (ls.length === 0) return "—";
  return `${Math.min(...ls).toFixed(0)}–${Math.max(...ls).toFixed(0)}`;
}

function PickerHeader({
  materialLabel,
  selectedCount,
  totalCount,
  seedN,
  onSeedNChange,
  onAutoPick,
  onClear,
  autoPickDisabled,
  clearDisabled,
  showSelectedOnly,
  onToggleSelectedOnly,
  toggleDisabled,
  rightSlot,
}: {
  materialLabel?: string;
  selectedCount: number;
  totalCount: number;
  seedN: number;
  onSeedNChange: (n: number) => void;
  onAutoPick: () => void;
  onClear: () => void;
  autoPickDisabled: boolean;
  clearDisabled: boolean;
  showSelectedOnly: boolean;
  onToggleSelectedOnly: () => void;
  toggleDisabled: boolean;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="px-4 pt-3 pb-3">
      {/* Title row — matches InspectMatchDialog's header rhythm */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="font-mono text-[10px] tracking-[0.24em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
            Validation · palette
          </span>
          {materialLabel && (
            <span className="font-mono text-[11px] tabular-nums tracking-tight text-[color:var(--color-ink-muted)] truncate">
              {materialLabel}
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] shrink-0">
          selected&nbsp;·&nbsp;
          <span className="text-[color:var(--color-primary)] font-semibold tabular-nums">
            {selectedCount}
          </span>
          <span className="text-[color:var(--color-ink-subtle)]">
            &nbsp;/&nbsp;{totalCount}
          </span>
        </span>
      </div>

      {/* Controls row */}
      <div className="mt-3 flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-2">
          <NumericInline
            label="N"
            value={seedN}
            min={1}
            max={Math.max(totalCount, 1)}
            onChange={onSeedNChange}
            help="seed for auto-pick"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={onAutoPick}
            disabled={autoPickDisabled}
            title="Replace selection with N farthest-point picks across the palette"
            className="gap-1.5"
          >
            <RotateCw className="h-3 w-3" strokeWidth={2.2} />
            <span className="font-mono tracking-[0.12em] uppercase text-[11px]">
              Auto-pick
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={clearDisabled}
            className="gap-1.5"
          >
            <XIcon className="h-3 w-3" strokeWidth={2.2} />
            <span className="font-mono tracking-[0.12em] uppercase text-[11px]">
              Clear
            </span>
          </Button>
          <Button
            variant={showSelectedOnly ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleSelectedOnly}
            disabled={toggleDisabled}
            aria-pressed={showSelectedOnly}
            title={
              showSelectedOnly
                ? "Show all palette entries"
                : "Show only the entries you've picked"
            }
            className="gap-1.5"
          >
            <Eye className="h-3 w-3" strokeWidth={2.2} />
            <span className="font-mono tracking-[0.12em] uppercase text-[11px]">
              {showSelectedOnly ? "Showing picked" : "Picked only"}
            </span>
          </Button>
        </div>
        {rightSlot && <div className="flex items-end">{rightSlot}</div>}
      </div>
    </div>
  );
}

function NumericInline({
  label,
  value,
  min,
  max,
  onChange,
  help,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  help?: string;
}) {
  return (
    <label
      className={cn(
        "flex flex-col gap-1",
        "rounded-[5px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]",
        "px-2 py-1.5",
        "focus-within:border-[color:var(--color-primary)]",
      )}
      title={help}
    >
      <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] leading-none">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className={cn(
          "font-mono tabular-nums text-[13px] text-[color:var(--color-ink)]",
          "bg-transparent outline-none w-12 leading-none",
          "[&::-webkit-inner-spin-button]:appearance-none",
          "[&::-webkit-outer-spin-button]:appearance-none",
          "[appearance:textfield]",
        )}
      />
    </label>
  );
}

function PanelLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
        {title}
      </span>
      {hint && (
        <span className="font-mono text-[9.5px] tracking-[0.06em] text-[color:var(--color-ink-muted)] tabular-nums">
          {hint}
        </span>
      )}
    </div>
  );
}

function EmptyPaletteHint() {
  return (
    <div className="px-6 py-10 flex flex-col items-center text-center gap-2">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
        Palette empty
      </span>
      <p className="text-[12px] text-[color:var(--color-ink-muted)] max-w-xs leading-snug">
        This material has no ingested swatches yet. Run a sweep test
        first, ingest the result, then come back here to validate.
      </p>
    </div>
  );
}

// ─── Swatch tile — picker variant ──────────────────────────────────────────

function SwatchPickerTile({
  entry,
  selected,
  hovered,
  onHover,
  onToggle,
}: {
  entry: PaletteEntry;
  selected: boolean;
  hovered: boolean;
  onHover: (id: number | null) => void;
  onToggle: (id: number) => void;
}) {
  const lStar = entry.lab?.[0]?.toFixed(0) ?? "—";
  return (
    <button
      type="button"
      onClick={() => onToggle(entry.id)}
      onMouseEnter={() => onHover(entry.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(entry.id)}
      onBlur={() => onHover(null)}
      title={`${entry.hex} · L* ${lStar}${entry.notes ? " · " + entry.notes : ""}`}
      aria-pressed={selected}
      aria-label={`Toggle ${entry.hex}`}
      className={cn(
        "group relative text-left rounded-[4px] overflow-hidden",
        "border bg-[color:var(--color-surface)]",
        "transition-[opacity,box-shadow,border-color] duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        selected
          ? "border-[color:var(--color-primary)] ring-2 ring-[color:var(--color-primary)]/30 opacity-100"
          : "border-[color:var(--color-border)] opacity-55 hover:opacity-100 hover:border-[color:var(--color-border-strong)]",
        hovered && !selected && "opacity-100 border-[color:var(--color-border-strong)]",
        hovered && selected && "ring-[color:var(--color-primary)]/60",
      )}
    >
      <div
        className="aspect-square w-full relative"
        style={{ background: entry.hex }}
      >
        {selected && (
          <span
            aria-hidden
            className={cn(
              "absolute top-1 right-1 h-3.5 w-3.5",
              "rounded-full bg-[color:var(--color-primary)] text-white",
              "inline-flex items-center justify-center",
              "shadow-[0_0_0_1.5px_var(--color-surface)]",
            )}
          >
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
        )}
        {/* Tiny L* pip — bottom-left, mix-blend so it stays legible */}
        <span
          aria-hidden
          className="absolute bottom-0.5 left-1 font-mono text-[8.5px] tabular-nums leading-none"
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          L{lStar}
        </span>
      </div>
      <div className="px-1.5 py-1 flex items-center justify-between border-t border-[color:var(--color-border)] gap-1">
        <span className="font-mono text-[9.5px] text-[color:var(--color-ink)] truncate uppercase">
          {entry.hex}
        </span>
        {entry.favorited && (
          <span
            aria-hidden
            title="favorited"
            className="font-mono text-[9px] text-[color:var(--color-primary)]"
          >
            ★
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Lab scatter — picker variant ──────────────────────────────────────────

function LabScatterPicker({
  entries,
  selectedIds,
  hoveredId,
  onHover,
  onToggle,
}: {
  entries: PaletteEntry[];
  selectedIds: Set<number>;
  hoveredId: number | null;
  onHover: (id: number | null) => void;
  onToggle: (id: number) => void;
}) {
  const valid = entries.filter((e) => e.lab && e.lab.length >= 3);
  return (
    <div
      className="mt-2 relative rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] overflow-hidden"
      style={{ aspectRatio: "1 / 1" }}
    >
      <svg
        viewBox={`${-AB_RANGE} ${-AB_RANGE} ${AB_RANGE * 2} ${AB_RANGE * 2}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full"
        aria-label={`Lab a*/b* picker · ${valid.length} swatches`}
      >
        {/* Neutral-axis crosshairs */}
        <line
          x1={-AB_RANGE} y1={0} x2={AB_RANGE} y2={0}
          stroke="var(--color-border-strong)"
          strokeWidth={0.4}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0} y1={-AB_RANGE} x2={0} y2={AB_RANGE}
          stroke="var(--color-border-strong)"
          strokeWidth={0.4}
          vectorEffect="non-scaling-stroke"
        />
        {/* ΔE ~ 30 reference circle, like the result-modal scatter */}
        <circle
          cx={0} cy={0} r={30}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={0.3}
          vectorEffect="non-scaling-stroke"
        />
        {/* Render unselected first (under), then selected, so rings sit on top. */}
        {valid.filter((e) => !selectedIds.has(e.id)).map((e) =>
          renderDot(e, false, hoveredId === e.id, onHover, onToggle))}
        {valid.filter((e) => selectedIds.has(e.id)).map((e) =>
          renderDot(e, true, hoveredId === e.id, onHover, onToggle))}
      </svg>
      {/* Axis labels — ditto to ResultDetailDialog.LabScatter */}
      <ScatterLabel pos="tl" text="+b* yellow" />
      <ScatterLabel pos="bl" text="-b* blue" />
      <ScatterLabel pos="br" text="+a* red" />
      <ScatterLabel pos="tr" text="-a* green" align="end" />
    </div>
  );
}

function renderDot(
  e: PaletteEntry,
  selected: boolean,
  hovered: boolean,
  onHover: (id: number | null) => void,
  onToggle: (id: number) => void,
) {
  const a = clamp(e.lab[1], -AB_RANGE, AB_RANGE);
  const b = clamp(e.lab[2], -AB_RANGE, AB_RANGE);
  return (
    <g
      key={e.id}
      transform={`translate(${a}, ${-b})`}
      onMouseEnter={() => onHover(e.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onToggle(e.id)}
      style={{ cursor: "pointer" }}
    >
      <title>{`${e.hex} · L* ${e.lab[0].toFixed(0)} a* ${e.lab[1].toFixed(1)} b* ${e.lab[2].toFixed(1)}`}</title>
      {/* Hover halo — picks up the cross-highlight from the grid */}
      {hovered && (
        <circle
          r={5}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth={0.6}
          opacity={0.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle
        r={selected ? 2.8 : 2.2}
        fill={e.hex}
        stroke={selected ? "var(--color-primary)" : "rgba(0,0,0,0.25)"}
        strokeWidth={selected ? 1.2 : 0.5}
        opacity={selected ? 1 : 0.55}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function ScatterLabel({
  pos,
  text,
  align,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  text: string;
  align?: "start" | "end";
}) {
  const p = {
    tl: "top-1.5 left-2",
    tr: "top-1.5 right-2",
    bl: "bottom-1.5 left-2",
    br: "bottom-1.5 right-2",
  }[pos];
  return (
    <div
      className={cn(
        "absolute font-mono text-[8.5px] tracking-[0.14em] uppercase",
        "text-[color:var(--color-ink-subtle)] pointer-events-none",
        align === "end" && "text-right",
        p,
      )}
    >
      {text}
    </div>
  );
}

// ─── Result-modal augmentations ────────────────────────────────────────────

export interface ValidationSummaryStripProps {
  /** ΔE76 values, one per cell, expected/measured paired upstream. */
  deltas: number[];
  /** Current threshold (mm-of-ΔE). Default 3.0. */
  threshold: number;
  onThresholdChange: (n: number) => void;
}

/** Summary strip rendered above the swatch grid for `kind=validation`
 *  results. Mirrors `ReadoutCell` rhythm but with three figures + a
 *  threshold slider. The threshold update is a UI-only knob — it
 *  retints the over-threshold ring on each tile but doesn't recompute
 *  the deltas. */
export function ValidationSummaryStrip({
  deltas,
  threshold,
  onThresholdChange,
}: ValidationSummaryStripProps) {
  const median = useMemo(() => medianOf(deltas), [deltas]);
  const max = useMemo(() => (deltas.length ? Math.max(...deltas) : 0), [deltas]);
  const overCount = useMemo(
    () => deltas.filter((d) => d > threshold).length,
    [deltas, threshold],
  );
  const overFraction = deltas.length
    ? overCount / deltas.length
    : 0;
  const status: "ok" | "warn" | "fail" =
    overFraction === 0 ? "ok" : overFraction < 0.25 ? "warn" : "fail";

  return (
    <div
      className={cn(
        "rounded-[5px] border border-[color:var(--color-border)] overflow-hidden",
        "bg-[color:var(--color-surface-elevated)]",
      )}
    >
      <div className="grid grid-cols-3 divide-x divide-[color:var(--color-border)]">
        <SummaryCell label="Median ΔE" value={fmtDelta(median)} />
        <SummaryCell label="Max ΔE" value={fmtDelta(max)} accent={max > threshold ? "warn" : undefined} />
        <SummaryCell
          label={`Over ${threshold.toFixed(1)}`}
          value={`${overCount} / ${deltas.length}`}
          accent={status === "ok" ? undefined : status}
        />
      </div>
      <div className="border-t border-[color:var(--color-border)] px-3 py-2 flex items-center gap-3">
        <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] shrink-0">
          Threshold
        </span>
        <input
          type="range"
          min={0.5}
          max={10}
          step={0.1}
          value={threshold}
          onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
          className="flex-1 accent-[color:var(--color-primary)]"
          aria-label="ΔE threshold for over-threshold count"
        />
        <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)] w-10 text-right">
          {threshold.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "warn" | "fail";
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-[14px] tabular-nums",
          accent === "warn" && "text-[color:var(--color-warning)]",
          accent === "fail" && "text-[color:var(--color-destructive)]",
          !accent && "text-[color:var(--color-ink)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export interface PairedSwatchTileProps {
  measuredHex: string;
  /** Hex form derived from `expected_lab_*` upstream (we don't store
   *  it twice — see the spec). */
  expectedHex: string;
  /** ΔE76 measured vs expected. Caption + ring colour both use this. */
  delta: number;
  /** UI-only threshold from `ValidationSummaryStrip`. */
  threshold: number;
  onClick?: () => void;
  /** Optional sigma for the per-cell tooltip. */
  sigma?: number;
}

/** Result-modal tile for a validation cell. Top half = measured, bottom
 *  half = expected, with a hairline divider so colour mismatches read
 *  instantly. Caption strip carries the ΔE; ring goes warning when the
 *  cell crosses the threshold, destructive at 2× threshold. */
export function PairedSwatchTile({
  measuredHex,
  expectedHex,
  delta,
  threshold,
  onClick,
  sigma,
}: PairedSwatchTileProps) {
  const ringClass = ringForDelta(delta, threshold);
  return (
    <button
      type="button"
      onClick={onClick}
      title={[
        `measured ${measuredHex}`,
        `expected ${expectedHex}`,
        `ΔE76 ${delta.toFixed(2)}`,
        sigma != null ? `σ ${sigma.toFixed(2)}` : null,
        "click to inspect",
      ].filter(Boolean).join(" · ")}
      className={cn(
        "group relative text-left rounded-[4px] overflow-hidden",
        "border bg-[color:var(--color-surface)]",
        "cursor-pointer transition-[border-color,box-shadow] duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        ringClass,
      )}
    >
      <div className="aspect-square w-full grid grid-rows-2">
        <div style={{ background: measuredHex }} />
        <div
          style={{ background: expectedHex }}
          className="border-t border-[color:var(--color-substrate)]/40"
        />
        {/* meas / exp tags surface only on hover or focus — at 100-cell
            density they otherwise smother the colour pair they label.
            The two-tone chip + ring colour already communicates which
            half is measured vs. expected; the labels are a hover-time
            confirmation rather than always-on chrome. */}
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 left-1 font-mono text-[8px] tabular-nums",
            "uppercase tracking-[0.16em] leading-none",
            "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            "transition-opacity duration-100",
          )}
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          meas
        </span>
        <span
          aria-hidden
          className={cn(
            "absolute bottom-0.5 left-1 font-mono text-[8px] tabular-nums",
            "uppercase tracking-[0.16em] leading-none",
            "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            "transition-opacity duration-100",
          )}
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          exp
        </span>
      </div>
      {/* Compact bottom strip — single tabular ΔE in the threshold-aware
          colour. The pass/warn/fail status is already encoded in the
          ring around the chip; bringing it back as text on every tile
          double-stamped the same signal and crowded the strip. The
          number alone reads well at 44 px. */}
      <div className="px-1.5 py-1 flex items-center justify-center border-t border-[color:var(--color-border)]">
        <span
          className={cn(
            "font-mono text-[9.5px] tabular-nums truncate",
            delta > threshold * 2
              ? "text-[color:var(--color-destructive)]"
              : delta > threshold
                ? "text-[color:var(--color-warning)]"
                : "text-[color:var(--color-ink-muted)]",
          )}
        >
          {delta.toFixed(1)}
        </span>
      </div>
    </button>
  );
}

function ringForDelta(delta: number, threshold: number): string {
  if (delta > threshold * 2) {
    return "border-[color:var(--color-destructive)]/70 ring-1 ring-[color:var(--color-destructive)]/20 hover:ring-[color:var(--color-destructive)]/40";
  }
  if (delta > threshold) {
    return "border-[color:var(--color-warning)]/70 ring-1 ring-[color:var(--color-warning)]/20 hover:ring-[color:var(--color-warning)]/40";
  }
  return "border-[color:var(--color-border)] hover:border-[color:var(--color-primary)]/60 hover:ring-2 hover:ring-[color:var(--color-primary)]/25";
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function medianOf(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmtDelta(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(2);
}
