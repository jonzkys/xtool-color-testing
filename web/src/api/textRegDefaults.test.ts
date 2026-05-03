import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveTextRegDefaults,
  getMachineTextRegDefault,
  putMachineTextRegDefault,
  deleteMachineTextRegDefault,
  listMaterialTextRegDefaults,
  putMaterialTextRegDefault,
  deleteMaterialTextRegDefault,
} from "./textRegDefaults";

const PARAMS = {
  speed: 5000,
  power: 80,
  density: 200,
  repeat: 1,
  pulse_width: 80,
  mopa_frequency: 30,
  processing_light_source: "red",
};

const RESOLVE_FIXTURE = { ...PARAMS, source: "machine" as const };

const MACHINE_ROW = {
  ...PARAMS,
  id: 1,
  machine_id: "F2Ultra",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

const MATERIAL_ROW = {
  ...MACHINE_ROW,
  id: 7,
  material_id: 4,
};

let captured: { url: string; init?: RequestInit } | null = null;
let nextResponse: unknown = null;

beforeEach(() => {
  captured = null;
  nextResponse = RESOLVE_FIXTURE;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    captured = { url, init };
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(nextResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("textRegDefaults API", () => {
  it("resolveTextRegDefaults GETs ?machine_id=&material_id=", async () => {
    nextResponse = RESOLVE_FIXTURE;
    await resolveTextRegDefaults("F2Ultra", 4);
    expect(captured!.url).toBe(
      "/api/text-registration-defaults/resolve?machine_id=F2Ultra&material_id=4",
    );
    expect(captured!.init?.method ?? "GET").toBe("GET");
  });

  it("resolveTextRegDefaults omits material_id when null", async () => {
    nextResponse = RESOLVE_FIXTURE;
    await resolveTextRegDefaults("F2Ultra");
    expect(captured!.url).toBe(
      "/api/text-registration-defaults/resolve?machine_id=F2Ultra",
    );
  });

  it("getMachineTextRegDefault GETs the machine path", async () => {
    nextResponse = MACHINE_ROW;
    await getMachineTextRegDefault("F2Ultra");
    expect(captured!.url).toBe(
      "/api/text-registration-defaults/machine/F2Ultra",
    );
  });

  it("putMachineTextRegDefault PUTs JSON body", async () => {
    nextResponse = MACHINE_ROW;
    await putMachineTextRegDefault("F2Ultra", PARAMS);
    expect(captured!.url).toBe(
      "/api/text-registration-defaults/machine/F2Ultra",
    );
    expect(captured!.init?.method).toBe("PUT");
    expect((captured!.init?.headers as Record<string, string>)["Content-Type"])
      .toBe("application/json");
    expect(JSON.parse(captured!.init?.body as string)).toEqual(PARAMS);
  });

  it("deleteMachineTextRegDefault DELETEs the machine path", async () => {
    await deleteMachineTextRegDefault("F2Ultra");
    expect(captured!.url).toBe(
      "/api/text-registration-defaults/machine/F2Ultra",
    );
    expect(captured!.init?.method).toBe("DELETE");
  });

  it("listMaterialTextRegDefaults GETs the material path", async () => {
    nextResponse = [MATERIAL_ROW];
    const rows = await listMaterialTextRegDefaults(4);
    expect(captured!.url).toBe(
      "/api/text-registration-defaults/material/4",
    );
    expect(rows).toEqual([MATERIAL_ROW]);
  });

  it("putMaterialTextRegDefault PUTs JSON body to material path", async () => {
    nextResponse = MATERIAL_ROW;
    await putMaterialTextRegDefault(4, "F2Ultra", PARAMS);
    expect(captured!.url).toBe(
      "/api/text-registration-defaults/material/4/F2Ultra",
    );
    expect(captured!.init?.method).toBe("PUT");
    expect(JSON.parse(captured!.init?.body as string)).toEqual(PARAMS);
  });

  it("deleteMaterialTextRegDefault DELETEs material path", async () => {
    await deleteMaterialTextRegDefault(4, "F2Ultra");
    expect(captured!.url).toBe(
      "/api/text-registration-defaults/material/4/F2Ultra",
    );
    expect(captured!.init?.method).toBe("DELETE");
  });

  it("encodes machine ids that need URL escaping", async () => {
    nextResponse = MACHINE_ROW;
    await getMachineTextRegDefault("F2 Ultra/Pro");
    expect(captured!.url).toBe(
      "/api/text-registration-defaults/machine/F2%20Ultra%2FPro",
    );
  });
});
