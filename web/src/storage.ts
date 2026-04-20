import type { Project, RegistrationConfig } from "./types";
import type { LibraryState } from "./library";

export const STORAGE_KEY = "xcs-gen:project:v1";

const DEFAULT_REGISTRATION: RegistrationConfig = {
  mode: "off", qr_mode: "inline", qr_position: "top-left", qr_size_mm: null,
};

/**
 * Migrates a parsed project from an older schema version into the current shape.
 * Keeps projects already matching the current schema unchanged (idempotent).
 *
 * Handles:
 *  - registration: added as a required field; backfill "off" when absent.
 *  - material_id: used to be `string | null`; is now required. Coerce null /
 *    undefined / empty to "" so the UI can prompt for a real value.
 */
export function migrateProject(project: Project): Project {
  if (project && Array.isArray(project.tests)) {
    for (const placement of project.tests) {
      if (placement && placement.test) {
        if (placement.test.registration === undefined) {
          placement.test.registration = { ...DEFAULT_REGISTRATION };
        } else {
          // Backfill fields added after the original shipped.
          const reg = placement.test.registration;
          if (reg.qr_position === undefined) reg.qr_position = "top-left";
          if (reg.qr_size_mm === undefined) reg.qr_size_mm = null;
        }
        if (
          placement.test.material_id === undefined
          || placement.test.material_id === null
        ) {
          placement.test.material_id = "";
        }
      }
    }
  }
  return project;
}

/**
 * Fill any empty `material_id` on tests with the library's active material.
 * Called after project + library are both loaded so the two stores stay
 * consistent. Returns the same project object (mutates in place) for callers.
 */
export function backfillProjectMaterialIds(
  project: Project, library: LibraryState,
): Project {
  if (!library.active_material_id) return project;
  for (const placement of project.tests) {
    if (!placement.test.material_id) {
      placement.test.material_id = library.active_material_id;
    }
  }
  return project;
}

export function loadProject(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Project;
    return migrateProject(parsed);
  } catch {
    return null;
  }
}

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // Silently ignore (quota exceeded, disabled, etc.). State is lost on reload.
  }
}

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
