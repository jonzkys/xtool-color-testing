import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  getOrCreateMobileId,
  rotateMobileId,
  listRecentMobileUploads,
  type RecentMobileUpload,
} from "../api/mobileUpload";
import { formatRoute } from "../router";

const POLL_MS = 3000;
const RECENT_LOOKBACK_S = 600;  // 10 min — covers "I closed and reopened"

export function MobileQrTab() {
  const [mid, setMid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentMobileUpload[]>([]);
  const sinceRef = useRef<number>(
    Math.floor(Date.now() / 1000) - RECENT_LOOKBACK_S,
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fetch / create mid on mount.
  useEffect(() => {
    let cancelled = false;
    getOrCreateMobileId()
      .then((m) => { if (!cancelled) setMid(m); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  // Render the QR whenever mid changes.
  useEffect(() => {
    if (!mid || !canvasRef.current) return;
    const url = `${window.location.origin}/${formatRoute({
      name: "mobile-upload", mid,
    })}`;
    QRCode.toCanvas(canvasRef.current, url, { width: 220, margin: 1 })
      .catch((e) => setError(String(e)));
  }, [mid]);

  // Poll for new mobile uploads while the tab is mounted.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const rows = await listRecentMobileUploads(sinceRef.current);
        if (stopped) return;
        if (rows.length > 0) {
          setRecent((prev) => {
            const seen = new Set(prev.map((u) => u.result_id));
            const fresh = rows.filter((u) => !seen.has(u.result_id));
            return [...fresh, ...prev].slice(0, 20);
          });
          // Advance the cursor to the newest uploaded_at. We deduplicate by
          // result_id above, so it's safe to re-include the same second on
          // the next poll — concurrent-second uploads can no longer be lost.
          const newestUnix = Math.floor(
            new Date(rows[0].uploaded_at).getTime() / 1000,
          );
          sinceRef.current = newestUnix;
        }
      } catch {
        // Silent — transient failures recover on the next tick.
      }
    };
    void tick();  // immediate
    const id = window.setInterval(tick, POLL_MS);
    return () => { stopped = true; window.clearInterval(id); };
  }, []);

  const onRotate = async () => {
    if (!confirm(
      "Rotating breaks any phone that already has the old QR open. Continue?",
    )) return;
    try {
      const fresh = await rotateMobileId();
      setMid(fresh);
    } catch (e) { setError(String(e)); }
  };

  const mobileUrl = mid
    ? `${window.location.origin}/${formatRoute({
        name: "mobile-upload", mid,
      })}`
    : "";

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      {error && (
        <div className="text-[12.5px] text-[color:var(--color-danger)]">
          {error}
        </div>
      )}
      <a
        data-testid="qr-link"
        data-mobile-url={mobileUrl}
        href={mobileUrl || "#"}
        target="_blank"
        rel="noreferrer"
        className="block"
        title="Open the same page in this tab (for testing)"
      >
        <canvas ref={canvasRef} />
      </a>
      <p className="text-[12.5px] text-[color:var(--color-ink-muted)]">
        Scan with your phone camera. Pictures land here automatically.
      </p>
      <button
        type="button"
        onClick={onRotate}
        className="text-[11px] underline text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)]"
      >
        rotate code
      </button>
      {recent.length > 0 && (
        <div className="w-full pt-3 border-t border-[color:var(--color-border)]">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)] mb-2">
            recent uploads
          </div>
          <ul className="flex flex-col gap-1">
            {recent.map((u) => (
              <li key={u.result_id}>
                <a
                  href={formatRoute({ name: "test-detail", id: u.test_id })}
                  className="flex items-center gap-2 text-[13px] text-[color:var(--color-ink)] hover:underline"
                >
                  <span>Got a photo for <strong>{u.test_name}</strong></span>
                  <span className="ml-auto text-[11px] text-[color:var(--color-ink-subtle)]">
                    open →
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
