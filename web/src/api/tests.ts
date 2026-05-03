import type { TestRecord, TestSpec } from "../types";
import { ApiError, j } from "./_fetch";
import { captureHandledError } from "../sentry";

export async function listTests(params: {
  material_id?: number; status?: string; machine_id?: string;
} = {}): Promise<TestRecord[]> {
  const qs = new URLSearchParams();
  if (params.material_id) qs.set("material_id", String(params.material_id));
  if (params.status) qs.set("status", params.status);
  if (params.machine_id) qs.set("machine_id", params.machine_id);
  return j(await fetch(`/api/tests?${qs.toString()}`));
}
export async function getTest(id: number): Promise<TestRecord> {
  return j(await fetch(`/api/tests/${id}`));
}
export async function createTest(body: {
  name: string; material_id: number; spec: TestSpec; notes?: string;
  machine_id: string;
  kind?: "sweep" | "validation";
}): Promise<TestRecord> {
  return j(await fetch("/api/tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
export async function updateTest(id: number, patch: {
  name?: string; notes?: string; spec?: TestSpec; material_id?: number;
}): Promise<TestRecord> {
  return j(await fetch(`/api/tests/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}
export async function deleteTest(id: number): Promise<void> {
  await j(await fetch(`/api/tests/${id}`, { method: "DELETE" }));
}
export async function generateTestXcs(id: number): Promise<Blob> {
  const r = await fetch(`/api/tests/${id}/generate`, { method: "POST" });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const err = new ApiError({
      status: r.status, url: r.url, body, message: `${r.status} ${body}`,
    });
    captureHandledError(err, {
      tags: { api_status: String(r.status), api_url: r.url.split("?")[0] },
      extras: { body: body.slice(0, 1000) },
    });
    throw err;
  }
  return r.blob();
}

/** Bump the test's retest counter. The user then clicks Generate to
 *  download an XCS whose QR stamps the new number — the ingest path
 *  copies that onto every result uploaded from this burn. */
export async function retestTest(id: number): Promise<TestRecord> {
  return j(await fetch(`/api/tests/${id}/retest`, { method: "POST" }));
}
