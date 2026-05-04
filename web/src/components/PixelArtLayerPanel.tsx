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

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Check,
  ChevronDown,
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
import type { BaseParams, LayerSpec, PaletteEntry } from "../types";
import type { LibraryState } from "../library";
import { deltaE2000, hexToLab, type Lab } from "../color/math";
import { MergeColorsDialog } from "./MergeColorsDialog";
import type { MergeGroup } from "../svg/mergeColors";

export interface PixelArtLayerRow {
  /** Centroid hex (lower-case, ``#rrggbb``). The layer key. */
  color: string;
  enabled: boolean;
  /** Member fraction within the post-quantise grid; 0..1. */
  areaPct: number;
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
  capExceeded: boolean;
  rectCount: number;
  /** Drop K so the cap is no longer exceeded (re-runs the pipeline). */
  onAutoFitToCap: () => void;
  /** Hard error — even at K=2 the rect count exceeds the cap. */
  hardCapExceeded?: boolean;
  /** Disabled when a download is in flight. */
  generating?: boolean;
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
  capExceeded,
  rectCount,
  onAutoFitToCap,
  hardCapExceeded,
  generating,
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
  const downloadsDisabled =
    capExceeded || hardCapExceeded || !hasRows || generating === true;

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={`Colours · ${enabledCount}/${rows.length}`}
        dense
        actions={
          hasRows && (
            <Badge size="sm" variant="neutral">
              {rectCount.toLocaleString()} rects
            </Badge>
          )
        }
      >
        {!hasRows && (
          <div className="rounded-[8px] border border-dashed border-[color:var(--color-border-strong)] px-3 py-6 text-center text-[12.5px] text-[color:var(--color-ink-subtle)] font-mono tracking-[0.04em]">
            no colours yet — upload an image
          </div>
        )}

        {(capExceeded || hardCapExceeded) && (
          <div
            className={cn(
              "rounded-[8px] border px-3 py-2.5 flex items-start gap-2.5 text-[12px]",
              hardCapExceeded
                ? "border-[color:var(--color-destructive)]/40 bg-[color:var(--color-destructive-tint)] text-[color:var(--color-destructive)]"
                : "border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning-tint)] text-[color:var(--color-warning)]",
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="font-semibold mb-0.5">
                {rectCount.toLocaleString()} rects — exceeds XCS cap (750).
              </div>
              <div className="opacity-80">
                {hardCapExceeded
                  ? "Even at K=2 the rect count is over the cap. Reduce the cell grid or change crop."
                  : "Reduce colours or grid."}
              </div>
            </div>
            {!hardCapExceeded && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onAutoFitToCap}
              >
                Auto-fit to cap
              </Button>
            )}
          </div>
        )}

        {hasRows && (
          <ul className="flex flex-col gap-1.5">
            {sorted.map((row) => (
              <LayerRow
                key={row.color}
                row={row}
                paletteEntries={paletteEntries}
                library={library}
                onToggle={onToggle}
                onChooseMatch={onChooseMatch}
              />
            ))}
          </ul>
        )}
      </Section>

      <div className="flex flex-col gap-2">
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
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={downloadsDisabled}
            onClick={onDownloadXcs}
          >
            <Download className="h-3.5 w-3.5" />
            <FileCode2 className="h-3.5 w-3.5" />
            .xcs
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
      </div>

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
 * One layer row — checkbox · swatch · hex/area · matched-entry sub
 * ──────────────────────────────────────────────────────────────────── */

interface LayerRowProps {
  row: PixelArtLayerRow;
  paletteEntries: PaletteEntry[];
  library: LibraryState;
  onToggle: (color: string, enabled: boolean) => void;
  onChooseMatch: (color: string, entry: PaletteEntry | null) => void;
}

function LayerRow({
  row,
  paletteEntries,
  library,
  onToggle,
  onChooseMatch,
}: LayerRowProps) {
  const matchName = row.matchedEntry
    ? paletteEntryLabel(row.matchedEntry, library)
    : null;

  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-[8px] border px-2.5 py-2",
        "border-[color:var(--color-border)] bg-[color:var(--color-surface)]",
        !row.enabled && "opacity-55",
      )}
    >
      <input
        type="checkbox"
        checked={row.enabled}
        onChange={(e) => onToggle(row.color, e.target.checked)}
        title={row.enabled ? "Disable (skip engrave)" : "Enable"}
        className="cursor-pointer shrink-0"
      />
      <div
        aria-hidden
        className={cn(
          "h-[18px] w-[18px] rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0",
          !row.enabled && "opacity-50",
        )}
        style={{ background: row.color }}
      />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11.5px] text-[color:var(--color-ink)] truncate">
            {row.color}
          </span>
          <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-subtle)]">
            · {(row.areaPct * 100).toFixed(0)}%
          </span>
        </div>
        <div className="text-[11px] text-[color:var(--color-ink-muted)] truncate">
          {!row.enabled ? (
            <span className="font-mono tracking-[0.06em] text-[10.5px] uppercase opacity-80">
              skip-engrave (background)
            </span>
          ) : matchName ? (
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3 text-[color:var(--color-success)]" />
              {matchName}
            </span>
          ) : (
            <span className="font-mono tracking-[0.04em] text-[10.5px] text-[color:var(--color-ink-subtle)]">
              → pick palette ▸
            </span>
          )}
        </div>
      </div>

      <MatchPopover
        row={row}
        paletteEntries={paletteEntries}
        library={library}
        onChooseMatch={onChooseMatch}
      />
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Match popover — Radix Popover with a list of top palette matches.
 * ──────────────────────────────────────────────────────────────────── */

function MatchPopover({
  row,
  paletteEntries,
  library,
  onChooseMatch,
}: {
  row: PixelArtLayerRow;
  paletteEntries: PaletteEntry[];
  library: LibraryState;
  onChooseMatch: (color: string, entry: PaletteEntry | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // Compute top-K nearest entries on demand, lazily, when the popover opens.
  // Keep them stable across renders so the keyed list doesn't shuffle when
  // ``paletteEntries`` props identity changes between renders.
  const cacheRef = useRef<{ key: string; ranked: { entry: PaletteEntry; dE: number }[] } | null>(
    null,
  );

  let ranked: { entry: PaletteEntry; dE: number }[] = [];
  if (open) {
    const cacheKey = `${row.color}|${paletteEntries.length}`;
    if (cacheRef.current?.key !== cacheKey) {
      const targetLab = /^#[0-9a-fA-F]{6}$/.test(row.color)
        ? hexToLab(row.color)
        : null;
      const list = paletteEntries
        .map((e) => {
          const eLab =
            e.lab.length >= 3
              ? ([e.lab[0], e.lab[1], e.lab[2]] as Lab)
              : hexToLab(e.hex);
          const dE = targetLab ? deltaE2000(targetLab, eLab) : 0;
          return { entry: e, dE };
        })
        .sort((a, b) => a.dE - b.dE)
        .slice(0, 8);
      cacheRef.current = { key: cacheKey, ranked: list };
    }
    ranked = cacheRef.current?.ranked ?? [];
  }

  // Reset cache when popover closes so a re-open recomputes.
  useEffect(() => {
    if (!open) cacheRef.current = null;
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Pick palette match"
          className={cn(
            "shrink-0 inline-flex items-center justify-center",
            "h-7 w-7 rounded-[6px]",
            "border border-[color:var(--color-border)]",
            "text-[color:var(--color-ink-muted)]",
            "hover:border-[color:var(--color-primary)]/50 hover:text-[color:var(--color-primary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40",
          )}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 w-[320px] rounded-[10px] overflow-hidden",
            "border border-[color:var(--color-border)] bg-[color:var(--color-surface)]",
            "shadow-[var(--shadow-popover)]",
          )}
        >
          <div className="px-3 py-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
            <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
              Palette match · {row.color}
            </span>
          </div>
          {paletteEntries.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-[color:var(--color-ink-subtle)]">
              No palette entries for the active material. Add some on the
              Palette tab and the matcher will fill in.
            </div>
          ) : (
            <ul className="max-h-[280px] overflow-y-auto p-1">
              {ranked.map(({ entry, dE }) => {
                const isSel = row.matchedEntry?.id === entry.id;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChooseMatch(row.color, entry);
                        setOpen(false);
                      }}
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
                      <span className="flex-1 min-w-0 truncate text-[12px] text-[color:var(--color-ink)]">
                        {paletteEntryLabel(entry, library)}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
                        ΔE {dE.toFixed(1)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {row.matchedEntry && (
                <li className="border-t border-[color:var(--color-border)] mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onChooseMatch(row.color, null);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full px-2 py-1.5 rounded-[6px] text-left",
                      "text-[11.5px] text-[color:var(--color-ink-muted)]",
                      "hover:bg-[color:var(--color-primary-tint)]/30",
                    )}
                  >
                    Clear match
                  </button>
                </li>
              )}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Compose a human-readable label for a palette entry (material +
 *  hex). Mirrors the patterns used elsewhere in the app. */
function paletteEntryLabel(entry: PaletteEntry, library: LibraryState): string {
  const mat = library.materials.find((m) => m.id === entry.material_id);
  const matName = mat?.name ?? `Material #${entry.material_id}`;
  return `${matName} · ${entry.hex}`;
}
