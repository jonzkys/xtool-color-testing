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

/** Custom event dispatched in-tab whenever the stored user id changes.
 *  ``storage`` only fires cross-tab, so same-tab listeners need this. */
export const USER_CHANGED_EVENT = "xcsgen:user-changed";

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
    window.dispatchEvent(new Event(USER_CHANGED_EVENT));
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
    window.dispatchEvent(new Event(USER_CHANGED_EVENT));
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
    let resp: Response;
    if (typeof input === "string" || input instanceof URL) {
      resp = await original(rewrittenUrl, { ...init, headers });
    } else {
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
      resp = await original(rebuilt, init);
    }

    // Stale-key recovery: if the backend reports the stored api_key is
    // no longer registered (e.g. the DB was reset), wipe the slot and
    // hard-reload so the Welcome gate re-renders. Without this the user
    // gets stuck — every page mount fires its own 401-laced fetch and
    // the SPA never returns to a usable state.
    //
    // Backend contract (src/xcs_gen_web/deps.py::get_current_user):
    //   401 + JSON body containing the substring "api key not registered".
    // If that string ever changes, update both sides.
    if (resp.status === 401 && userId) {
      void handleStaleApiKey(resp.clone()).catch(() => {});
    }

    // Surface non-2xx /api/* errors via the toast host. Per-call sites
    // can still catch the error and show their own banner — the toast
    // is a global safety net so a save / generate failure can't be
    // silently lost while the user is scrolled away from the form's
    // local error state. Skipped for known no-op statuses (304, 401)
    // and for opted-out callers (X-Skip-Toast: 1).
    if (
      !resp.ok
      && resp.status !== 401
      && resp.status !== 304
      && headers.get("X-Skip-Toast") !== "1"
    ) {
      void surfaceErrorToast(resp.clone(), originalUrl).catch(() => {});
    }
    return resp;
  };

  (window as any).__xcsgenFetchPatched = true;
}

/** Exposed for tests / debugging. */
export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

/** Substring the backend includes in its detail when the api_key in
 *  the header doesn't match any user row. See
 *  ``src/xcs_gen_web/deps.py::get_current_user`` for the source string.
 *  If the backend message changes, update this constant too. */
const STALE_API_KEY_MARKER = "api key not registered";

/** Guard so we only fire the stale-key reload once per page life. The
 *  fetch interceptor sees the same 401 many times in a row when several
 *  page-mount queries fan out concurrently. */
let staleApiKeyHandled = false;

/**
 * Stale-key recovery. Reads the response body, checks for the marker
 * the backend uses to signal "this api_key isn't registered", and on
 * match: clears the stored slot and hard-reloads. The Welcome gate then
 * re-renders on the fresh page load and the user can claim/load a new
 * key.
 *
 * Defensive on every step — body might already be consumed, JSON may be
 * malformed, location may be locked down — we no-op on any failure
 * rather than throwing inside fetch.
 */
async function handleStaleApiKey(resp: Response): Promise<void> {
  if (staleApiKeyHandled) return;
  let text = "";
  try {
    text = await resp.text();
  } catch {
    return;
  }
  if (!text.includes(STALE_API_KEY_MARKER)) return;
  // Re-check the flag after the await: a concurrent burst of stale 401s
  // can all clear the first guard before any of them sets it. Setting
  // here keeps the reload exactly-once without a lock.
  if (staleApiKeyHandled) return;
  staleApiKeyHandled = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PREV_KEY);
  } catch {
    /* private mode — fall through, the reload still helps */
  }
  try {
    // Drop the hash so the Welcome dialog mounts on the default landing
    // rather than a deep-link that needs the now-cleared key.
    window.location.hash = "";
    window.location.reload();
  } catch {
    /* ignore */
  }
}

/** Exposed for tests so the one-shot guard can be reset between cases. */
export function __resetStaleApiKeyGuardForTests(): void {
  staleApiKeyHandled = false;
}

/**
 * Best-effort error → toast surface. Reads the response body so we can
 * include the structured detail (e.g. `{"field":"frequency","message":"..."}`)
 * if the backend sent one. Falls back to the bare HTTP status text if
 * the body isn't readable.
 *
 * Lazy-imported so the toast module isn't pulled into the entry chunk
 * unless an error actually fires (keeps cold-load JS small).
 */
async function surfaceErrorToast(resp: Response, url: string): Promise<void> {
  let detail = "";
  try {
    const text = await resp.text();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        const d = parsed && typeof parsed === "object" ? parsed.detail : null;
        if (typeof d === "string") {
          detail = d;
        } else if (d && typeof d === "object" && d.message) {
          detail = d.field
            ? `${d.field}: ${d.message}`
            : String(d.message);
        } else if (d) {
          detail = JSON.stringify(d);
        }
      } catch {
        detail = text.slice(0, 200);
      }
    }
  } catch {
    /* ignore */
  }
  const path = url.replace(/^\/api\//, "");
  const header = `${resp.status} on ${path.split("?")[0]}`;
  const message = detail ? `${header}\n${detail}` : header;
  const { notify } = await import("../ui/Toast");
  notify(message, "error");
}
