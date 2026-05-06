import type {
  MaterialCalibrationConfig,
  CalibrationMeasureRequest,
} from "../types";
import { j } from "./_fetch";

export async function getMaterialCalibration(
  materialId: number,
): Promise<MaterialCalibrationConfig> {
  return j(await fetch(`/api/materials/${materialId}/calibration`));
}

export async function patchMaterialCalibration(
  materialId: number,
  patch: Partial<MaterialCalibrationConfig>,
): Promise<MaterialCalibrationConfig> {
  return j(await fetch(`/api/materials/${materialId}/calibration`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}

/** Triggers a browser download of a calibration test ``.xcs`` for the
 *  given material. The endpoint streams a binary blob, so this bypasses
 *  the JSON-flavoured ``j`` helper. */
export async function downloadCalibrationXcs(
  materialId: number,
  name: string,
): Promise<void> {
  const resp = await fetch(`/api/materials/${materialId}/calibration/test-xcs`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-calibration.xcs`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function submitCalibrationMeasurement(
  materialId: number,
  body: CalibrationMeasureRequest,
): Promise<MaterialCalibrationConfig> {
  return j(await fetch(`/api/materials/${materialId}/calibration/measure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function reingestResult(resultId: number): Promise<unknown> {
  return j(await fetch(`/api/results/${resultId}/reingest`, { method: "POST" }));
}
