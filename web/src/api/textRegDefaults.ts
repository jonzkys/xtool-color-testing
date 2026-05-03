import type {
  TextRegMachineDefault,
  TextRegMaterialDefault,
  TextRegParamsBody,
  TextRegResolveResponse,
} from "../types";
import { j } from "./_fetch";

/**
 * Per-machine / per-material default params for the engraved
 * QR + ArUco fiducials, axis ticks, axis labels, and summary text strip.
 *
 * Two layers exist — material-level (most specific) and machine-level
 * (fallback). The `resolve` endpoint returns the effective triple plus
 * a `source` tag so the UI can label which layer it came from.
 */

export async function resolveTextRegDefaults(
  machineId: string,
  materialId?: number | null,
): Promise<TextRegResolveResponse> {
  const qs = new URLSearchParams({ machine_id: machineId });
  if (materialId != null) qs.set("material_id", String(materialId));
  return j(await fetch(`/api/text-registration-defaults/resolve?${qs}`));
}

export async function getMachineTextRegDefault(
  machineId: string,
): Promise<TextRegMachineDefault | null> {
  return j(await fetch(
    `/api/text-registration-defaults/machine/${encodeURIComponent(machineId)}`,
  ));
}

export async function putMachineTextRegDefault(
  machineId: string,
  body: TextRegParamsBody,
): Promise<TextRegMachineDefault> {
  return j(await fetch(
    `/api/text-registration-defaults/machine/${encodeURIComponent(machineId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ));
}

export async function deleteMachineTextRegDefault(
  machineId: string,
): Promise<void> {
  await j(await fetch(
    `/api/text-registration-defaults/machine/${encodeURIComponent(machineId)}`,
    { method: "DELETE" },
  ));
}

export async function listMaterialTextRegDefaults(
  materialId: number,
): Promise<TextRegMaterialDefault[]> {
  return j(await fetch(
    `/api/text-registration-defaults/material/${materialId}`,
  ));
}

export async function putMaterialTextRegDefault(
  materialId: number,
  machineId: string,
  body: TextRegParamsBody,
): Promise<TextRegMaterialDefault> {
  return j(await fetch(
    `/api/text-registration-defaults/material/${materialId}/${encodeURIComponent(machineId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ));
}

export async function deleteMaterialTextRegDefault(
  materialId: number,
  machineId: string,
): Promise<void> {
  await j(await fetch(
    `/api/text-registration-defaults/material/${materialId}/${encodeURIComponent(machineId)}`,
    { method: "DELETE" },
  ));
}
