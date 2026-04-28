import type { Material, MaterialShape, Preset } from "../library";
import { j } from "./_fetch";

/** Optional shape + dimensions for the create / update payloads.
 *  Pass ``shape: null`` (with dimensions also null) to clear. */
export interface MaterialShapeFields {
  shape?: MaterialShape | null;
  diameter_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
}

export async function listMaterials(): Promise<Material[]> {
  return j(await fetch("/api/materials"));
}
export async function createMaterial(
  body: { name: string; notes?: string | null } & MaterialShapeFields,
): Promise<Material> {
  return j(await fetch("/api/materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
export async function updateMaterial(
  id: number,
  patch: { name?: string; notes?: string | null } & MaterialShapeFields,
): Promise<Material> {
  return j(await fetch(`/api/materials/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}
export async function deleteMaterial(id: number): Promise<void> {
  await j(await fetch(`/api/materials/${id}`, { method: "DELETE" }));
}
export async function setDefaultMaterial(id: number): Promise<void> {
  await j(await fetch(`/api/materials/${id}/set-default`, { method: "POST" }));
}

export async function listPresets(materialId?: number, machine_id?: string): Promise<Preset[]> {
  const qs = new URLSearchParams();
  if (materialId !== undefined) qs.set("material_id", String(materialId));
  if (machine_id) qs.set("machine_id", machine_id);
  const tail = qs.toString() ? `?${qs.toString()}` : "";
  return j(await fetch(`/api/presets${tail}`));
}
export async function createPreset(body: {
  material_id: number; name: string; color?: string; base_params: Preset["base_params"];
  machine_id: string;
}): Promise<Preset> {
  return j(await fetch("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
export async function updatePreset(
  id: number,
  patch: Partial<Pick<Preset, "name" | "color" | "base_params">>,
): Promise<Preset> {
  return j(await fetch(`/api/presets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}
export async function setDefaultPreset(id: number): Promise<void> {
  await j(await fetch(`/api/presets/${id}/set-default`, { method: "POST" }));
}
export async function deletePreset(id: number): Promise<void> {
  await j(await fetch(`/api/presets/${id}`, { method: "DELETE" }));
}
