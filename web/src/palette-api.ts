import type {
  BaseParams,
  CaptureIngestResponse,
  LegacyPaletteEntry as PaletteEntry,
  LegacyPaletteQueryResult as PaletteQueryResult,
} from "./types";

export async function captureIngest(file: File): Promise<CaptureIngestResponse> {
  const fd = new FormData();
  fd.append("image", file);
  const r = await fetch("/api/capture/ingest", { method: "POST", body: fd });
  if (!r.ok) {
    let msg = "upload failed";
    try {
      const body = await r.json();
      if (body?.detail) msg = body.detail;
    } catch {
      // fallthrough — non-JSON error body
    }
    throw new Error(msg);
  }
  return r.json();
}

export interface PaletteIngestBody {
  test_id: string;
  material_id: string;
  x_param: string;
  y_param: string | null;
  base_params: BaseParams;
  swatches: {
    row: number;
    col: number;
    x_value: number;
    y_value: number | null;
    hex: string;
    sigma: number;
  }[];
}

export async function paletteIngest(body: PaletteIngestBody): Promise<{ added_ids: string[] }> {
  const r = await fetch("/api/palette/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? "ingest failed");
  return r.json();
}

export async function paletteList(materialId?: string): Promise<PaletteEntry[]> {
  const q = materialId ? `?material_id=${encodeURIComponent(materialId)}` : "";
  const r = await fetch(`/api/palette${q}`);
  if (!r.ok) throw new Error("failed to list palette");
  return r.json();
}

export async function paletteQuery(
  hex: string, limit = 5, materialId?: string,
): Promise<PaletteQueryResult[]> {
  const parts = [`hex=${encodeURIComponent(hex)}`, `limit=${limit}`];
  if (materialId) parts.push(`material_id=${encodeURIComponent(materialId)}`);
  const r = await fetch(`/api/palette/query?${parts.join("&")}`);
  if (!r.ok) throw new Error("query failed");
  return r.json();
}

export async function paletteDelete(id: string): Promise<void> {
  const r = await fetch(`/api/palette/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("delete failed");
}

export async function paletteDeleteByTest(testId: string): Promise<void> {
  const r = await fetch(`/api/palette/by-test/${testId}`, { method: "DELETE" });
  if (!r.ok) throw new Error("delete failed");
}

export async function palettePatchNotes(id: string, notes: string): Promise<PaletteEntry> {
  const r = await fetch(`/api/palette/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  if (!r.ok) throw new Error("patch failed");
  return r.json();
}
