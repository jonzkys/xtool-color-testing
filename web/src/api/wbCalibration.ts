import type { MaterialCalibrationConfig } from "../types";
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

export async function reingestResult(resultId: number): Promise<unknown> {
  return j(await fetch(`/api/results/${resultId}/reingest`, { method: "POST" }));
}
