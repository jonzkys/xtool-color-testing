import type { AveragedSwatch, ResultRecord } from "../types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

export async function listResults(testId: number): Promise<ResultRecord[]> {
  return j(await fetch(`/api/tests/${testId}/results`));
}
export async function uploadResult(testId: number, file: File): Promise<ResultRecord> {
  const fd = new FormData(); fd.append("image", file);
  return j(await fetch(`/api/tests/${testId}/results`, { method: "POST", body: fd }));
}
export async function patchResult(rid: number, patch: { excluded?: boolean; notes?: string; }): Promise<ResultRecord> {
  return j(await fetch(`/api/results/${rid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}
export async function deleteResult(rid: number): Promise<void> {
  await j(await fetch(`/api/results/${rid}`, { method: "DELETE" }));
}
export async function getAveragedSwatches(testId: number): Promise<AveragedSwatch[]> {
  return j(await fetch(`/api/tests/${testId}/swatches`));
}
export async function ingestToPalette(testId: number, body: {
  swatch_indices: number[];
  mode: "averaged" | "single_result";
  result_id?: number;
  replace_existing?: boolean;
}): Promise<{ added: number; ids: number[] }> {
  return j(await fetch(`/api/tests/${testId}/ingest-to-palette`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
