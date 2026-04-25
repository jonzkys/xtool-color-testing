import type { MachinesPayload } from "../types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

let _cache: MachinesPayload | null = null;

/** Fetches the machine registry once per session. The payload is static
 *  for the app's lifetime, so we cache in module scope. */
export async function getMachines(): Promise<MachinesPayload> {
  if (_cache) return _cache;
  _cache = await j<MachinesPayload>(await fetch("/api/machines"));
  return _cache;
}

/** Test seam — clears the in-memory cache so vitest can re-fetch. */
export function _resetMachinesCache(): void {
  _cache = null;
}
