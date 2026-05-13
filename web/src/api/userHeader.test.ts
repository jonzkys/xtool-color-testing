import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installUserHeader,
  setCurrentUserId,
  __resetStaleApiKeyGuardForTests,
} from "./userHeader";

/**
 * Covers the stale-api-key recovery path: when the backend says
 * "api key not registered" the interceptor must clear the stored slot
 * and reload, so the Welcome gate re-renders.
 */

const STALE_BODY = JSON.stringify({
  detail: "api key not registered — claim or load one from the welcome screen",
});

const originalLocation = window.location;

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Install the interceptor on top of the current ``window.fetch``
 *  stub. The patched-flag guard would otherwise skip re-installation
 *  and the interceptor would still be wrapping a stale closure. */
function reinstallInterceptor(): void {
  (window as unknown as { __xcsgenFetchPatched?: boolean }).__xcsgenFetchPatched = false;
  installUserHeader();
}

beforeEach(() => {
  __resetStaleApiKeyGuardForTests();
  setCurrentUserId("STALEKEY1234567X");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...originalLocation,
      reload: vi.fn(),
      hash: "#/spectrum",
    },
  });
});

afterEach(() => {
  setCurrentUserId(null);
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("userHeader stale-api-key recovery", () => {
  it("clears the stored api_key and reloads on 401 'api key not registered'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(STALE_BODY, {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    reinstallInterceptor();

    const resp = await fetch("/api/me");
    expect(resp.status).toBe(401);

    // The recovery handler is fire-and-forget; flush microtasks so the
    // response body read + localStorage clear + reload all settle.
    // The handler is fire-and-forget; flush all pending microtasks so
    // resp.text() → localStorage.removeItem → window.location.reload all
    // settle before we assert.
    await flushAsync();

    expect(localStorage.getItem("xcsgen:userId")).toBeNull();
    expect(window.location.reload).toHaveBeenCalledOnce();
  });

  it("does not clear the api_key on unrelated 401s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: "missing X-User-Id header" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    reinstallInterceptor();

    await fetch("/api/me");
    // The handler is fire-and-forget; flush all pending microtasks so
    // resp.text() → localStorage.removeItem → window.location.reload all
    // settle before we assert.
    await flushAsync();

    expect(localStorage.getItem("xcsgen:userId")).toBe("STALEKEY1234567X");
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("does not fire when no api_key is stored (welcome gate handles it)", async () => {
    setCurrentUserId(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(STALE_BODY, {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    reinstallInterceptor();

    await fetch("/api/me");
    // The handler is fire-and-forget; flush all pending microtasks so
    // resp.text() → localStorage.removeItem → window.location.reload all
    // settle before we assert.
    await flushAsync();

    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("only reloads once even on a burst of concurrent stale 401s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(STALE_BODY, {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    reinstallInterceptor();

    await Promise.all([
      fetch("/api/me"),
      fetch("/api/materials"),
      fetch("/api/tests"),
    ]);
    // The handler is fire-and-forget; flush all pending microtasks so
    // resp.text() → localStorage.removeItem → window.location.reload all
    // settle before we assert.
    await flushAsync();

    expect(window.location.reload).toHaveBeenCalledOnce();
  });
});
