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
 *   - Unhandled promise rejections (the silent kind that just log to
 *     the console, like the 422 you saw in TestsPage)
 *
 * What we don't capture:
 *   - Handled fetch errors that components surface via their own error
 *     state. The toast system already shows those to the user; we
 *     don't double-log.
 */

let _initialised = false;

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
    });
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
