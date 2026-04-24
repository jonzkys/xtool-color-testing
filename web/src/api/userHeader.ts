/**
 * Request routing + multi-user bridge.
 *
 * Installs a single fetch interceptor that does two things on every
 * ``/api/*`` call:
 *
 *   1. Rewrites the URL to absolute if ``VITE_API_BASE_URL`` was set
 *      at build time. Lets the frontend live on a different origin
 *      (S3 + CloudFront) from the API (ALB) without changing any
 *      call site.
 *   2. Attaches the ``X-User-Id`` header when a user id has been
 *      stored in localStorage. Standalone deployments ignore the
 *      header server-side, so this is safe to run unconditionally.
 *
 * Single interceptor, two concerns — keeps every downstream api/*
 * helper calling plain ``fetch("/api/foo")`` as if the two machines
 * were one. Auth is deliberately not handled here; a real auth layer
 * would either replace this module or layer a token-reader on top.
 */

const STORAGE_KEY = "xcsgen:userId";

const PREV_KEY = "xcsgen:userId:prev";

/** Literal API-key value that signals "demo account" to the backend. */
export const DEMO_API_KEY = "DEMO";

export function isDemoUser(): boolean {
  return getCurrentUserId() === DEMO_API_KEY;
}

/**
 * Switch the app into demo mode. If a real key is already stored, it
 * is preserved under ``PREV_KEY`` so ``exitDemo()`` can restore it and
 * users don't lose their session when they click a demo link from
 * within the app.
 */
export function enterDemo(): void {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current && current !== DEMO_API_KEY) {
      localStorage.setItem(PREV_KEY, current);
    }
    localStorage.setItem(STORAGE_KEY, DEMO_API_KEY);
  } catch {
    /* storage disabled — ignore; app will re-gate on next load */
  }
}

/**
 * Leave demo mode. Restores the previously-saved real key if any;
 * otherwise clears the slot entirely (Welcome gate picks up from
 * there).
 */
export function exitDemo(): void {
  try {
    const prev = localStorage.getItem(PREV_KEY);
    // Remove PREV_KEY first — cheap, never throws on quota. If the
    // setItem below does throw (private mode + quota), we won't be
    // stuck re-reading the stale backup on the next exit attempt.
    localStorage.removeItem(PREV_KEY);
    if (prev) {
      localStorage.setItem(STORAGE_KEY, prev);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* PREV_KEY is already cleared; userId slot may still hold DEMO */
  }
}

/**
 * Base URL the interceptor prefixes onto ``/api/*`` calls. Set at
 * build time via ``VITE_API_BASE_URL`` — unset means relative URLs,
 * which is what local dev + single-host deployments want.
 *
 * Trailing slash is stripped so ``BASE + "/api/foo"`` never produces
 * ``"…//api/foo"``.
 */
const API_BASE_URL: string = (() => {
  const raw = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
  return raw.replace(/\/+$/, "");
})();

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

/** Install the fetch interceptor. Idempotent. */
export function installUserHeader(): void {
  if (typeof window === "undefined" || (window as any).__xcsgenFetchPatched) {
    return;
  }
  const original = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const originalUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Only our own /api/* calls get rewritten + header-decorated.
    // Third-party fetches (CDN, etc.) pass through untouched.
    if (!originalUrl.startsWith("/api/")) {
      return original(input, init);
    }

    const rewrittenUrl = API_BASE_URL
      ? `${API_BASE_URL}${originalUrl}`
      : originalUrl;

    const headers = new Headers(init?.headers || {});
    const userId = getCurrentUserId();
    if (userId && !headers.has("X-User-Id")) {
      headers.set("X-User-Id", userId);
    }

    // Preserve the input shape (Request vs string) so things like a
    // pre-built Request with its own body still work. When the URL
    // needs rewriting we unavoidably rebuild — Request's URL is
    // immutable, so we pull its properties and reconstruct.
    if (typeof input === "string" || input instanceof URL) {
      return original(rewrittenUrl, { ...init, headers });
    }
    // Request object: rebuild with the rewritten URL, inherit everything else.
    const req = input as Request;
    const rebuilt = new Request(rewrittenUrl, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : req.clone().body,
      mode: req.mode,
      credentials: req.credentials,
      cache: req.cache,
      redirect: req.redirect,
      referrer: req.referrer,
      integrity: req.integrity,
    });
    return original(rebuilt, init);
  };

  (window as any).__xcsgenFetchPatched = true;
}

/** Exposed for tests / debugging. */
export function getApiBaseUrl(): string {
  return API_BASE_URL;
}
