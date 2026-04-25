import type { TestRecord, TestSpec } from "../types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

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
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.blob();
}

/** Bump the test's retest counter. The user then clicks Generate to
 *  download an XCS whose QR stamps the new number — the ingest path
 *  copies that onto every result uploaded from this burn. */
export async function retestTest(id: number): Promise<TestRecord> {
  return j(await fetch(`/api/tests/${id}/retest`, { method: "POST" }));
}
