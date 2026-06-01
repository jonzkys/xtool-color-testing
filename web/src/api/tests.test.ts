import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTestXcs } from "./tests";

let captured: { url: string; init?: RequestInit } | null = null;

beforeEach(() => {
  captured = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        url,
        blob: async () => new Blob(["x"]),
      } as unknown as Response;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateTestXcs", () => {
  it("defaults to the xs format query param", async () => {
    await generateTestXcs(7);
    expect(captured?.url).toBe("/api/tests/7/generate?format=xs");
    expect(captured?.init?.method).toBe("POST");
  });

  it("forwards an explicit xcs format", async () => {
    await generateTestXcs(7, "xcs");
    expect(captured?.url).toBe("/api/tests/7/generate?format=xcs");
  });
});
