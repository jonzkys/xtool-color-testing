/**
 * Sentry initialisation — env-driven, no-op when DSN unset.
 *
 * Reads `VITE_SENTRY_DSN` at build time. When unset (the default),
 * `init` is a no-op and the SDK does no work. The Sentry bundle is
 * dynamically imported so when error reporting is disabled the JS
 * never gets loaded — keeps cold-load size flat for self-hosted /
 * standalone deployments.
 *
 * Optional vars:
 *   VITE_SENTRY_ENVIRONMENT  — defaults to "production"
 *   VITE_SENTRY_RELEASE      — usually a git sha or tag from CI
 *   VITE_SENTRY_TRACES_SAMPLE_RATE — 0 unless performance is enabled
 *
 * Capture surface:
 *   - Uncaught errors (window.onerror)
 *   - Unhandled promise rejections
 *   - Handled non-OK fetch responses (via ``captureHandledError``
 *     called from ``api/_fetch.ts``). The toast surfaces the message
 *     to the user; Sentry surfaces it to us. Trialling users tend to
 *     drop off without reporting bugs, so silent telemetry matters
 *     more than avoiding a double-log.
 */

let _initialised = false;
// Cached Sentry module after the first successful init. Subsequent
// captureHandledError calls re-use this; if init never happened
// (DSN unset) the helper is a no-op.
let _sentry: typeof import("@sentry/react") | null = null;

export async function initSentry(): Promise<void> {
  if (_initialised) return;
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
  if (!dsn) {
    // No DSN — nothing to do. Don't even pull the bundle.
    return;
  }

  const environment =
    (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined)?.trim() ||
    "production";
  const release =
    (import.meta.env.VITE_SENTRY_RELEASE as string | undefined)?.trim() ||
    undefined;
  const tracesRaw = (
    import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string | undefined
  )?.trim();
  const tracesSampleRate = tracesRaw ? Math.max(0, Math.min(1, Number(tracesRaw))) : 0;

  try {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn,
      environment,
      release,
      tracesSampleRate,
      // Browser session replays would be valuable but pull in a much
      // larger bundle and add per-page network cost; leave disabled
      // until there's a real need.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      // Strip request bodies + auth headers before anything leaves
      // the browser. CLAUDE.md asserts this invariant on both BE and
      // FE — the BE hook is in ``src/xcs_gen_web/sentry.py``; this
      // is its FE counterpart. Without it, the fetch-breadcrumb
      // integration could carry an ``X-API-Key`` header or a request
      // body containing user content into the Sentry dashboard.
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    _sentry = Sentry;
    _initialised = true;
    // eslint-disable-next-line no-console
    console.log(
      `[sentry] initialised env=${environment} release=${release ?? "<unset>"}`,
    );
  } catch (err) {
    // Loading Sentry shouldn't take the app down. Log and carry on.
    // eslint-disable-next-line no-console
    console.warn("[sentry] init failed:", err);
  }
}

/* Headers Sentry should never see, regardless of integration source.
 * Mirrors the backend's allowlist. ``X-User-Id`` is the demo /
 * standalone identity carrier; ``X-API-Key`` and ``Authorization``
 * carry the multi-user credentials we definitely don't want in the
 * dashboard. ``Cookie`` covers any future cookie auth. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-user-id",
  "x-api-key",
]);

export function scrubHeaders(headers: unknown): unknown {
  if (!headers || typeof headers !== "object") return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? "<stripped>" : v;
  }
  return out;
}

export function scrubEvent<T extends { request?: unknown }>(event: T): T {
  const req = (event.request as Record<string, unknown> | undefined) ?? undefined;
  if (req) {
    if ("data" in req) req.data = "<stripped>";
    if ("headers" in req) req.headers = scrubHeaders(req.headers);
  }
  return event;
}

// ``fetch`` / ``xhr`` breadcrumbs carry ``data: { url, method,
// status_code, request_body_size, ... }``. The default Sentry
// breadcrumb processor doesn't capture headers in ``data`` but does
// include the URL. URLs in this app are server-side (e.g.
// /api/palette/query?hex=...) so they're fine to keep. For ``http``
// breadcrumbs we still scrub headers defensively if they appear, in
// case a future integration adds them.
//
// Typed via the Sentry Breadcrumb shape — the cast inside the body
// is needed because ``data`` is declared as ``{ [key: string]: any }``
// optional, and we narrow before mutating.
export function scrubBreadcrumb<B extends { data?: { [key: string]: unknown } | undefined }>(
  breadcrumb: B,
): B | null {
  const data = breadcrumb.data;
  if (!data || typeof data !== "object") return breadcrumb;
  if ("headers" in data) data.headers = scrubHeaders(data.headers);
  if ("body" in data) data.body = "<stripped>";
  return breadcrumb;
}


/** Capture a handled error to Sentry. No-op when the SDK isn't
 *  initialised (e.g. dev or DSN unset). Tags are flat string→string
 *  for grouping; extras hold longer per-occurrence detail like the
 *  HTTP response body. Safe to call from any path — failures inside
 *  the helper are swallowed so a buggy capture never breaks the
 *  user's flow. */
export function captureHandledError(
  err: unknown,
  ctx?: { tags?: Record<string, string>; extras?: Record<string, unknown> },
): void {
  if (!_sentry || !_initialised) return;
  try {
    _sentry.withScope((scope) => {
      if (ctx?.tags) {
        for (const [k, v] of Object.entries(ctx.tags)) {
          scope.setTag(k, v);
        }
      }
      if (ctx?.extras) {
        for (const [k, v] of Object.entries(ctx.extras)) {
          scope.setExtra(k, v);
        }
      }
      _sentry!.captureException(err);
    });
  } catch {
    // Swallow — telemetry must never throw into the app.
  }
}
