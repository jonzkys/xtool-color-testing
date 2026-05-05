import { describe, expect, test } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubHeaders } from "./sentry";

/* Regression coverage for the FE Sentry hooks. CLAUDE.md asserts
 * that auth headers + request bodies must never leave the browser
 * in a Sentry payload — these tests fail loudly if a future change
 * removes the scrubbing. The BE has its own equivalent suite in
 * tests/test_sentry.py.
 */

describe("scrubHeaders", () => {
  test("strips authorization, cookie, x-user-id, x-api-key (case-insensitive)", () => {
    const out = scrubHeaders({
      Authorization: "Bearer foo",
      Cookie: "session=abc",
      "X-User-Id": "42",
      "x-api-key": "secret-key",
      "Content-Type": "application/json",
      "Accept": "application/json",
    });
    expect(out).toEqual({
      Authorization: "<stripped>",
      Cookie: "<stripped>",
      "X-User-Id": "<stripped>",
      "x-api-key": "<stripped>",
      "Content-Type": "application/json",
      "Accept": "application/json",
    });
  });

  test("returns non-objects unchanged", () => {
    expect(scrubHeaders(undefined)).toBe(undefined);
    expect(scrubHeaders(null)).toBe(null);
    expect(scrubHeaders("nope")).toBe("nope");
  });
});

describe("scrubEvent", () => {
  test("replaces request.data with the stripped placeholder", () => {
    const event = {
      request: {
        url: "https://app/api/upload",
        method: "POST",
        data: { sensitive: "payload" },
      },
    };
    const out = scrubEvent(event);
    expect((out.request as { data: unknown }).data).toBe("<stripped>");
    // Other request fields preserved.
    expect((out.request as { url: string }).url).toBe("https://app/api/upload");
  });

  test("scrubs request.headers", () => {
    const event = {
      request: {
        url: "https://app/api/x",
        headers: { "X-API-Key": "live-key", "Accept": "*/*" },
      },
    };
    scrubEvent(event);
    const headers = (event.request as { headers: Record<string, string> }).headers;
    expect(headers["X-API-Key"]).toBe("<stripped>");
    expect(headers["Accept"]).toBe("*/*");
  });

  test("no-ops when the event has no request", () => {
    const event = { exception: { values: [] }, request: undefined };
    expect(scrubEvent(event)).toBe(event);
  });
});

describe("scrubBreadcrumb", () => {
  test("strips body in fetch-style breadcrumbs", () => {
    const crumb = {
      category: "fetch",
      data: { url: "/api/x", method: "POST", status_code: 422, body: "user content" },
    };
    scrubBreadcrumb(crumb);
    expect(crumb.data.body).toBe("<stripped>");
    // URL + method + status_code preserved (server-side URLs are fine to log).
    expect(crumb.data.url).toBe("/api/x");
    expect(crumb.data.method).toBe("POST");
  });

  test("scrubs headers if they appear in breadcrumb data", () => {
    const crumb = {
      category: "http",
      data: { url: "/api/x", headers: { Authorization: "Bearer foo" } },
    };
    scrubBreadcrumb(crumb);
    expect((crumb.data.headers as Record<string, string>).Authorization).toBe(
      "<stripped>",
    );
  });

  test("no-ops on breadcrumbs without data", () => {
    const crumb = { category: "ui.click", message: "clicked", data: undefined };
    expect(scrubBreadcrumb(crumb)).toBe(crumb);
  });
});
