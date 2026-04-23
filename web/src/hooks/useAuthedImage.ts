import { useEffect, useState } from "react";

/**
 * Fetch an authenticated image URL as a blob and return a ``blob:`` URL
 * suitable for ``<img src>``.
 *
 * Why this exists: ``<img src>`` can't carry custom headers, so the
 * frontend can't pass ``X-User-Id`` for a cross-origin
 * ``/api/results/{rid}/image`` request. In split-origin deployments
 * (frontend on CloudFront, API on a separate host) this manifests as
 * broken image icons — the browser sends the request without auth and
 * gets 401/403.
 *
 * The hook fetches the bytes via the global ``fetch`` (which the app's
 * ``userHeader`` interceptor decorates with the API base URL and the
 * auth header), converts the response to a Blob, and hands back an
 * object URL. The URL is revoked when the component unmounts or when
 * ``url`` changes, so repeated mounts don't leak Blobs.
 *
 * Returns ``null`` while the fetch is in flight or on error — callers
 * can render a placeholder in that window.
 */
export function useAuthedImage(url: string | null | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(null);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return blobUrl;
}
