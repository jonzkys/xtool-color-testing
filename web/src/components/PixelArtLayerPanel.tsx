/**
 * PixelArtLayerPanel — right-side colour rows + actions for the Pixel
 * Art page. Each row corresponds to one quantised centroid; toggling a
 * row flips ``enabled`` (skip-engrave at download time only — the
 * preview keeps showing the dimmed colour).
 *
 * The merge dialog is reused from SVG Layers via a tiny ``LayerSpec``
 * adapter — under the hood the merge group payload only cares about
 * the ``color`` and ``shapeCountsByColor`` map, not the rest of the
 * spec, so the adapter is mostly a stub.
 */

import { useEffect, useState } from "react";
import {
  Check,
  Combine,
  Download,
  FileCode2,
  FileImage,
  Wand2,
} from "lucide-react";
import {
  Badge,
  Button,
  cn,
  Section,
} from "../ui";
import { defaultBaseParams } from "../defaults";
import type { BaseParams, LayerSpec, OutputFormat, PaletteEntry } from "../types";
import type { LibraryState } from "../library";
import { deltaE2000, hexToLab, type Lab } from "../color/math";
import { MergeColorsDialog } from "./MergeColorsDialog";
import type { MergeGroup } from "../svg/mergeColors";
import { FormatToggle } from "./FormatToggle";

export interface PixelArtLayerRow {
  /** Centroid hex (lower-case, ``#rrggbb``). The layer key. */
  color: string;
  enabled: boolean;
  /** Member fraction within the post-quantise grid; 0..1. */
  areaPct: number;
  /** Absolute count of grid cells assigned to this centroid — the
   *  quantitative analogue of svg-layers' "× shapes" stat. Lets the
   *  user gauge layer significance beyond the percentage. */
  cellCount: number;
  /** Whether the centroid is near-white (bright + neutral). The page
   *  hides these by default — same convention as svg-layers — since
   *  they almost always represent the photo background and engraving
   *  them wastes time. */
  isNearWhite: boolean;
  matchedEntry: PaletteEntry | null;
  baseParams: BaseParams;
  materialId: string | null;
}

export interface PixelArtLayerPanelProps {
  rows: PixelArtLayerRow[];
  paletteEntries: PaletteEntry[];
  library: LibraryState;
  onToggle: (color: string, enabled: boolean) => void;
  onChooseMatch: (color: string, entry: PaletteEntry | null) => void;
  /** Called with the result groups when the user confirms the merge
   *  dialog. The page is responsible for collapsing the rows. */
  onConfirmMerge: (groups: MergeGroup[]) => void;
  onRematchAll: () => void;
  onDownloadXcs: () => void;
  onDownloadSvg: () => void;
  /** Disabled when a download is in flight. */
  generating?: boolean;
  /** Selected output container for the project download. */
  outputFormat: OutputFormat;
  onOutputFormatChange: (format: OutputFormat) => void;
  /** Merge contiguous same-colour cells into one outline. */
  mergeEnabled: boolean;
  onMergeEnabledChange: (enabled: boolean) => void;
}

/** Adapt our centroid rows into the ``LayerSpec`` shape the merge
 *  dialog expects. The merge logic only cares about ``color`` and
 *  ``shapeCountsByColor``; the rest is stub data. */
function rowsToLayerSpecs(rows: PixelArtLayerRow[]): LayerSpec[] {
  return rows.map((r) => ({
    color: r.color,
    name: r.color,
    enabled: r.enabled,
    processing_type: "COLOR_FILL_ENGRAVE",
    scan_angle: 90,
    base_params: r.baseParams ?? defaultBaseParams(),
    angle_mode: "fixed",
    crosshatch: false,
    material_id: r.materialId,
    hatch_passes: [],
  }));
}

export function PixelArtLayerPanel({
  rows,
  paletteEntries,
  library,
  onToggle,
  onChooseMatch,
  onConfirmMerge,
  onRematchAll,
  onDownloadXcs,
  onDownloadSvg,
  generating,
  outputFormat,
  onOutputFormatChange,
  mergeEnabled,
  onMergeEnabledChange,
}: PixelArtLayerPanelProps) {
  const [mergeOpen, setMergeOpen] = useState(false);

  const sorted = [...rows].sort((a, b) => b.areaPct - a.areaPct);
  const enabledCount = rows.filter((r) => r.enabled).length;

  // shapeCountsByColor: scale areaPct to a count-like integer so the
  // merge dialog's "shapes" line reads right. ``areaPct * 1000`` keeps
  // things readable for a 4096-cell grid.
  const shapeCountsByColor: Record<string, number> = {};
  for (const r of rows) {
    shapeCountsByColor[r.color] = Math.max(1, Math.round(r.areaPct * 1000));
  }

  const hasRows = rows.length > 0;
  // Also block downloads when every colour is disabled: the request would carry
  // rects: [] and 422 at the backend after the click, instead of being prevented.
  const downloadsDisabled = !hasRows || enabledCount === 0 || generating === true;

  // Click-to-expand: at most one tile is open at a time. The expanded
  // panel shows the picker controls without crowding every tile with
  // its own popover trigger.
  const [expandedColor, setExpandedColor] = useState<string | null>(null);
  // Reset the expansion when the colour disappears from rows (a merge,
  // re-quantise, image swap …).
  useEffect(() => {
    if (expandedColor && !rows.some((r) => r.color === expandedColor)) {
      setExpandedColor(null);
    }
  }, [rows, expandedColor]);
  const expandedRow = expandedColor
    ? rows.find((r) => r.color === expandedColor) ?? null
    : null;

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Action row sits above the colour grid so the primary verbs
          (download, match, merge) stay anchored at the top of the
          right card while the tile grid grows downward and scrolls
          internally for long palettes. */}
      <div className="flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9.5px] tracking-[0.16em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
            Format
          </span>
          <FormatToggle
            value={outputFormat}
            onChange={onOutputFormatChange}
            disabled={generating === true}
            size="sm"
          />
        </div>
        <label
          className="flex items-center gap-2 text-[12px] text-[color:var(--color-ink-muted)] cursor-pointer select-none"
          title="On = each colour region exports as one merged outline. Off = one square per cell."
        >
          <input
            type="checkbox"
            checked={mergeEnabled}
            onChange={(e) => onMergeEnabledChange(e.target.checked)}
            className="accent-[color:var(--color-primary)]"
          />
          <span>Merge cells</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={downloadsDisabled}
            onClick={onDownloadXcs}
          >
            <Download className="h-3.5 w-3.5" />
            <FileCode2 className="h-3.5 w-3.5" />
            .{outputFormat}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={downloadsDisabled}
            onClick={onDownloadSvg}
          >
            <Download className="h-3.5 w-3.5" />
            <FileImage className="h-3.5 w-3.5" />
            .svg
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasRows}
            onClick={() => setMergeOpen(true)}
          >
            <Combine className="h-3.5 w-3.5" />
            Merge…
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasRows || paletteEntries.length === 0}
            onClick={onRematchAll}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Match all
          </Button>
        </div>
      </div>

      <Section
        title={`Colours · ${enabledCount}/${rows.length}`}
        dense
        actions={
          hasRows && (
            <Badge size="sm" variant="neutral">
              {enabledCount.toLocaleString()} paths
            </Badge>
          )
        }
        className="min-h-0 flex flex-col"
        bodyClassName="min-h-0"
      >
        {!hasRows && (
          <div className="rounded-[8px] border border-dashed border-[color:var(--color-border-strong)] px-3 py-6 text-center text-[12.5px] text-[color:var(--color-ink-subtle)] font-mono tracking-[0.04em]">
            no colours yet — upload an image
          </div>
        )}

        {hasRows && (
          <div className="flex flex-col gap-2 min-h-0">
            <ul
              className={cn(
                "grid grid-cols-3 gap-1.5",
                "overflow-y-auto pr-0.5",
                // Grid sizes to its tile content; long palettes
                // scroll inside this list while the action row + the
                // expanded picker stay in place above / below.
                "min-h-0",
              )}
            >
              {sorted.map((row) => (
                <ColorTile
                  key={row.color}
                  row={row}
                  isExpanded={row.color === expandedColor}
                  onToggle={onToggle}
                  onSelect={(c) =>
                    setExpandedColor((prev) => (prev === c ? null : c))
                  }
                />
              ))}
            </ul>
            {expandedRow && (
              <ExpandedLayerPanel
                row={expandedRow}
                paletteEntries={paletteEntries}
                library={library}
                onChooseMatch={(c, e) => {
                  onChooseMatch(c, e);
                }}
                onClose={() => setExpandedColor(null)}
              />
            )}
          </div>
        )}
      </Section>

      <MergeColorsDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        layers={rowsToLayerSpecs(rows)}
        shapeCountsByColor={shapeCountsByColor}
        onConfirm={(groups) => {
          setMergeOpen(false);
          onConfirmMerge(groups);
        }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * One compact tile per centroid colour.
 *
 * Top half  → detected colour
 * Bottom    → matched palette colour (or "no match" hint)
 * Footer    → hex codes + cell count
 * Top-right → enable checkbox
 * Top-left  → "validated" badge if the matched palette entry has a
 *             passing validation result; otherwise omitted to keep
 *             quiet tiles for routine matches
 *
 * Click anywhere on the tile to expand the dedicated picker panel
 * below the grid (only one tile is expanded at a time — keeps the
 * sidebar from running off-screen when there are 32 colours).
 * ──────────────────────────────────────────────────────────────────── */

interface ColorTileProps {
  row: PixelArtLayerRow;
  isExpanded: boolean;
  onToggle: (color: string, enabled: boolean) => void;
  onSelect: (color: string) => void;
}

function ColorTile({ row, isExpanded, onToggle, onSelect }: ColorTileProps) {
  const matched = row.matchedEntry;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.color)}
        className={cn(
          "group relative w-full overflow-hidden rounded-[6px] border text-left transition-colors",
          isExpanded
            ? "border-[color:var(--color-primary)] ring-1 ring-[color:var(--color-primary)]/40"
            : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]",
          !row.enabled && "opacity-55",
        )}
        aria-expanded={isExpanded}
        aria-label={`Layer ${row.color}${matched ? ` matched to ${matched.hex}` : " no match"}`}
      >
        <div
          aria-hidden
          className="h-7 w-full"
          style={{ background: row.color }}
        />
        <div
          aria-hidden
          className="h-7 w-full relative"
          style={{ background: matched?.hex ?? "var(--color-surface-elevated)" }}
        >
          {!matched && (
            <span className="absolute inset-0 flex items-center justify-center font-mono text-[8.5px] tracking-[0.15em] uppercase text-[color:var(--color-ink-subtle)]">
              no match
            </span>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-1 px-1.5 py-1 bg-[color:var(--color-surface)] border-t border-[color:var(--color-border)]">
          <span className="font-mono text-[9.5px] text-[color:var(--color-ink)] truncate">
            {row.color}
          </span>
          <span
            className={cn(
              "font-mono text-[9.5px] truncate",
              matched
                ? "text-[color:var(--color-ink-muted)]"
                : "text-[color:var(--color-ink-subtle)]/40",
            )}
          >
            {matched?.hex ?? "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 px-1.5 pb-1 bg-[color:var(--color-surface)]">
          <span
            className="font-mono text-[8.5px] tracking-[0.1em] tabular-nums text-[color:var(--color-ink-subtle)]"
            title={`${row.cellCount.toLocaleString()} cell${row.cellCount === 1 ? "" : "s"} (${(row.areaPct * 100).toFixed(1)}%)`}
          >
            {row.cellCount.toLocaleString()} · {(row.areaPct * 100).toFixed(0)}%
          </span>
          {row.isNearWhite && (
            <span
              title="Near-white — disabled by default to skip the background. Tick to engrave anyway."
              className="font-mono text-[8px] tracking-[0.16em] uppercase px-1 rounded-[2px] border border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)]"
            >
              white
            </span>
          )}
        </div>
        <input
          type="checkbox"
          checked={row.enabled}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggle(row.color, e.target.checked)}
          title={row.enabled ? "Disable layer (skip engrave)" : "Enable layer"}
          className="absolute top-1 right-1 cursor-pointer drop-shadow-[0_0_2px_rgba(0,0,0,0.45)]"
        />
      </button>
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * ExpandedLayerPanel — full-width picker for the currently-selected
 * tile. Lists the K nearest palette matches by ΔE2000, with a Clear
 * action when something is already picked.
 * ──────────────────────────────────────────────────────────────────── */

interface ExpandedLayerPanelProps {
  row: PixelArtLayerRow;
  paletteEntries: PaletteEntry[];
  library: LibraryState;
  onChooseMatch: (color: string, entry: PaletteEntry | null) => void;
  onClose: () => void;
}

function ExpandedLayerPanel({
  row,
  paletteEntries,
  library,
  onChooseMatch,
  onClose,
}: ExpandedLayerPanelProps) {
  // Recompute the top-K matches whenever the row colour or the
  // palette identity changes. Cheap; the page rarely has more than a
  // few hundred entries.
  const ranked: { entry: PaletteEntry; dE: number }[] = [];
  const targetLab = /^#[0-9a-fA-F]{6}$/.test(row.color)
    ? hexToLab(row.color)
    : null;
  for (const e of paletteEntries) {
    const eLab =
      e.lab.length >= 3
        ? ([e.lab[0], e.lab[1], e.lab[2]] as Lab)
        : hexToLab(e.hex);
    ranked.push({
      entry: e,
      dE: targetLab ? deltaE2000(targetLab, eLab) : 0,
    });
  }
  ranked.sort((a, b) => a.dE - b.dE);
  const topRanked = ranked.slice(0, 8);

  return (
    <div className="rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] flex flex-col min-h-0">
      <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
        <div className="flex items-center gap-2 min-w-0">
          <div
            aria-hidden
            className="h-4 w-4 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
            style={{ background: row.color }}
          />
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)] truncate">
            Match · {row.color}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[9.5px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)]"
          aria-label="Close picker"
        >
          ✕
        </button>
      </div>
      {paletteEntries.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-[color:var(--color-ink-subtle)]">
          No palette entries for the active material. Add some on the
          Palette tab and the matcher will fill in.
        </div>
      ) : (
        <ul className="overflow-y-auto p-1 flex-1 min-h-0" style={{ maxHeight: 200 }}>
          {topRanked.map(({ entry, dE }) => {
            const isSel = row.matchedEntry?.id === entry.id;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onChooseMatch(row.color, entry)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-[6px] text-left",
                    "hover:bg-[color:var(--color-primary-tint)]/40",
                    isSel && "bg-[color:var(--color-primary-tint)]/60",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-4 w-4 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
                    style={{ background: entry.hex }}
                  />
                  <span className="flex-1 min-w-0 truncate text-[11.5px] text-[color:var(--color-ink)]">
                    {paletteEntryLabel(entry, library)}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
                    ΔE {dE.toFixed(1)}
                  </span>
                  {isSel && (
                    <Check className="h-3 w-3 text-[color:var(--color-success)] shrink-0" />
                  )}
                </button>
              </li>
            );
          })}
          {row.matchedEntry && (
            <li className="border-t border-[color:var(--color-border)] mt-1 pt-1">
              <button
                type="button"
                onClick={() => onChooseMatch(row.color, null)}
                className={cn(
                  "w-full px-2 py-1.5 rounded-[6px] text-left",
                  "text-[11px] text-[color:var(--color-ink-muted)]",
                  "hover:bg-[color:var(--color-primary-tint)]/30",
                )}
              >
                Clear match
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Compose a human-readable label for a palette entry (material +
 *  hex). Mirrors the patterns used elsewhere in the app. */
function paletteEntryLabel(entry: PaletteEntry, library: LibraryState): string {
  const mat = library.materials.find((m) => m.id === entry.material_id);
  const matName = mat?.name ?? `Material #${entry.material_id}`;
  return `${matName} · ${entry.hex}`;
}
