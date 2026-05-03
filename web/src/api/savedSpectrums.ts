import type { SavedSpectrum, SavedSpectrumCreate } from "../types";
import { j } from "./_fetch";

export async function listSpectrums(filters: {
  materialId?: number;
  minR2?: number;
  sourceTestId?: number;
} = {}): Promise<SavedSpectrum[]> {
  const params = new URLSearchParams();
  if (filters.minR2 != null) params.set("min_r2", String(filters.minR2));
  if (filters.materialId != null) params.set("material_id", String(filters.materialId));
  if (filters.sourceTestId != null) params.set("source_test_id", String(filters.sourceTestId));
  const qs = params.toString();
  return j(await fetch(`/api/spectrums${qs ? `?${qs}` : ""}`));
}

export async function getSpectrum(id: number): Promise<SavedSpectrum> {
  return j(await fetch(`/api/spectrums/${id}`));
}

export async function createSpectrum(
  body: SavedSpectrumCreate,
): Promise<SavedSpectrum> {
  return j(await fetch("/api/spectrums", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function patchSpectrum(
  id: number,
  patch: { name?: string },
): Promise<SavedSpectrum> {
  return j(await fetch(`/api/spectrums/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}

export async function deleteSpectrum(id: number): Promise<void> {
  await j(await fetch(`/api/spectrums/${id}`, { method: "DELETE" }));
}
