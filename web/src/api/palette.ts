import type { PaletteEntry, PaletteQueryResult } from "../types";
import { j } from "./_fetch";

export interface ListPaletteOptions {
  material_id?: number;
  favorites_only?: boolean;
  source?: "averaged" | "single_result" | "manual";
  machine_id?: string;
}

export async function listPaletteEntries(
  arg?: number | ListPaletteOptions,
): Promise<PaletteEntry[]> {
  const opts: ListPaletteOptions =
    typeof arg === "number" ? { material_id: arg } : (arg ?? {});
  const qs = new URLSearchParams();
  if (opts.material_id) qs.set("material_id", String(opts.material_id));
  if (opts.favorites_only) qs.set("favorites_only", "true");
  if (opts.source) qs.set("source", opts.source);
  if (opts.machine_id) qs.set("machine_id", opts.machine_id);
  const tail = qs.toString() ? `?${qs.toString()}` : "";
  return j(await fetch(`/api/palette${tail}`));
}

export async function queryPalette(
  hex: string,
  opts: { limit?: number; material_id?: number; machine_id?: string } = {},
): Promise<PaletteQueryResult[]> {
  const qs = new URLSearchParams({ hex });
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.material_id) qs.set("material_id", String(opts.material_id));
  if (opts.machine_id) qs.set("machine_id", opts.machine_id);
  return j(await fetch(`/api/palette/query?${qs}`));
}

export async function deletePaletteEntry(id: number): Promise<void> {
  await j(await fetch(`/api/palette/${id}`, { method: "DELETE" }));
}

export async function deletePaletteByTest(testId: number): Promise<void> {
  await j(await fetch(`/api/palette/by-test/${testId}`, { method: "DELETE" }));
}

export async function deletePaletteByMaterial(
  materialId: number,
): Promise<{ deleted: number }> {
  return j(await fetch(`/api/palette/by-material/${materialId}`, {
    method: "DELETE",
  }));
}

export interface PaletteEntryPatch {
  hex?: string;
  material_id?: number;
  params?: Record<string, string | number>;
  notes?: string;
  favorited?: boolean;
}

export async function patchPaletteEntry(
  id: number, patch: PaletteEntryPatch,
): Promise<PaletteEntry> {
  return j(await fetch(`/api/palette/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}

export interface CreateManualBody {
  material_id: number;
  hex: string;
  params: Record<string, string | number>;
  notes: string;
  machine_id: string;
}

export async function createManualPaletteEntry(
  body: CreateManualBody,
): Promise<PaletteEntry> {
  return j(await fetch(`/api/palette/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

// Backwards-compat alias for the single existing call site that imports
// `patchPaletteNotes` (will be removed once PalettePage migrates).
export async function patchPaletteNotes(id: number, notes: string): Promise<PaletteEntry> {
  return patchPaletteEntry(id, { notes });
}

export interface PaletteValidationStatus {
  entry_id: number;
  best_de: number | null;
  last_validated_at: string | null;
  validated: boolean;
}

export async function listPaletteValidationStatus(opts: {
  material_id: number;
  machine_id?: string;
  max_de?: number;
}): Promise<PaletteValidationStatus[]> {
  const qs = new URLSearchParams({ material_id: String(opts.material_id) });
  if (opts.machine_id) qs.set("machine_id", opts.machine_id);
  if (opts.max_de != null) qs.set("max_de", String(opts.max_de));
  return j(await fetch(`/api/palette/validation-status?${qs}`));
}

/* ─── Per-entry validate/invalidate ─────────────────────────────────── */

export interface ValidateEntryRequest {
  validated_lab: [number, number, number];
  validated_test_id?: number;
  run_count?: number;
}

export async function validatePaletteEntry(
  id: number,
  body: ValidateEntryRequest,
): Promise<PaletteEntry> {
  return j(await fetch(`/api/palette/${id}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function invalidatePaletteEntry(
  id: number,
): Promise<PaletteEntry> {
  return j(await fetch(`/api/palette/${id}/validate`, { method: "DELETE" }));
}

/* ─── Batch validate from validation test results ───────────────────── */

export interface ValidateBatchOverride {
  cell_index: number;
  accept: boolean;
}

export interface ValidateBatchRequest {
  tolerance_de?: number;
  result_ids?: number[];
  overrides?: ValidateBatchOverride[];
  dry_run?: boolean;
}

export interface ValidateBatchEntry {
  cell_index: number;
  palette_entry_id: number;
  burn_mean_lab: [number, number, number];
  expected_lab: [number, number, number];
  de_burn_vs_expected: number;
  run_count: number;
  n_inputs: number;
  persisted: boolean;
}

export interface ValidateBatchSkipped {
  cell_index: number;
  palette_entry_id: number | null;
  reason:
    | "no_palette_link"
    | "insufficient_runs"
    | "no_measurements";
  run_count?: number;
}

export interface ValidateBatchResponse {
  test_id: number;
  test_name: string;
  tolerance_de: number;
  result_count: number;
  dry_run: boolean;
  auto_validated: ValidateBatchEntry[];
  flagged: ValidateBatchEntry[];
  skipped: ValidateBatchSkipped[];
}

export async function validateBatch(
  testId: number,
  body: ValidateBatchRequest = {},
): Promise<ValidateBatchResponse> {
  return j(await fetch(`/api/tests/${testId}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
