export interface Material {
  id: number;
  name: string;
  notes: string;
  created_at: string;
}

export interface Preset {
  id: number;
  material_id: number;
  name: string;
  color: string | null;
  is_default: boolean;
  base_params: {
    power: number;
    speed: number;
    frequency: number;
    density: number;
    passes: number;
    pulse_width: number;
    laser: "red" | "blue";
  };
  created_at: string;
  updated_at: string;
}

export interface LibraryState {
  materials: Material[];
  presets: Preset[];
  active_material_id: number | null;
}
