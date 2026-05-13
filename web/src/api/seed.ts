import { j } from "./_fetch";

/** Mirrors ``SeedPreviewResponse`` in ``schemas.py`` — read-only
 *  counts shown in the import-confirmation modal. ``already_imported``
 *  flips the modal into "you've already done this" mode (no checkbox,
 *  no import button); ``src_has_data`` is false when the configured
 *  seed account is itself empty. */
export interface SeedPreview {
  src_owner_id: number;
  src_has_data: boolean;
  already_imported: boolean;
  materials: number;
  presets: number;
  tests: number;
  results: number;
  palette_entries: number;
  saved_spectrums: number;
}

/** Mirrors ``SeedImportResponse``. The image-warnings list is the
 *  source-side miss list — rows that were copied but whose image
 *  bytes couldn't be located on disk; surfaced as info, not error. */
export interface SeedImportResult {
  materials: number;
  presets: number;
  tests: number;
  results: number;
  palette_entries: number;
  saved_spectrums: number;
  validation_cells: number;
  text_reg_machine: number;
  text_reg_material: number;
  image_warnings: string[];
}

export async function getSeedPreview(): Promise<SeedPreview> {
  return j(await fetch("/api/seed/preview"));
}

export async function runSeedImport(): Promise<SeedImportResult> {
  return j(
    await fetch("/api/seed/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
  );
}
