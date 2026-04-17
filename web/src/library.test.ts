import { describe, test, expect } from "vitest";
import {
  addMaterial,
  addPreset,
  bootstrapLibrary,
  deleteMaterial,
  deletePreset,
  renameMaterial,
  setActiveMaterial,
  setDefaultPreset,
  updatePreset,
  type LibraryState,
  type Preset,
} from "./library";

describe("bootstrapLibrary", () => {
  test("creates Stainless Steel with one default preset", () => {
    const s = bootstrapLibrary();
    expect(s.version).toBe(1);
    expect(s.materials).toHaveLength(1);
    expect(s.materials[0].name).toBe("Stainless Steel");
    expect(s.presets).toHaveLength(1);
    expect(s.presets[0].name).toBe("Default");
    expect(s.presets[0].is_default).toBe(true);
    expect(s.presets[0].material_id).toBe(s.materials[0].id);
    expect(s.active_material_id).toBe(s.materials[0].id);
  });

  test("seed preset uses defaultBaseParams values", () => {
    const s = bootstrapLibrary();
    const p = s.presets[0];
    expect(p.base_params).toEqual({
      power: 14.6, speed: 1000, frequency: 125, density: 5000,
      passes: 1, pulse_width: 200, laser: "red",
    });
  });
});

describe("addMaterial", () => {
  test("appends a new material with given name", () => {
    const s = bootstrapLibrary();
    const s2 = addMaterial(s, "Anodised Aluminium");
    expect(s2.materials).toHaveLength(2);
    expect(s2.materials[1].name).toBe("Anodised Aluminium");
    expect(s2.materials[1].id).not.toBe(s.materials[0].id);
  });

  test("does not mutate input", () => {
    const s = bootstrapLibrary();
    const before = JSON.stringify(s);
    addMaterial(s, "X");
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("deleteMaterial", () => {
  test("removes material with no presets", () => {
    let s = bootstrapLibrary();
    s = addMaterial(s, "Brass");
    const brassId = s.materials[1].id;
    const s2 = deleteMaterial(s, brassId);
    expect(s2.materials).toHaveLength(1);
  });

  test("throws if material has presets", () => {
    const s = bootstrapLibrary();
    const stainlessId = s.materials[0].id;
    expect(() => deleteMaterial(s, stainlessId)).toThrow(/preset/i);
  });

  test("reassigns active_material_id if active material deleted", () => {
    let s = bootstrapLibrary();
    s = addMaterial(s, "Brass");
    const brassId = s.materials[1].id;
    s = setActiveMaterial(s, brassId);
    expect(s.active_material_id).toBe(brassId);
    const s2 = deleteMaterial(s, brassId);
    expect(s2.active_material_id).toBe(s.materials[0].id);
  });

  test("sets active_material_id to empty string when the only material is deleted", () => {
    let s = bootstrapLibrary();
    // Remove the preset first so deleteMaterial won't throw
    s = deletePreset(s, s.presets[0].id);
    const onlyId = s.materials[0].id;
    const s2 = deleteMaterial(s, onlyId);
    expect(s2.active_material_id).toBe("");
    expect(s2.materials).toHaveLength(0);
  });
});

describe("renameMaterial", () => {
  test("updates name", () => {
    const s = bootstrapLibrary();
    const id = s.materials[0].id;
    const s2 = renameMaterial(s, id, "Stainless 304");
    expect(s2.materials[0].name).toBe("Stainless 304");
  });
});

describe("setActiveMaterial", () => {
  test("updates active_material_id", () => {
    let s = bootstrapLibrary();
    s = addMaterial(s, "Brass");
    const brassId = s.materials[1].id;
    const s2 = setActiveMaterial(s, brassId);
    expect(s2.active_material_id).toBe(brassId);
  });

  test("throws if material does not exist", () => {
    const s = bootstrapLibrary();
    expect(() => setActiveMaterial(s, "nope")).toThrow();
  });
});

describe("addPreset", () => {
  test("creates a preset under the given material with seed values", () => {
    const s = bootstrapLibrary();
    const matId = s.materials[0].id;
    const seed: Preset["base_params"] = {
      power: 20, speed: 500, frequency: 60000, density: 300,
      passes: 2, pulse_width: 100, laser: "red",
    };
    const s2 = addPreset(s, matId, { name: "Copper", base_params: seed });
    expect(s2.presets).toHaveLength(2);
    const added = s2.presets[1];
    expect(added.name).toBe("Copper");
    expect(added.base_params).toEqual(seed);
    expect(added.material_id).toBe(matId);
    expect(added.is_default).toBe(false);
  });

  test("first preset in a material is marked is_default automatically", () => {
    let s = bootstrapLibrary();
    s = addMaterial(s, "Brass");
    const brassId = s.materials[1].id;
    const s2 = addPreset(s, brassId, {
      name: "Brass Default",
      base_params: {
        power: 10, speed: 1000, frequency: 1, density: 1,
        passes: 1, pulse_width: 1, laser: "red",
      },
    });
    const created = s2.presets.find((p) => p.material_id === brassId)!;
    expect(created.is_default).toBe(true);
  });
});

describe("deletePreset", () => {
  test("removes the preset", () => {
    let s = bootstrapLibrary();
    const matId = s.materials[0].id;
    s = addPreset(s, matId, {
      name: "Second",
      base_params: {
        power: 1, speed: 1, frequency: 1, density: 1,
        passes: 1, pulse_width: 1, laser: "red",
      },
    });
    expect(s.presets).toHaveLength(2);
    const s2 = deletePreset(s, s.presets[1].id);
    expect(s2.presets).toHaveLength(1);
  });

  test("promotes another preset to default when the default is deleted", () => {
    let s = bootstrapLibrary();
    const matId = s.materials[0].id;
    s = addPreset(s, matId, {
      name: "Second",
      base_params: {
        power: 1, speed: 1, frequency: 1, density: 1,
        passes: 1, pulse_width: 1, laser: "red",
      },
    });
    const defaultId = s.presets[0].id;
    const s2 = deletePreset(s, defaultId);
    expect(s2.presets).toHaveLength(1);
    expect(s2.presets[0].is_default).toBe(true);
  });
});

describe("updatePreset", () => {
  test("patches name and base_params", () => {
    const s = bootstrapLibrary();
    const id = s.presets[0].id;
    const s2 = updatePreset(s, id, {
      name: "Renamed",
      base_params: { ...s.presets[0].base_params, power: 99 },
    });
    expect(s2.presets[0].name).toBe("Renamed");
    expect(s2.presets[0].base_params.power).toBe(99);
  });
});

describe("setDefaultPreset", () => {
  test("moves is_default exclusively to the target preset within its material", () => {
    let s = bootstrapLibrary();
    const matId = s.materials[0].id;
    s = addPreset(s, matId, {
      name: "Second",
      base_params: {
        power: 1, speed: 1, frequency: 1, density: 1,
        passes: 1, pulse_width: 1, laser: "red",
      },
    });
    const secondId = s.presets[1].id;
    const s2 = setDefaultPreset(s, secondId);
    expect(s2.presets[0].is_default).toBe(false);
    expect(s2.presets[1].is_default).toBe(true);
  });

  test("throws on unknown preset id", () => {
    const s = bootstrapLibrary();
    expect(() => setDefaultPreset(s, "nope")).toThrow();
  });

  test("does not affect presets in other materials", () => {
    let s = bootstrapLibrary();
    s = addMaterial(s, "Brass");
    const brassId = s.materials[1].id;
    s = addPreset(s, brassId, {
      name: "Brass A",
      base_params: {
        power: 1, speed: 1, frequency: 1, density: 1,
        passes: 1, pulse_width: 1, laser: "red",
      },
    });
    const stainlessDefaultId = s.presets[0].id;
    const brassDefaultId = s.presets.find((p) => p.material_id === brassId)!.id;
    const s2 = setDefaultPreset(s, brassDefaultId);
    expect(s2.presets.find((p) => p.id === stainlessDefaultId)!.is_default).toBe(true);
    expect(s2.presets.find((p) => p.id === brassDefaultId)!.is_default).toBe(true);
  });
});
