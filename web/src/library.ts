import { defaultBaseParams } from "./defaults";

export interface Material {
  id: string;
  name: string;
  notes?: string;
  created_at: string;
}

export interface Preset {
  id: string;
  material_id: string;
  name: string;
  color?: string;
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
  version: 1;
  active_material_id: string;
  materials: Material[];
  presets: Preset[];
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

export function bootstrapLibrary(): LibraryState {
  const materialId = uuid();
  const presetId = uuid();
  const ts = now();
  return {
    version: 1,
    active_material_id: materialId,
    materials: [
      { id: materialId, name: "Stainless Steel", created_at: ts },
    ],
    presets: [
      {
        id: presetId,
        material_id: materialId,
        name: "Default",
        is_default: true,
        base_params: defaultBaseParams(),
        created_at: ts,
        updated_at: ts,
      },
    ],
  };
}

export function addMaterial(s: LibraryState, name: string): LibraryState {
  const m: Material = { id: uuid(), name, created_at: now() };
  return { ...s, materials: [...s.materials, m] };
}

export function deleteMaterial(s: LibraryState, id: string): LibraryState {
  const hasPresets = s.presets.some((p) => p.material_id === id);
  if (hasPresets) {
    throw new Error("Cannot delete material with existing presets");
  }
  const materials = s.materials.filter((m) => m.id !== id);
  let active = s.active_material_id;
  if (active === id) {
    active = materials[0]?.id ?? "";
  }
  return { ...s, materials, active_material_id: active };
}

export function renameMaterial(s: LibraryState, id: string, name: string): LibraryState {
  return {
    ...s,
    materials: s.materials.map((m) => (m.id === id ? { ...m, name } : m)),
  };
}

export function setActiveMaterial(s: LibraryState, id: string): LibraryState {
  if (!s.materials.some((m) => m.id === id)) {
    throw new Error(`No material with id ${id}`);
  }
  return { ...s, active_material_id: id };
}

export function addPreset(
  s: LibraryState,
  materialId: string,
  seed: { name: string; base_params: Preset["base_params"]; color?: string },
): LibraryState {
  const isFirstInMaterial = !s.presets.some((p) => p.material_id === materialId);
  const ts = now();
  const p: Preset = {
    id: uuid(),
    material_id: materialId,
    name: seed.name,
    color: seed.color,
    is_default: isFirstInMaterial,
    base_params: { ...seed.base_params },
    created_at: ts,
    updated_at: ts,
  };
  return { ...s, presets: [...s.presets, p] };
}

export function deletePreset(s: LibraryState, id: string): LibraryState {
  const target = s.presets.find((p) => p.id === id);
  if (!target) return s;
  const remaining = s.presets.filter((p) => p.id !== id);
  if (target.is_default) {
    const firstInMat = remaining.findIndex((p) => p.material_id === target.material_id);
    if (firstInMat !== -1) {
      remaining[firstInMat] = { ...remaining[firstInMat], is_default: true };
    }
  }
  return { ...s, presets: remaining };
}

export function updatePreset(
  s: LibraryState,
  id: string,
  patch: Partial<Pick<Preset, "name" | "color" | "base_params">>,
): LibraryState {
  return {
    ...s,
    presets: s.presets.map((p) =>
      p.id === id
        ? { ...p, ...patch, base_params: patch.base_params ?? p.base_params, updated_at: now() }
        : p,
    ),
  };
}

export function setDefaultPreset(s: LibraryState, id: string): LibraryState {
  const target = s.presets.find((p) => p.id === id);
  if (!target) return s;
  return {
    ...s,
    presets: s.presets.map((p) => {
      if (p.material_id !== target.material_id) return p;
      return { ...p, is_default: p.id === id };
    }),
  };
}
