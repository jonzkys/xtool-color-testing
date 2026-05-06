import { useEffect, useMemo, useState } from "react";
import { MaterialPalettePicker } from "./MaterialPalettePicker";
import { patchValidationCells } from "../api/validationCells";
import type { Material } from "../library";
import type { PaletteEntry, ValidationCell } from "../types";
import { cn, Select } from "../ui";

/**
 * ValidationPaletteTab — host for the MaterialPalettePicker inside the
 * test editor's `palette` tab (only rendered for `kind === "validation"`
 * tests). Owns the picker's `selectedIds` + `seedN` UI state and pushes
 * each change through to the backend via `patchValidationCells`, then
 * mirrors the new cell list into the parent so the rest of the editor
 * (and downstream `.xcs` generate) sees the updated burn ordering
 * without a refetch.
 *
 * Cross-material flow: the source palette (which material the picker
 * draws cells from) is independent of the test's burn material. Use it
 * to validate "would material A's tested colours hold up if I burned
 * them on material B?" without re-running every sweep. Picks made
 * against another material stay in the cell list when the user toggles
 * the source — they show up in a "Picks from {material}" group above
 * the picker so the user can see what's already locked in.
 *
 * Cells are L*-sorted on save (darkest first = `cell_index` 0). This
 * matches the burn ordering the xcs builder uses.
 */

export interface ValidationPaletteTabProps {
  testId: number | null;
  /** The test's *burn* material — what gets photographed. Used as the
   *  default source and labels the "same as test material" option in
   *  the source picker. */
  materialId: number | null;
  /** All materials in the user's library. Drives the source picker. */
  materials: Material[];
  validationCells: ValidationCell[];
  onValidationCellsChange: (next: ValidationCell[]) => void;
  /** Active source material's palette — what the picker grid renders. */
  palette: PaletteEntry[];
  /** Picked entries from materials *other* than the active source.
   *  Empty when every pick comes from the current source. */
  crossSourceEntries: PaletteEntry[];
  /** ``null`` = "use the test's own material"; otherwise a different
   *  material's id. Persisted on the test spec. */
  sourceMaterialId: number | null;
  onSourceMaterialChange: (next: number | null) => void;
}

export function ValidationPaletteTab({
  testId,
  materialId,
  materials,
  validationCells,
  onValidationCellsChange,
  palette,
  crossSourceEntries,
  sourceMaterialId,
  onSourceMaterialChange,
}: ValidationPaletteTabProps) {
  // Initial selection mirrors the persisted cells. Re-syncs when the
  // parent test record changes (e.g. switching tests in the same
  // session, or after a server-side refetch).
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () =>
      new Set(
        validationCells
          .map((c) => c.palette_entry_id)
          .filter((x): x is number => x != null),
      ),
  );
  const [seedN, setSeedN] = useState<number>(
    Math.max(validationCells.length, 12),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync local selection when the underlying test changes (id) or its
  // cells are replaced from outside (e.g. after a server refetch).
  useEffect(() => {
    setSelectedIds(
      new Set(
        validationCells
          .map((c) => c.palette_entry_id)
          .filter((x): x is number => x != null),
      ),
    );
  }, [testId, validationCells.length]);

  // Active burn material — the one the test is photographed on. The
  // source defaults to this when ``sourceMaterialId`` is null.
  const effectiveSourceId = sourceMaterialId ?? materialId;

  // Group cross-source picks by their material so the UI can render a
  // section per material. Materials referenced by picks but absent
  // from the user's library map to ``unknown``; the heading falls
  // back to "material #{id}".
  const crossGroups = useMemo(() => {
    if (crossSourceEntries.length === 0) return [];
    const groups = new Map<number, PaletteEntry[]>();
    for (const e of crossSourceEntries) {
      let arr = groups.get(e.material_id);
      if (!arr) {
        arr = [];
        groups.set(e.material_id, arr);
      }
      arr.push(e);
    }
    return [...groups.entries()].map(([mid, entries]) => ({
      materialId: mid,
      label: materials.find((m) => m.id === mid)?.name ?? `material #${mid}`,
      entries: [...entries].sort(
        (a, b) => (a.lab?.[0] ?? 0) - (b.lab?.[0] ?? 0),
      ),
    }));
  }, [crossSourceEntries, materials]);

  // Combined palette — active source + every pick from elsewhere. Used
  // by ``save`` so a cell carrying a cross-source palette_entry_id
  // resolves to the right entry when we materialise the L*-sorted
  // cell list. Without this, dropping a pick from a different
  // material would silently fail the lookup and the cell would be
  // dropped.
  const combinedById = useMemo(() => {
    const m = new Map<number, PaletteEntry>();
    for (const p of palette) m.set(p.id, p);
    for (const p of crossSourceEntries) m.set(p.id, p);
    return m;
  }, [palette, crossSourceEntries]);

  const save = async (next: Set<number>) => {
    if (testId === null) {
      // Test hasn't been created yet — local state only; the picker
      // payload will be flushed once the parent finishes creation.
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // L*-sort the picked entries — darkest first = cell_index 0,
      // matching the burn ordering the xcs builder uses. We pull
      // from the combined map so cross-source picks survive.
      const picked: PaletteEntry[] = [];
      for (const id of next) {
        const e = combinedById.get(id);
        if (e) picked.push(e);
      }
      picked.sort((a, b) => (a.lab?.[0] ?? 0) - (b.lab?.[0] ?? 0));
      const cells = picked.map((p, i) => ({
        cell_index: i,
        palette_entry_id: p.id,
        expected_hex: p.hex,
        expected_lab: p.lab,
        params: p.params,
      }));
      await patchValidationCells(testId, cells);
      // Reflect the new shape in the parent without a refetch round-trip.
      // Server-side IDs are unknown here — synthesise negatives so the
      // shape is consistent and gets replaced on the next real load.
      onValidationCellsChange(
        cells.map(
          (c, i) =>
            ({
              ...c,
              id: -i - 1,
              test_id: testId,
            }) as ValidationCell,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removePicks = (ids: number[]) => {
    if (ids.length === 0) return;
    const next = new Set(selectedIds);
    let changed = false;
    for (const id of ids) {
      if (next.delete(id)) changed = true;
    }
    if (!changed) return;
    setSelectedIds(next);
    void save(next);
  };

  const sourceMaterialName = materials.find(
    (m) => m.id === effectiveSourceId,
  )?.name;

  return (
    <div className="space-y-3 p-4">
      {testId === null && (
        <div className="rounded-[6px] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-tint)]/60 px-3 py-2 text-[11.5px] text-[color:var(--color-warning)]">
          Create the test first — the palette pick is saved alongside
          its cells once the test row exists.
        </div>
      )}

      {/* Source palette selector — defaults to the test's own
       *  material. Switching to another material lets the user pick
       *  cells from a different palette while still burning on the
       *  test's actual substrate. Picks already in the cell list are
       *  preserved across the toggle and surfaced as "Picks from X"
       *  groups below. */}
      <SourceMaterialRow
        materials={materials}
        burnMaterialId={materialId}
        sourceMaterialId={sourceMaterialId}
        onSourceMaterialChange={onSourceMaterialChange}
      />

      {crossGroups.map((group) => (
        <CrossSourceGroup
          key={group.materialId}
          materialName={group.label}
          entries={group.entries}
          onRemoveAll={() =>
            removePicks(group.entries.map((e) => e.id))
          }
          onRemoveOne={(id) => removePicks([id])}
        />
      ))}

      <MaterialPalettePicker
        entries={palette}
        selectedIds={selectedIds}
        onSelectionChange={(next) => {
          setSelectedIds(next);
          void save(next);
        }}
        seedN={seedN}
        onSeedNChange={setSeedN}
        materialLabel={
          sourceMaterialName !== undefined
            ? sourceMaterialName
            : effectiveSourceId !== null
              ? `material #${effectiveSourceId}`
              : undefined
        }
      />
      {saving && (
        <div className="text-[11px] text-[color:var(--color-ink-muted)]">
          saving picks…
        </div>
      )}
      {error && (
        <div className="text-[11px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      )}
    </div>
  );
}

/* ─── Source material picker ───────────────────────────────────────── */

function SourceMaterialRow({
  materials,
  burnMaterialId,
  sourceMaterialId,
  onSourceMaterialChange,
}: {
  materials: Material[];
  burnMaterialId: number | null;
  sourceMaterialId: number | null;
  onSourceMaterialChange: (next: number | null) => void;
}) {
  const burnMaterialName = materials.find((m) => m.id === burnMaterialId)?.name;
  // Effective source = burn material when override is null. Show that
  // explicitly so the user sees what they're picking from when they
  // haven't touched the override.
  const value = sourceMaterialId == null ? "" : String(sourceMaterialId);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-[6px]",
        "border border-[color:var(--color-border)]",
        "bg-[color:var(--color-surface)] px-3 py-2",
      )}
    >
      <span className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
        Source palette
      </span>
      <Select
        value={value}
        onChange={(e) =>
          onSourceMaterialChange(
            e.target.value === "" ? null : Number(e.target.value),
          )
        }
        className="flex-1 min-w-[180px]"
        aria-label="Source palette material"
      >
        <option value="">
          Same as burn material{burnMaterialName ? ` (${burnMaterialName})` : ""}
        </option>
        {materials
          .filter((m) => m.id !== burnMaterialId)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </Select>
      {sourceMaterialId != null && (
        <span className="font-mono text-[10.5px] text-[color:var(--color-ink-muted)]">
          Cross-material — burns on{" "}
          <span className="text-[color:var(--color-ink)]">
            {burnMaterialName ?? `#${burnMaterialId}`}
          </span>
          , colours seeded from the source.
        </span>
      )}
    </div>
  );
}

/* ─── Cross-material pick group ────────────────────────────────────── */

function CrossSourceGroup({
  materialName,
  entries,
  onRemoveAll,
  onRemoveOne,
}: {
  materialName: string;
  entries: PaletteEntry[];
  onRemoveAll: () => void;
  onRemoveOne: (id: number) => void;
}) {
  return (
    <section
      className={cn(
        "rounded-[6px] border border-[color:var(--color-border)]",
        "bg-[color:var(--color-surface-elevated)] px-3 py-3",
      )}
    >
      <header className="flex items-baseline justify-between gap-2 mb-2">
        <div>
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            Picks from
          </span>{" "}
          <span className="font-mono text-[12.5px] font-semibold text-[color:var(--color-ink)]">
            {materialName}
          </span>
          <span className="ml-2 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)]">
            ({entries.length})
          </span>
        </div>
        <button
          type="button"
          onClick={onRemoveAll}
          className={cn(
            "h-6 px-2 rounded-[4px]",
            "font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase",
            "border border-[color:var(--color-border)]",
            "text-[color:var(--color-ink-subtle)]",
            "hover:text-[color:var(--color-destructive)] hover:border-[color:var(--color-destructive)]/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
            "transition-colors",
          )}
          title={`Remove all picks from ${materialName}`}
        >
          remove all
        </button>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
        {entries.map((e) => (
          <CrossSourceSwatch
            key={e.id}
            entry={e}
            onRemove={() => onRemoveOne(e.id)}
          />
        ))}
      </div>
    </section>
  );
}

function CrossSourceSwatch({
  entry,
  onRemove,
}: {
  entry: PaletteEntry;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className={cn(
        "group relative flex flex-col gap-1 p-1 rounded-[6px] text-left",
        "border border-[color:var(--color-border)]",
        "hover:border-[color:var(--color-destructive)]/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        "transition-colors",
      )}
      title={`Remove ${entry.hex} from picks`}
    >
      <div
        className="h-7 rounded-[3px] border border-[color:var(--color-border)]"
        style={{ background: entry.hex }}
      />
      <div className="font-mono text-[9px] text-[color:var(--color-ink)] leading-none">
        {entry.hex}
      </div>
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 right-0.5 inline-flex items-center justify-center",
          "w-4 h-4 rounded-[3px] text-[9px] font-semibold",
          "bg-[color:var(--color-surface)] border border-[color:var(--color-border)]",
          "text-[color:var(--color-ink-subtle)]",
          "opacity-0 group-hover:opacity-100 transition-opacity",
        )}
      >
        ×
      </span>
    </button>
  );
}
