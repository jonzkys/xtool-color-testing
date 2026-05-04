/**
 * Typed wrappers around the mobile-upload backend.
 *
 * Desktop-side endpoints carry X-User-Id automatically via the global
 * userHeader fetch interceptor (web/src/api/userHeader.ts). The mobile
 * page calls /api/m/{mid}/* directly with no auth; those calls happen
 * before the userHeader interceptor is even reached because the
 * mobile page is rendered without the rest of the app shell.
 */

export interface MobileIdResponse { mobile_id: string }
export interface MobileCheckResponse { ok: boolean; display_name: string }
export interface MobileUploadResponse {
  result_id: number;
  test_id: number;
  test_name: string;
}
export interface RecentMobileUpload {
  result_id: number;
  test_id: number;
  test_name: string;
  uploaded_at: string;
}

export async function getOrCreateMobileId(): Promise<string> {
  const r = await fetch("/api/me/mobile-id", { method: "POST" });
  if (!r.ok) throw new Error(`mobile-id fetch failed: ${r.status}`);
  const body = (await r.json()) as MobileIdResponse;
  return body.mobile_id;
}

export async function rotateMobileId(): Promise<string> {
  const r = await fetch("/api/me/mobile-id/rotate", { method: "POST" });
  if (!r.ok) throw new Error(`mobile-id rotate failed: ${r.status}`);
  const body = (await r.json()) as MobileIdResponse;
  return body.mobile_id;
}

export async function checkMobileId(mid: string): Promise<MobileCheckResponse> {
  const r = await fetch(`/api/m/${encodeURIComponent(mid)}/check`);
  if (r.status === 404) return { ok: false, display_name: "" };
  if (!r.ok) throw new Error(`mobile check failed: ${r.status}`);
  return (await r.json()) as MobileCheckResponse;
}

export async function uploadFromMobile(
  mid: string, file: File,
): Promise<MobileUploadResponse> {
  const fd = new FormData();
  fd.append("image", file);
  const r = await fetch(`/api/m/${encodeURIComponent(mid)}/upload`, {
    method: "POST", body: fd,
  });
  if (r.status === 429) {
    const retry = r.headers.get("Retry-After") ?? "?";
    throw Object.assign(
      new Error(`rate limited (retry after ${retry}s)`),
      { kind: "rate_limited", retryAfter: Number(retry) || 0 },
    );
  }
  if (r.status === 404) {
    throw Object.assign(
      new Error("mobile id no longer valid"),
      { kind: "invalid_mid" },
    );
  }
  if (r.status === 400) {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(
      new Error(body.detail ?? "couldn't read the photo"),
      { kind: "no_markers" },
    );
  }
  if (r.status === 409) {
    // SHA-256 dedup — surface the existing result id so the row
    // renderer can read "duplicate of #N" instead of a generic
    // failure.
    const body = await r.json().catch(() => ({}));
    const detail = body?.detail;
    const existingId =
      detail && typeof detail === "object" && typeof detail.existing_result_id === "number"
        ? detail.existing_result_id
        : undefined;
    throw Object.assign(
      new Error(
        (detail && typeof detail.message === "string"
          ? detail.message
          : null) ?? "duplicate of an existing result",
      ),
      { kind: "duplicate", existingResultId: existingId },
    );
  }
  if (!r.ok) {
    throw Object.assign(
      new Error(`upload failed: ${r.status}`),
      { kind: "network" },
    );
  }
  return (await r.json()) as MobileUploadResponse;
}

export async function listRecentMobileUploads(
  sinceUnix: number,
): Promise<RecentMobileUpload[]> {
  const r = await fetch(
    `/api/me/mobile-uploads/recent?since=${sinceUnix}`,
  );
  if (!r.ok) throw new Error(`recent fetch failed: ${r.status}`);
  return (await r.json()) as RecentMobileUpload[];
}
