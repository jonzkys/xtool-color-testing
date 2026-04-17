# Library: Materials + Parameter Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-local library of materials and parameter presets, with a management page and a reusable material+preset picker integrated into all three param-editing forms.

**Architecture:** Pure-frontend state in a new localStorage key (`xcs-gen:library:v1`), managed through pure-function mutation helpers that feed `useState` in `App.tsx`. Forms get a shared `MaterialPresetPicker` component that writes through to their existing `base_params` via an explicit Apply. Tests, SVG stacks, and SVG layers all gain a `material_id: string | null` field for provenance; legacy data backfills to `null`.

**Tech Stack:** TypeScript (React, Vite, vitest), Python (FastAPI, Pydantic). No new runtime dependencies.

**Design doc:** `docs/superpowers/specs/2026-04-21-library-materials-presets-design.md`

---

## Preamble

Executes on `main` against the current head. No worktree requested.

## Task ordering rationale

Tasks 1–3 build the data layer and schema updates with no user-visible UI. Task 4 exposes the Library tab (users can add/edit materials and presets but can't yet apply them to forms). Task 5 adds the reusable picker as an isolated component. Tasks 6–8 integrate the picker into each of the three forms. This order keeps each commit deployable without leaving a broken interim state.

---

### Task 1: Library types + pure mutation helpers

**Files:**
- Create: `web/src/library.ts`
- Create: `web/src/library.test.ts`

- [ ] **Step 1: Write failing tests**

Create `web/src/library.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npm test -- --run library.test.ts`
Expected: all tests fail with module-not-found or import errors.

- [ ] **Step 3: Implement library.ts**

Create `web/src/library.ts`:

```typescript
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
  // Fallback: timestamp + random
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
  // If we deleted the default for a material, promote the first remaining one.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- --run library.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/library.ts web/src/library.test.ts
git commit -m "Add library state + pure mutation helpers (materials and presets)"
```

---

### Task 2: Library persistence (localStorage)

**Files:**
- Modify: `web/src/storage.ts`
- Modify: `web/src/storage.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `web/src/storage.test.ts`:

```typescript
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
```

At the top of the file, extend the existing imports to include `beforeEach` if not already imported. If the existing test file uses `test`/`expect` only, add `beforeEach`:

```typescript
import { describe, test, expect, beforeEach } from "vitest";
```

(Check the existing top-of-file imports; only add `beforeEach` if it's absent.)

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npm test -- --run storage.test.ts`
Expected: new tests fail (loadLibrary/saveLibrary/LIBRARY_STORAGE_KEY not exported).

- [ ] **Step 3: Extend storage.ts**

Modify `web/src/storage.ts`. Add these imports at the top:

```typescript
import type { LibraryState } from "./library";
```

Append to the end of the file:

```typescript
export const LIBRARY_STORAGE_KEY = "xcs-gen:library:v1";

function isValidLibrary(obj: unknown): obj is LibraryState {
  if (!obj || typeof obj !== "object") return false;
  const s = obj as Partial<LibraryState>;
  return (
    s.version === 1 &&
    typeof s.active_material_id === "string" &&
    Array.isArray(s.materials) &&
    Array.isArray(s.presets)
  );
}

export function loadLibrary(): LibraryState | null {
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidLibrary(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLibrary(state: LibraryState): void {
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Silently ignore.
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npm test -- --run storage.test.ts`
Expected: all tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add web/src/storage.ts web/src/storage.test.ts
git commit -m "Add library load/save with malformed-state guards"
```

---

### Task 3: Add `material_id` to ParamTest, SvgStackRequest, LayerSpec (pydantic + TS + migration)

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Modify: `web/src/types.ts`
- Modify: `web/src/defaults.ts`
- Modify: `web/src/components/SvgStackPage.tsx` (defaultRequest)
- Modify: `web/src/components/SvgLayersPage.tsx` (default layer state)
- Modify: `web/src/storage.ts` (extend migrateProject)
- Modify: `web/src/storage.test.ts`
- Modify: `tests/test_api.py`
- Modify: `tests/test_svg_layers_api.py` (if its fixture builds LayerSpec objects)

- [ ] **Step 1: Write failing tests (python + TS)**

Append to `tests/test_api.py`:

```python
def test_generate_accepts_material_id(client):
    payload = _project_payload()
    payload["tests"][0]["test"]["material_id"] = "mat-abc123"
    resp = client.post("/api/generate", json=payload)
    assert resp.status_code == 200


def test_generate_accepts_null_material_id(client):
    payload = _project_payload()
    payload["tests"][0]["test"]["material_id"] = None
    resp = client.post("/api/generate", json=payload)
    assert resp.status_code == 200
```

Append to `web/src/storage.test.ts`:

```typescript
test("migrateProject backfills material_id: null on legacy tests", () => {
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
  expect(loaded!.tests[0].test.material_id).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_api.py::test_generate_accepts_material_id -v`
Run: `cd web && npm test -- --run storage.test.ts`
Expected: both fail (field rejected by pydantic; `material_id` missing after load).

- [ ] **Step 3: Update pydantic schemas**

Modify `src/xcs_gen_web/schemas.py`. Add `material_id` to three models.

Inside `ParamTest`, add this field immediately after `registration: RegistrationConfig = ...`:

```python
    material_id: str | None = None
```

Inside `SvgStackRequest`, add (before `subtract_overlaps`):

```python
    material_id: str | None = None
```

Inside `LayerSpec`, add (before `hatch_passes`):

```python
    material_id: str | None = None
```

- [ ] **Step 4: Update TypeScript types**

Modify `web/src/types.ts`. Extend `ParamTest` by adding `material_id: string | null;` at the end (before the closing brace).

Extend `SvgStackRequest` by adding `material_id: string | null;` before `subtract_overlaps`.

Extend `LayerSpec` by adding `material_id: string | null;` before `hatch_passes`.

- [ ] **Step 5: Update defaults**

Modify `web/src/defaults.ts`. In `defaultTest()`, add this line after the `registration` line:

```typescript
    material_id: null,
```

Modify `web/src/components/SvgStackPage.tsx`. In `defaultRequest()`, add `material_id: null,` before `subtract_overlaps`.

Modify `web/src/components/SvgLayersPage.tsx`. Find where `LayerSpec` objects are constructed (likely a `defaultLayerFor(color)` helper or an inline `{ color, name, ... }` literal). Add `material_id: null,` before `hatch_passes`. If multiple construction sites exist, update all.

- [ ] **Step 6: Extend migrateProject**

Modify `web/src/storage.ts`. Update the `migrateProject` function body:

```typescript
export function migrateProject(project: Project): Project {
  if (project && Array.isArray(project.tests)) {
    for (const placement of project.tests) {
      if (placement && placement.test) {
        if (placement.test.registration === undefined) {
          placement.test.registration = { ...DEFAULT_REGISTRATION };
        }
        if (placement.test.material_id === undefined) {
          placement.test.material_id = null;
        }
      }
    }
  }
  return project;
}
```

- [ ] **Step 7: Run tests**

Run: `pytest tests/ -x -q`
Expected: all pass (including the two new `/api/generate` tests).

Run: `cd web && npm test -- --run`
Expected: all pass.

Run: `cd web && npm run build`
Expected: clean TS build.

- [ ] **Step 8: Commit**

```bash
git add src/xcs_gen_web/schemas.py web/src/types.ts web/src/defaults.ts web/src/components/SvgStackPage.tsx web/src/components/SvgLayersPage.tsx web/src/storage.ts web/src/storage.test.ts tests/test_api.py
git commit -m "Add material_id field to ParamTest, SvgStackRequest, LayerSpec"
```

---

### Task 4: Library page + TopBar tab + App wiring

**Files:**
- Create: `web/src/components/LibraryPage.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/TopBar.tsx`

- [ ] **Step 1: Create LibraryPage**

Create `web/src/components/LibraryPage.tsx`:

```tsx
import { useState } from "react";
import { defaultBaseParams } from "../defaults";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import type { LibraryState, Material, Preset } from "../library";
import {
  addMaterial, addPreset, deleteMaterial, deletePreset,
  renameMaterial, setActiveMaterial, setDefaultPreset, updatePreset,
} from "../library";

interface Props {
  library: LibraryState;
  onChange: (next: LibraryState) => void;
}

export function LibraryPage({ library, onChange }: Props) {
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(
    library.active_material_id || library.materials[0]?.id || "",
  );
  const selectedMaterial = library.materials.find((m) => m.id === selectedMaterialId);
  const presets = library.presets.filter((p) => p.material_id === selectedMaterialId);

  function onAddMaterial() {
    const name = prompt("Material name?", "Untitled material");
    if (!name) return;
    const next = addMaterial(library, name);
    onChange(next);
    setSelectedMaterialId(next.materials[next.materials.length - 1].id);
  }

  function onDeleteMaterial(id: string) {
    const m = library.materials.find((mm) => mm.id === id);
    if (!m) return;
    const hasPresets = library.presets.some((p) => p.material_id === id);
    if (hasPresets) {
      alert(`Cannot delete "${m.name}" — delete its presets first.`);
      return;
    }
    if (!confirm(`Delete material "${m.name}"?`)) return;
    const next = deleteMaterial(library, id);
    onChange(next);
    if (selectedMaterialId === id) {
      setSelectedMaterialId(next.materials[0]?.id ?? "");
    }
  }

  function onRenameMaterial(id: string) {
    const m = library.materials.find((mm) => mm.id === id);
    if (!m) return;
    const name = prompt("New name?", m.name);
    if (!name || name === m.name) return;
    onChange(renameMaterial(library, id, name));
  }

  function onSetActive(id: string) {
    onChange(setActiveMaterial(library, id));
  }

  function onAddPreset() {
    if (!selectedMaterial) return;
    const existingDefault = library.presets.find(
      (p) => p.material_id === selectedMaterial.id && p.is_default,
    );
    const seed = existingDefault ? existingDefault.base_params : defaultBaseParams();
    const next = addPreset(library, selectedMaterial.id, {
      name: "Untitled preset",
      base_params: { ...seed },
    });
    onChange(next);
  }

  function onUpdatePreset(id: string, patch: Partial<Pick<Preset, "name" | "color" | "base_params">>) {
    onChange(updatePreset(library, id, patch));
  }

  function onDeletePreset(id: string) {
    const p = library.presets.find((pp) => pp.id === id);
    if (!p) return;
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    onChange(deletePreset(library, id));
  }

  function onSetDefault(id: string) {
    onChange(setDefaultPreset(library, id));
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: "100%", minHeight: 0 }}>
      <div style={{ borderRight: "1px solid #ddd", background: "white", overflow: "auto", padding: 12 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
          Materials
        </div>
        {library.materials.map((m) => {
          const presetCount = library.presets.filter((p) => p.material_id === m.id).length;
          const isActive = m.id === library.active_material_id;
          const isSelected = m.id === selectedMaterialId;
          return (
            <div
              key={m.id}
              onClick={() => setSelectedMaterialId(m.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px", marginBottom: 4, borderRadius: 4,
                cursor: "pointer",
                background: isSelected ? "#e8ecf3" : "transparent",
                border: "1px solid " + (isSelected ? "#336" : "transparent"),
              }}
            >
              <div style={{ flex: 1, fontSize: 13 }}>
                {m.name} {isActive && <span style={{ color: "#206030", fontSize: 10 }}>(active)</span>}
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>{presetCount}</div>
              <button
                onClick={(e) => { e.stopPropagation(); onRenameMaterial(m.id); }}
                style={{ fontSize: 10, padding: "2px 4px", border: "1px solid #ddd", background: "white", borderRadius: 3, cursor: "pointer" }}
              >
                rename
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onSetActive(m.id); }}
                disabled={isActive}
                style={{ fontSize: 10, padding: "2px 4px", border: "1px solid #ddd", background: "white", borderRadius: 3, cursor: isActive ? "default" : "pointer", opacity: isActive ? 0.5 : 1 }}
              >
                set active
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteMaterial(m.id); }}
                style={{ fontSize: 10, padding: "2px 4px", border: "1px solid #ddd", background: "white", borderRadius: 3, cursor: "pointer", color: "#a02840" }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          onClick={onAddMaterial}
          style={{ marginTop: 8, width: "100%", padding: "6px", background: "#e8ecf3", border: "1px dashed #336", borderRadius: 4, color: "#336", cursor: "pointer" }}
        >
          + New material
        </button>
      </div>

      <div style={{ padding: 16, overflow: "auto" }}>
        {selectedMaterial ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>{selectedMaterial.name}</h2>
              <button
                onClick={onAddPreset}
                style={{ padding: "6px 12px", background: "#336", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                + New preset
              </button>
            </div>
            {presets.length === 0 ? (
              <div style={{ color: "#888" }}>No presets yet. Click "+ New preset" to add one.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                {presets.map((p) => (
                  <PresetCard
                    key={p.id}
                    preset={p}
                    onPatch={(patch) => onUpdatePreset(p.id, patch)}
                    onSetDefault={() => onSetDefault(p.id)}
                    onDelete={() => onDeletePreset(p.id)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#888" }}>Select a material on the left, or add a new one.</div>
        )}
      </div>
    </div>
  );
}

function PresetCard({
  preset, onPatch, onSetDefault, onDelete,
}: {
  preset: Preset;
  onPatch: (patch: Partial<Pick<Preset, "name" | "color" | "base_params">>) => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, background: "white" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          value={preset.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          style={{ flex: 1, padding: "4px 6px", fontSize: 14, fontWeight: 600, border: "1px solid transparent", borderRadius: 3 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          <input
            type="radio"
            checked={preset.is_default}
            onChange={onSetDefault}
          />
          default
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <input
          type="color"
          value={preset.color ?? "#888888"}
          onChange={(e) => onPatch({ color: e.target.value })}
          style={{ width: 32, height: 28, border: "1px solid #ccc", borderRadius: 3 }}
        />
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#555" }}>
          {preset.color ?? "(none)"}
        </div>
        {preset.color && (
          <button
            onClick={() => onPatch({ color: undefined })}
            style={{ fontSize: 10, padding: "2px 4px", border: "1px solid #ddd", background: "white", borderRadius: 3, cursor: "pointer" }}
          >
            clear
          </button>
        )}
      </div>
      <NumberField label="Power %" value={preset.base_params.power} onChange={(v) => onPatch({ base_params: { ...preset.base_params, power: v } })} />
      <NumberField label="Speed" value={preset.base_params.speed} integer onChange={(v) => onPatch({ base_params: { ...preset.base_params, speed: v } })} />
      <NumberField label="Frequency" value={preset.base_params.frequency} integer onChange={(v) => onPatch({ base_params: { ...preset.base_params, frequency: v } })} />
      <NumberField label="Lines/cm" value={preset.base_params.density} integer onChange={(v) => onPatch({ base_params: { ...preset.base_params, density: v } })} />
      <NumberField label="Passes" value={preset.base_params.passes} integer min={1} onChange={(v) => onPatch({ base_params: { ...preset.base_params, passes: v } })} />
      <NumberField label="Pulse width" value={preset.base_params.pulse_width} integer onChange={(v) => onPatch({ base_params: { ...preset.base_params, pulse_width: v } })} />
      <SelectField
        label="Laser"
        value={preset.base_params.laser}
        options={[{ value: "red", label: "Red (MOPA)" }, { value: "blue", label: "Blue (diode)" }]}
        onChange={(v) => onPatch({ base_params: { ...preset.base_params, laser: v as "red" | "blue" } })}
      />
      <div style={{ marginTop: 8, textAlign: "right" }}>
        <button
          onClick={onDelete}
          style={{ fontSize: 11, padding: "4px 8px", border: "1px solid #ddd", background: "white", borderRadius: 3, color: "#a02840", cursor: "pointer" }}
        >
          Delete preset
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Library tab to TopBar**

Modify `web/src/components/TopBar.tsx`.

Extend the `Tab` type:

```typescript
type Tab = "tests" | "svg" | "layers" | "library";
```

In the tabs section, add a button before the existing "SVG layers" or after it — place it last:

```tsx
<TabButton active={tab === "library"} onClick={() => onTabChange("library")}>Library</TabButton>
```

- [ ] **Step 3: Wire library state in App**

Modify `web/src/App.tsx`. At the top, add imports:

```typescript
import { LibraryPage } from "./components/LibraryPage";
import { bootstrapLibrary, type LibraryState } from "./library";
import { loadLibrary, saveLibrary } from "./storage";
```

Extend the `Tab` type alias:

```typescript
type Tab = "tests" | "svg" | "layers" | "library";
```

Add library state alongside the existing project state:

```typescript
  const [library, setLibrary] = useState<LibraryState>(() => loadLibrary() ?? bootstrapLibrary());
  useEffect(() => { saveLibrary(library); }, [library]);
```

Update the TopBar `title` prop ternary to include library:

```tsx
title={
  tab === "tests" ? project.name
  : tab === "svg" ? "SVG stack"
  : tab === "layers" ? "SVG layers"
  : "Library"
}
```

Find the existing tab-rendering block (the ternary after `{tab === "tests" ? (...) : tab === "svg" ? (...) : (...)}`). Extend it with a `library` case. Example structure after edits:

```tsx
{tab === "tests" ? (
  /* existing tests pane */
) : tab === "svg" ? (
  <div style={{ flex: 1, minHeight: 0 }}><SvgStackPage /></div>
) : tab === "layers" ? (
  <div style={{ flex: 1, minHeight: 0 }}><SvgLayersPage /></div>
) : (
  <div style={{ flex: 1, minHeight: 0 }}><LibraryPage library={library} onChange={setLibrary} /></div>
)}
```

- [ ] **Step 4: Build + run existing tests**

Run: `cd web && npm run build`
Expected: clean build.

Run: `cd web && npm test -- --run`
Expected: all tests still pass.

- [ ] **Step 5: Smoke-test manually**

Run: `xcs-gen serve --no-browser &` (or use an already-running instance).

Open the app, click the Library tab. Verify:
- Stainless Steel material appears on the left (first load triggers bootstrap)
- Click it → right pane shows "Default" preset card with the seeded values
- Click "+ New preset" → a second preset appears under Stainless Steel
- Click "+ New material" → prompt appears; add "Anodised"; it appears on the left
- Click "Anodised" → right pane is empty with "+ New preset" CTA
- Edit a preset's power value → reload the page → edit persists
- Delete the Anodised material via its × → it disappears

- [ ] **Step 6: Commit**

```bash
git add web/src/components/LibraryPage.tsx web/src/components/TopBar.tsx web/src/App.tsx
git commit -m "Add Library tab with material + preset CRUD"
```

---

### Task 5: MaterialPresetPicker reusable component

**Files:**
- Create: `web/src/components/MaterialPresetPicker.tsx`

- [ ] **Step 1: Create the component**

Create `web/src/components/MaterialPresetPicker.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { LibraryState, Preset } from "../library";

interface Props {
  library: LibraryState;
  materialId: string | null;
  baseParams: Preset["base_params"];
  onApply: (materialId: string, baseParams: Preset["base_params"]) => void;
}

/**
 * Material + preset dropdown with explicit Apply button.
 *
 * Shows a status indicator:
 *  - ✓ Applied  — when baseParams exactly matches the last-applied preset
 *  - Modified   — when the user has edited base_params since applying
 *  - (nothing)  — when no preset has been applied in this session yet
 */
export function MaterialPresetPicker({ library, materialId, baseParams, onApply }: Props) {
  const effectiveMaterialId = materialId ?? library.active_material_id ?? library.materials[0]?.id ?? "";
  const [dropdownMaterialId, setDropdownMaterialId] = useState<string>(effectiveMaterialId);

  const presetsForDropdown = library.presets.filter((p) => p.material_id === dropdownMaterialId);
  const defaultPreset = presetsForDropdown.find((p) => p.is_default) ?? presetsForDropdown[0];

  const [dropdownPresetId, setDropdownPresetId] = useState<string>(defaultPreset?.id ?? "");
  const [lastAppliedId, setLastAppliedId] = useState<string | null>(null);
  const [lastAppliedParams, setLastAppliedParams] = useState<Preset["base_params"] | null>(null);

  // Reset preset dropdown to the material's default when the material changes.
  useEffect(() => {
    const dflt = library.presets.find((p) => p.material_id === dropdownMaterialId && p.is_default)
               ?? library.presets.find((p) => p.material_id === dropdownMaterialId);
    setDropdownPresetId(dflt?.id ?? "");
  }, [dropdownMaterialId, library.presets]);

  const selectedPreset = presetsForDropdown.find((p) => p.id === dropdownPresetId);

  function doApply() {
    if (!selectedPreset) return;
    onApply(selectedPreset.material_id, { ...selectedPreset.base_params });
    setLastAppliedId(selectedPreset.id);
    setLastAppliedParams({ ...selectedPreset.base_params });
  }

  const status = (() => {
    if (!lastAppliedId || !lastAppliedParams) return "";
    const matches = Object.keys(lastAppliedParams).every(
      (k) => (lastAppliedParams as any)[k] === (baseParams as any)[k],
    );
    return matches ? "applied" : "modified";
  })();

  if (library.materials.length === 0) {
    return (
      <div style={{ padding: 8, border: "1px dashed #ccc", borderRadius: 4, fontSize: 12, color: "#888" }}>
        No library yet — set up in Library tab.
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 10, marginBottom: 12, background: "#fafafa" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Material</span>
          <select
            value={dropdownMaterialId}
            onChange={(e) => setDropdownMaterialId(e.target.value)}
            style={{ padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
          >
            {library.materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Preset</span>
          <select
            value={dropdownPresetId}
            onChange={(e) => setDropdownPresetId(e.target.value)}
            disabled={presetsForDropdown.length === 0}
            style={{ padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
          >
            {presetsForDropdown.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.is_default ? " (default)" : ""}
              </option>
            ))}
            {presetsForDropdown.length === 0 && <option>No presets</option>}
          </select>
        </label>
        <button
          onClick={doApply}
          disabled={!selectedPreset}
          style={{ padding: "4px 10px", background: "#336", color: "white", border: "none", borderRadius: 4, cursor: selectedPreset ? "pointer" : "default", opacity: selectedPreset ? 1 : 0.5 }}
        >
          Apply
        </button>
        {status === "applied" && <span style={{ fontSize: 11, color: "#206030" }}>✓ Applied</span>}
        {status === "modified" && <span style={{ fontSize: 11, color: "#a05000" }}>Modified</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + type-check**

Run: `cd web && npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/MaterialPresetPicker.tsx
git commit -m "Add reusable MaterialPresetPicker component"
```

---

### Task 6: Integrate picker into TestEditor + new-test inheritance

**Files:**
- Modify: `web/src/components/TestEditor.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add picker to TestEditor**

Modify `web/src/components/TestEditor.tsx`.

Extend imports:

```tsx
import type { LibraryState } from "../library";
import { MaterialPresetPicker } from "./MaterialPresetPicker";
```

Extend Props:

```typescript
interface Props {
  placement: TestPlacement;
  issues: ValidationIssue[];
  library: LibraryState;
  onChange: (next: TestPlacement) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}
```

Extend the function signature destructuring:

```tsx
export function TestEditor({ placement, issues, library, onChange, onDelete, onDuplicate }: Props) {
```

Add the picker immediately BEFORE the existing `<Section title="Base parameters (fixed)">`:

```tsx
      <MaterialPresetPicker
        library={library}
        materialId={t.material_id}
        baseParams={t.base_params}
        onApply={(materialId, baseParams) => {
          onChange({
            ...placement,
            test: { ...t, material_id: materialId, base_params: { ...baseParams } },
          });
        }}
      />
```

- [ ] **Step 2: Pass library down from App**

Modify `web/src/App.tsx`. Find the `<TestEditor ... />` invocation and add the `library` prop:

```tsx
<TestEditor
  placement={selected}
  issues={issues}
  library={library}
  onChange={updatePlacement}
  onDelete={deleteSelected}
  onDuplicate={duplicateSelected}
/>
```

- [ ] **Step 3: Inherit material on new tests**

Still in `App.tsx`, find the `addTest()` function. Modify it to inherit from the most recent test's `material_id` (and auto-apply its material's default preset's base_params):

```typescript
  function addTest() {
    const usedRows = new Set(project.tests.map((p) => p.row));
    let row = 0;
    while (usedRows.has(row)) row += 1;
    const placement = defaultPlacement(row, 0);

    // Inherit material_id from the most recent test (or library active material).
    const lastTest = project.tests[project.tests.length - 1]?.test;
    const inheritedMaterialId = lastTest?.material_id ?? library.active_material_id;
    if (inheritedMaterialId) {
      placement.test.material_id = inheritedMaterialId;
      const defaultPreset = library.presets.find(
        (p) => p.material_id === inheritedMaterialId && p.is_default,
      );
      if (defaultPreset) {
        placement.test.base_params = { ...defaultPreset.base_params };
      }
    }

    setProject((prev) => ({ ...prev, tests: [...prev.tests, placement] }));
    setSelectedId(placement.test.id);
  }
```

- [ ] **Step 4: Build + manual smoke test**

Run: `cd web && npm run build`
Expected: clean.

Run: `cd web && npm test -- --run`
Expected: all tests pass.

Manual smoke test:
1. Open Library tab; add a material "Brass" with a preset "Medium brass" (power 60, speed 500).
2. Switch to Param tests. On an existing test, the picker shows Stainless Steel / Default (or inherited material). Pick Brass / Medium brass → Apply. Verify power and speed fields update to 60 / 500.
3. Click "+ Add test" — the new test should inherit material=Brass, base_params = Medium brass values.
4. Edit a field manually → picker shows "Modified" instead of "✓ Applied".

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TestEditor.tsx web/src/App.tsx
git commit -m "Integrate MaterialPresetPicker into TestEditor; inherit material on new tests"
```

---

### Task 7: Integrate picker into SvgStackPage

**Files:**
- Modify: `web/src/components/SvgStackPage.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add library prop to SvgStackPage**

Modify `web/src/components/SvgStackPage.tsx`. At the top, extend imports:

```tsx
import type { LibraryState } from "../library";
import { MaterialPresetPicker } from "./MaterialPresetPicker";
```

Add Props interface and update the function signature:

```tsx
interface Props {
  library: LibraryState;
}

export function SvgStackPage({ library }: Props) {
```

In `defaultRequest()`, set `material_id` to the library's active material:

```tsx
function defaultRequest(library: LibraryState): SvgStackRequest {
  const defaultPreset = library.presets.find(
    (p) => p.material_id === library.active_material_id && p.is_default,
  );
  const base = defaultPreset ? { ...defaultPreset.base_params } : defaultBaseParams();
  return {
    name: "svg-stack",
    svg_content: "",
    width_mm: 50,
    height_mm: null,
    start_x: 10,
    start_y: 10,
    base_params: base,
    processing_type: "COLOR_FILL_ENGRAVE",
    scan_angle: 90,
    stack_passes: 2,
    stack_step_deg: 90,
    material_id: library.active_material_id ?? null,
    subtract_overlaps: false,
  };
}
```

Update the `useState` initializer:

```tsx
  const [request, setRequest] = useState<SvgStackRequest>(() => defaultRequest(library));
```

Add the picker above the existing base_params section. Find where base_params fields are rendered (look for `<NumberField label="Power %" ...>`), and insert immediately before that block:

```tsx
<MaterialPresetPicker
  library={library}
  materialId={request.material_id}
  baseParams={request.base_params}
  onApply={(materialId, baseParams) => {
    setRequest((prev) => ({ ...prev, material_id: materialId, base_params: { ...baseParams } }));
  }}
/>
```

- [ ] **Step 2: Pass library from App**

Modify `web/src/App.tsx`. Find the `<SvgStackPage />` invocation and pass library:

```tsx
<SvgStackPage library={library} />
```

- [ ] **Step 3: Build + smoke test**

Run: `cd web && npm run build`
Expected: clean.

Manual smoke test:
1. Switch to SVG stack tab. Picker shows active material + its default preset; base_params prefilled from that preset.
2. Pick a different preset → Apply → base_params update.
3. Upload an SVG and generate (verify no schema errors on the wire).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SvgStackPage.tsx web/src/App.tsx
git commit -m "Integrate MaterialPresetPicker into SvgStackPage"
```

---

### Task 8: Integrate picker into SvgLayersPage (per layer)

**Files:**
- Modify: `web/src/components/SvgLayersPage.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add library prop to SvgLayersPage**

Modify `web/src/components/SvgLayersPage.tsx`. Extend imports:

```tsx
import type { LibraryState } from "../library";
import { MaterialPresetPicker } from "./MaterialPresetPicker";
```

Add Props interface and update the signature:

```tsx
interface Props {
  library: LibraryState;
}

export function SvgLayersPage({ library }: Props) {
```

Find where new `LayerSpec` objects are constructed for newly-detected colors. Run this to locate the construction sites:

```bash
grep -n "base_params" web/src/components/SvgLayersPage.tsx
```

The call sites that build a fresh LayerSpec (typically when the user uploads an SVG and each detected color becomes a layer) need updating. Each per-color LayerSpec construction currently calls `defaultBaseParams()` or reuses previous values. Replace with library-aware seeding. For each occurrence, replace the hard-coded `defaultBaseParams()` call with library-aware values. Add a helper near the top of the component:

```tsx
function seedLayerBaseParams(library: LibraryState) {
  const defaultPreset = library.presets.find(
    (p) => p.material_id === library.active_material_id && p.is_default,
  );
  return defaultPreset
    ? { materialId: library.active_material_id, baseParams: { ...defaultPreset.base_params } }
    : { materialId: null, baseParams: defaultBaseParams() };
}
```

Use it when constructing a new LayerSpec:

```tsx
const seed = seedLayerBaseParams(library);
const newLayer: LayerSpec = {
  // ...existing fields...
  base_params: seed.baseParams,
  material_id: seed.materialId,
  // ...rest...
};
```

Apply this change wherever the file builds a LayerSpec from a newly-detected color.

Find the per-layer editor block (where each layer's base_params fields are rendered — look for per-layer `<NumberField label="Power" ...>`). Add the picker above that block:

```tsx
<MaterialPresetPicker
  library={library}
  materialId={layer.material_id}
  baseParams={layer.base_params}
  onApply={(materialId, baseParams) => {
    updateLayer(layer.color, { material_id: materialId, base_params: { ...baseParams } });
  }}
/>
```

Find the per-layer update function the file already defines — it's the callback that each layer's editor passes to update a single layer. Run this to locate it:

```bash
grep -n "setLayers\|updateLayer\|layers:" web/src/components/SvgLayersPage.tsx | head -20
```

Call whichever function the file uses to patch a single layer's fields. If there isn't a named helper (just inline `setLayers(prev => prev.map(...))`), wrap that pattern in the `onApply` callback directly.

- [ ] **Step 2: Pass library from App**

Modify `web/src/App.tsx`. Update the `<SvgLayersPage />` invocation:

```tsx
<SvgLayersPage library={library} />
```

- [ ] **Step 3: Build + smoke test**

Run: `cd web && npm run build`
Expected: clean.

Manual smoke test:
1. Switch to SVG layers tab. Upload a multi-color SVG.
2. Each layer's base_params are prefilled from the active material's default preset.
3. Per layer, pick a different preset → Apply → that layer's base_params update (others are unchanged).
4. Generate; verify no schema errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SvgLayersPage.tsx web/src/App.tsx
git commit -m "Integrate MaterialPresetPicker into SvgLayersPage (per layer)"
```

---

## Post-implementation

- [ ] End-to-end manual verification

1. Fresh browser (clear localStorage), load app. Library tab shows bootstrap Stainless Steel + Default preset.
2. Add material "Brass"; add preset "Medium brass" (custom values); set as default.
3. Param tests tab: create a new test. It inherits material=Stainless, base_params from Stainless default. Pick Brass/Medium brass → Apply → values update. Add a second test → inherits Brass (last-test inheritance).
4. SVG stack: upload, picker prefilled from active material, change + apply works.
5. SVG layers: upload multi-color SVG, each layer starts with active material, per-layer apply works in isolation.
6. Delete Brass (after deleting its presets). Active material should reassign to Stainless. Existing tests with material_id=Brass retain their stamped id but now show the material as missing — acceptable per design (v1).
7. Reload browser → library state persists.

- [ ] Run full test suite

Run: `pytest tests/ -x -q && cd web && npm test -- --run && npm run build`
Expected: all green; clean build.

---

## Spec coverage check

- Section 1 (Data model): Task 1 (types + helpers), Task 2 (persistence), Task 3 (schema + migration) ✓
- Section 2 (Library management page): Task 4 ✓
- Section 3 (Form integration): Tasks 5–8 ✓
- Section 4 (State management): Task 4 (App wiring) ✓
- Section 5 (Palette-ingest tie-in): documented — lands inside Tasks 10 & 13 of the prior palette plan when that work resumes. Not implemented in this plan.
- Section 6 (Scope): deferred items not implemented; this plan is v1 exactly ✓
- Section 7 (Risks): documented in spec only; no implementation needed
