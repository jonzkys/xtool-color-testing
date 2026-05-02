import { useEffect, useState } from "react";
import { MaterialPalettePicker } from "./MaterialPalettePicker";
import { patchValidationCells } from "../api/validationCells";
import type { PaletteEntry, ValidationCell } from "../types";

/**
 * ValidationPaletteTab — host for the MaterialPalettePicker inside the
 * test editor's `palette` tab (only rendered for `kind === "validation"`
 * tests). Owns the picker's `selectedIds` + `seedN` UI state and pushes
 * each change through to the backend via `patchValidationCells`, then
 * mirrors the new cell list into the parent so the rest of the editor
 * (and downstream `.xcs` generate) sees the updated burn ordering
 * without a refetch.
 *
 * Cells are L*-sorted on save (darkest first = `cell_index` 0). This
 * matches the burn ordering the xcs builder uses.
 */

export interface ValidationPaletteTabProps {
  testId: number | null;
  materialId: number | null;
  validationCells: ValidationCell[];
  onValidationCellsChange: (next: ValidationCell[]) => void;
  palette: PaletteEntry[];
}

export function ValidationPaletteTab({
  testId,
  materialId,
  validationCells,
  onValidationCellsChange,
  palette,
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
      // matching the burn ordering the xcs builder uses.
      const picked = palette
        .filter((p) => next.has(p.id))
        .sort((a, b) => (a.lab?.[0] ?? 0) - (b.lab?.[0] ?? 0));
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

  return (
    <div className="space-y-3 p-4">
      {testId === null && (
        <div className="rounded-[6px] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-tint)]/60 px-3 py-2 text-[11.5px] text-[color:var(--color-warning)]">
          Create the test first — the palette pick is saved alongside
          its cells once the test row exists.
        </div>
      )}
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
          materialId !== null ? `material #${materialId}` : undefined
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
