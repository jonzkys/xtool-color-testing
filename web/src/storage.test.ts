import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { loadProject, saveProject, STORAGE_KEY } from "./storage";
import { defaultProject } from "./defaults";

function mockStorage(): Storage {
  let data: Record<string, string> = {};
  return {
    getItem: vi.fn((k: string) => data[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { data[k] = v; }),
    removeItem: vi.fn((k: string) => { delete data[k]; }),
    clear: vi.fn(() => { data = {}; }),
    key: vi.fn((i: number) => Object.keys(data)[i] ?? null),
    get length() { return Object.keys(data).length; },
  };
}

describe("storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
  });

  it("returns null when no project saved", () => {
    expect(loadProject()).toBeNull();
  });

  it("round-trips a project through localStorage", () => {
    const project = defaultProject();
    saveProject(project);
    const loaded = loadProject();
    expect(loaded).toEqual(project);
  });

  it("uses the documented key", () => {
    const project = defaultProject();
    saveProject(project);
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it("returns null for malformed data", () => {
    localStorage.setItem(STORAGE_KEY, "not valid json");
    expect(loadProject()).toBeNull();
  });

  it("save does not throw when localStorage throws", () => {
    const broken = mockStorage();
    broken.setItem = vi.fn(() => { throw new Error("quota"); });
    vi.stubGlobal("localStorage", broken);
    expect(() => saveProject(defaultProject())).not.toThrow();
  });

  it("migrates legacy projects missing registration on load", () => {
    // Simulate a project stored before registration was added: strip it out.
    const project = defaultProject();
    const legacy = JSON.parse(JSON.stringify(project)) as typeof project;
    for (const placement of legacy.tests) {
      delete (placement.test as Partial<typeof placement.test>).registration;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const loaded = loadProject();
    expect(loaded).not.toBeNull();
    expect(loaded!.tests.length).toBeGreaterThan(0);
    for (const placement of loaded!.tests) {
      expect(placement.test.registration).toEqual({ mode: "off", qr_mode: "inline" });
    }
  });

  it("leaves existing registration untouched on load", () => {
    const project = defaultProject();
    for (const placement of project.tests) {
      placement.test.registration = { mode: "full", qr_mode: "id_only" };
    }
    saveProject(project);
    const loaded = loadProject();
    expect(loaded).not.toBeNull();
    for (const placement of loaded!.tests) {
      expect(placement.test.registration).toEqual({ mode: "full", qr_mode: "id_only" });
    }
  });
});

describe("material_id migration", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
  });

  test("migrateProject coerces missing material_id to empty string", () => {
    const legacy = {
      name: "legacy",
      grid_gap_mm: 1,
      tests: [{
        test: {
          id: "t1", name: "Legacy",
          x_param: "speed", x_min: 100, x_max: 500, x_steps: 10,
          width_mm: 30, height_mm: 5, gap_mm: 0, rows: 1,
          base_params: {
            power: 14.6, speed: 1000, frequency: 125, density: 5000,
            passes: 1, pulse_width: 200, laser: "red",
          },
          crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
          registration: { mode: "off", qr_mode: "inline" },
        },
        row: 0, col: 0, col_span: 1,
      }],
    };
    localStorage.setItem("xcs-gen:project:v1", JSON.stringify(legacy));
    const loaded = loadProject();
    expect(loaded).not.toBeNull();
    // material_id flipped from `string | null` to required `string`. Legacy
    // null/missing becomes "" so the UI can prompt. App.tsx backfills from
    // library.active_material_id after load.
    expect(loaded!.tests[0].test.material_id).toBe("");
  });

  test("migrateProject coerces explicit null material_id to empty string", () => {
    const legacy = {
      name: "legacy",
      grid_gap_mm: 1,
      tests: [{
        test: {
          id: "t1", name: "Legacy",
          x_param: "speed", x_min: 100, x_max: 500, x_steps: 10,
          width_mm: 30, height_mm: 5, gap_mm: 0, rows: 1,
          base_params: {
            power: 14.6, speed: 1000, frequency: 125, density: 5000,
            passes: 1, pulse_width: 200, laser: "red",
          },
          crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
          registration: { mode: "off", qr_mode: "inline" },
          material_id: null,
        },
        row: 0, col: 0, col_span: 1,
      }],
    };
    localStorage.setItem("xcs-gen:project:v1", JSON.stringify(legacy));
    const loaded = loadProject();
    expect(loaded).not.toBeNull();
    expect(loaded!.tests[0].test.material_id).toBe("");
  });
});

import { loadLibrary, saveLibrary, LIBRARY_STORAGE_KEY } from "./storage";
import { bootstrapLibrary } from "./library";

describe("library persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("loadLibrary returns null when key missing", () => {
    expect(loadLibrary()).toBeNull();
  });

  test("saveLibrary + loadLibrary roundtrip", () => {
    const s = bootstrapLibrary();
    saveLibrary(s);
    const loaded = loadLibrary();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.materials).toHaveLength(1);
    expect(loaded!.materials[0].name).toBe("Stainless Steel");
  });

  test("loadLibrary returns null on malformed JSON", () => {
    localStorage.setItem(LIBRARY_STORAGE_KEY, "not-json");
    expect(loadLibrary()).toBeNull();
  });

  test("loadLibrary returns null when state is missing required fields", () => {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ version: 1 }));
    expect(loadLibrary()).toBeNull();
  });
});
