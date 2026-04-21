export interface Material {
  id: number;
  name: string;
  notes: string;
  created_at: string;
}

import type { BaseParams } from "./types";

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
