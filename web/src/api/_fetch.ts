/**
 * Shared fetch unwrapper used by the api/* modules. Replaces the
 * three near-identical ``j<T>`` copies that lived in library.ts /
 * tests.ts / results.ts and centralises Sentry capture on non-OK
 * responses — without it, every component that swallows fetch
 * errors into a toast was invisible to telemetry.
 *
 * The Response carries enough context (``r.url``, ``r.status``,
 * response body) to reconstruct the failure server-side; we don't
 * need the original Request's method or body. Sentry receives the
 * thrown Error with structured tags so the dashboard groups by URL
 * + status rather than every distinct response body becoming a new
 * issue.
 *
 * Status filtering is deliberately *not* applied here — ALL non-OK
 * responses are reported. Filtering happens at the Sentry project
 * level once we see what's actually noisy.
 */

import { captureHandledError } from "../sentry";

export class ApiError extends Error {
  status: number;
  url: string;
  body: string;
  constructor(opts: { status: number; url: string; body: string; message: string }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
  }
}

/** Throws ``ApiError`` (which extends Error) on non-OK status, and
 *  forwards the error to Sentry. Returns the parsed JSON body for
 *  2xx responses (or ``undefined`` for 204). */
export async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const err = new ApiError({
      status: r.status,
      url: r.url,
      body,
      message: `${r.status} ${body}`,
    });
    captureHandledError(err, {
      tags: {
        api_status: String(r.status),
        api_url: stripQuery(r.url),
      },
      extras: { body: body.slice(0, 1000) },
    });
    throw err;
  }
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

function stripQuery(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}
