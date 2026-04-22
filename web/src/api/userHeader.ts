/**
 * Multi-user bridge: if the host stored a user id in localStorage,
 * include it as X-User-Id on every /api/* request.
 *
 * Lives as a fetch-interceptor so existing API helpers don't need to
 * know about the header — they just call fetch("/api/...") as before.
 * Single-user / standalone deployments ignore the header server-side,
 * so this is safe to run unconditionally.
 *
 * Auth is deliberately not handled here; a real auth layer would
 * either replace this module or layer a token-reader on top.
 */

const STORAGE_KEY = "xcsgen:userId";

export function getCurrentUserId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage disabled / SSR-like env
  }
}

export function setCurrentUserId(id: string | null): void {
  try {
    if (id == null || id === "") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    /* ignore */
  }
}

/** Install a fetch interceptor that attaches X-User-Id to /api/* calls. */
export function installUserHeader(): void {
  if (typeof window === "undefined" || (window as any).__xcsgenFetchPatched) {
    return;
  }
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const userId = getCurrentUserId();
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (userId && url.startsWith("/api/")) {
      const headers = new Headers(init?.headers || {});
      // Don't clobber if an explicit header was supplied.
      if (!headers.has("X-User-Id")) headers.set("X-User-Id", userId);
      return original(input, { ...init, headers });
    }
    return original(input, init);
  };
  (window as any).__xcsgenFetchPatched = true;
}
