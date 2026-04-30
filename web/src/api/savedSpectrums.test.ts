import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listSpectrums,
  getSpectrum,
  createSpectrum,
  patchSpectrum,
  deleteSpectrum,
} from "./savedSpectrums";

const FIXTURE = {
  id: 1, name: "spec",
  source_test_id: 5, machine_id: "F2Ultra", material_id: 2, owner_id: 0,
  axis_param: "speed", axis_min: 1000, axis_max: 3000,
  fit_form: "polynomial", fit_degree: 2,
  fit_coefficients: { l: [0, 0, 0], a: [0, 0, 0], b: [0, 0, 0] },
  fit_r2: { l: 0.99, a: 0.95, b: 0.92 },
  fit_r2_min: 0.92,
  displayed_projection: "lightness",
  lab_l_min: 0, lab_l_max: 0, lab_a_min: 0, lab_a_max: 0,
  lab_b_min: 0, lab_b_max: 0,
  lab_l_centroid: 0, lab_a_centroid: 0, lab_b_centroid: 0,
  swatches: [],
  created_at: "2026-04-30T00:00:00Z",
};

let captured: { url: string; init?: RequestInit } | null = null;

beforeEach(() => {
  captured = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    captured = { url, init };
    return new Response(JSON.stringify(FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("savedSpectrums API", () => {
  it("listSpectrums GETs /api/spectrums with optional filter params", async () => {
    await listSpectrums({ minR2: 0.9, materialId: 2 });
    expect(captured!.url).toBe("/api/spectrums?min_r2=0.9&material_id=2");
    expect(captured!.init?.method ?? "GET").toBe("GET");
  });

  it("listSpectrums omits empty params", async () => {
    await listSpectrums();
    expect(captured!.url).toBe("/api/spectrums");
  });

  it("getSpectrum GETs /api/spectrums/:id", async () => {
    await getSpectrum(7);
    expect(captured!.url).toBe("/api/spectrums/7");
  });

  it("createSpectrum POSTs JSON", async () => {
    const body = {
      name: "x", source_test_id: 1,
      axis_param: "speed", axis_min: 0, axis_max: 1,
      fit_form: "polynomial" as const, fit_degree: 2 as const,
      fit_coefficients: { l: [0, 0, 0], a: [0, 0, 0], b: [0, 0, 0] },
      fit_r2: { l: 1, a: 1, b: 1 },
      displayed_projection: "lightness",
      swatches: [],
    };
    await createSpectrum(body);
    expect(captured!.url).toBe("/api/spectrums");
    expect(captured!.init?.method).toBe("POST");
    expect((captured!.init?.headers as Record<string, string>)["Content-Type"])
      .toBe("application/json");
    expect(JSON.parse(captured!.init?.body as string).name).toBe("x");
  });

  it("patchSpectrum PATCHes /api/spectrums/:id", async () => {
    await patchSpectrum(7, { name: "renamed" });
    expect(captured!.url).toBe("/api/spectrums/7");
    expect(captured!.init?.method).toBe("PATCH");
    expect(JSON.parse(captured!.init?.body as string).name).toBe("renamed");
  });

  it("deleteSpectrum DELETEs /api/spectrums/:id", async () => {
    await deleteSpectrum(7);
    expect(captured!.url).toBe("/api/spectrums/7");
    expect(captured!.init?.method).toBe("DELETE");
  });
});
