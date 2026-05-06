export type MaterialShape = "circle" | "rect";

export interface Material {
  id: number;
  name: string;
  notes: string;
  created_at: string;
  /** Optional physical-shape metadata. ``null`` (or undefined) for
   *  materials that haven't been measured. Drives the Tests-page
   *  auto-fit feature; the dimension fields hold the actual size. */
  shape?: MaterialShape | null;
  /** Set when ``shape === "circle"``; null otherwise. */
  diameter_mm?: number | null;
  /** Set when ``shape === "rect"``; null otherwise. */
  width_mm?: number | null;
  /** Set when ``shape === "rect"``; null otherwise. */
  height_mm?: number | null;
  /** When true, this material pre-fills the picker on the new-test
   *  page. At most one material per owner has this set; promoting a
   *  different material clears it on the previous holder server-side. */
  is_default: boolean;
  /** Per-substrate WB calibration config; absent / null when the
   *  material has no calibration profile yet. */
  calibration?: MaterialCalibrationConfig | null;
}

import type { BaseParams, MaterialCalibrationConfig } from "./types";

export interface Preset {
  id: number;
  material_id: number;
  name: string;
  color: string | null;
  is_default: boolean;
  base_params: BaseParams;
  created_at: string;
  updated_at: string;
}

export interface LibraryState {
  materials: Material[];
  presets: Preset[];
  active_material_id: number | null;
}
