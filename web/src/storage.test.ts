import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
