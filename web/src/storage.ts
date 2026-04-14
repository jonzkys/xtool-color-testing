import type { Project } from "./types";

export const STORAGE_KEY = "xcs-gen:project:v1";

export function loadProject(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Project;
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
