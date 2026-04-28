import type {
  AveragedSwatch, ResultRecord,
  SampleAggregator, SwatchPreviewResponse, InspectCellResponse,
} from "../types";
import { j } from "./_fetch";

export async function listResults(testId: number): Promise<ResultRecord[]> {
  return j(await fetch(`/api/tests/${testId}/results`));
}
export async function uploadResult(testId: number, file: File): Promise<ResultRecord> {
  const fd = new FormData(); fd.append("image", file);
  return j(await fetch(`/api/tests/${testId}/results`, { method: "POST", body: fd }));
}
export async function uploadResultAuto(file: File): Promise<ResultRecord> {
  const fd = new FormData(); fd.append("image", file);
  return j(await fetch(`/api/results/upload`, { method: "POST", body: fd }));
}
export interface UploadPreflight {
  test_id: number;
  test_name: string;
  existing_result_count: number;
}
export async function preflightUpload(file: File): Promise<UploadPreflight> {
  const fd = new FormData(); fd.append("image", file);
  return j(await fetch(`/api/results/preflight`, { method: "POST", body: fd }));
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
export async function reingestResult(rid: number): Promise<ResultRecord> {
  return j(await fetch(`/api/results/${rid}/reingest`, { method: "POST" }));
}

export async function previewSwatches(
  rid: number, aggregator: SampleAggregator,
): Promise<SwatchPreviewResponse> {
  return j(await fetch(
    `/api/results/${rid}/swatches/preview?aggregator=${encodeURIComponent(aggregator)}`,
  ));
}

export async function inspectCell(
  rid: number, row: number, col: number,
): Promise<InspectCellResponse> {
  return j(await fetch(`/api/results/${rid}/inspect/${row}/${col}`));
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
