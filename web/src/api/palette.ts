import type { PaletteEntry, PaletteQueryResult } from "../types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

export async function listPaletteEntries(materialId?: number): Promise<PaletteEntry[]> {
  const qs = materialId ? `?material_id=${materialId}` : "";
  return j(await fetch(`/api/palette${qs}`));
}
export async function queryPalette(hex: string, opts: {
  limit?: number; material_id?: number;
} = {}): Promise<PaletteQueryResult[]> {
  const qs = new URLSearchParams({ hex });
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.material_id) qs.set("material_id", String(opts.material_id));
  return j(await fetch(`/api/palette/query?${qs}`));
}
export async function deletePaletteEntry(id: number): Promise<void> {
  await j(await fetch(`/api/palette/${id}`, { method: "DELETE" }));
}
export async function deletePaletteByTest(testId: number): Promise<void> {
  await j(await fetch(`/api/palette/by-test/${testId}`, { method: "DELETE" }));
}
export async function patchPaletteNotes(id: number, notes: string): Promise<PaletteEntry> {
  return j(await fetch(`/api/palette/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  }));
}
