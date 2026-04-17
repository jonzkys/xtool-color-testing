import type { Project, RegistrationConfig } from "./types";
import type { LibraryState } from "./library";

export const STORAGE_KEY = "xcs-gen:project:v1";

const DEFAULT_REGISTRATION: RegistrationConfig = { mode: "off", qr_mode: "inline" };

/**
 * Migrates a parsed project from an older schema version into the current shape.
 * Keeps projects already matching the current schema unchanged (idempotent).
 *
 * Currently handles:
 *  - Task 5 added `registration: RegistrationConfig` to `ParamTest`. Older
 *    stored projects lack this field; backfill it with a safe "off" default.
 */
export function migrateProject(project: Project): Project {
  if (project && Array.isArray(project.tests)) {
    for (const placement of project.tests) {
      if (placement && placement.test && placement.test.registration === undefined) {
        placement.test.registration = { ...DEFAULT_REGISTRATION };
      }
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
