import { useEffect, useRef, useState } from "react";
import {
  checkMobileId,
  uploadFromMobile,
  type MobileUploadResponse,
} from "../api/mobileUpload";

interface Props { mid: string }

type State =
  | { kind: "loading" }
  | { kind: "invalid_mid" }
  | { kind: "idle"; displayName: string }
  | { kind: "uploading"; displayName: string; previewUrl: string }
  | { kind: "success"; displayName: string; previewUrl: string;
      result: MobileUploadResponse }
  | { kind: "no_markers"; displayName: string }
  | { kind: "rate_limited"; displayName: string; retryAfterMin: number }
  | { kind: "network_error"; displayName: string };

export function MobileUploadPage({ mid }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Validate the mid on mount.
  useEffect(() => {
    let cancelled = false;
    checkMobileId(mid).then((res) => {
      if (cancelled) return;
      if (!res.ok) setState({ kind: "invalid_mid" });
      else setState({ kind: "idle", displayName: res.display_name });
    }).catch(() => {
      if (!cancelled) setState({ kind: "invalid_mid" });
    });
    return () => { cancelled = true; };
  }, [mid]);

  // Revoke any object URL we created when state moves away from it
  // (Upload another, Continue on desktop) or when the component unmounts.
  // Without this, picking a file and navigating away leaks the blob —
  // on mobile, repeated use accumulates 10s of MB of unfreed memory.
  useEffect(() => {
    if (state.kind !== "uploading" && state.kind !== "success") return;
    const url = state.previewUrl;
    return () => {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
    };
  }, [state]);

  const onPick = async (file: File) => {
    if (state.kind !== "idle" && state.kind !== "no_markers" &&
        state.kind !== "network_error" && state.kind !== "rate_limited") {
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const displayName =
      "displayName" in state ? state.displayName : "you";
    setState({ kind: "uploading", displayName, previewUrl });
    try {
      const result = await uploadFromMobile(mid, file);
      setState({ kind: "success", displayName, previewUrl, result });
    } catch (e: unknown) {
      const kind = (e as { kind?: string })?.kind;
      if (kind === "no_markers") {
        setState({ kind: "no_markers", displayName });
      } else if (kind === "rate_limited") {
        const retryAfter = (e as { retryAfter?: number })?.retryAfter ?? 60;
        const mins = Math.max(1, Math.ceil(retryAfter / 60));
        setState({ kind: "rate_limited", displayName, retryAfterMin: mins });
      } else if (kind === "invalid_mid") {
        setState({ kind: "invalid_mid" });
      } else {
        setState({ kind: "network_error", displayName });
      }
    }
  };

  const reset = () => {
    if ("displayName" in state) {
      setState({ kind: "idle", displayName: state.displayName });
    }
  };

  // Layout shared by all "still working" states.
  const Layout = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen flex flex-col p-5 bg-[color:var(--color-surface)] text-[color:var(--color-ink)]">
      {children}
    </div>
  );

  if (state.kind === "loading") {
    return <Layout><div>Loading…</div></Layout>;
  }

  if (state.kind === "invalid_mid") {
    return (
      <Layout>
        <div className="m-auto text-center">
          <h1 className="text-[18px] font-semibold mb-2">
            This link is no longer valid
          </h1>
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">
            Re-scan the QR code on your desktop to get a fresh link.
          </p>
        </div>
      </Layout>
    );
  }

  if (state.kind === "success") {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <img
            src={state.previewUrl} alt="" className="max-w-[260px] max-h-[260px] rounded-[8px] border border-[color:var(--color-border)]"
          />
          <div className="text-center">
            <div className="text-[15px] font-semibold mb-1">Got it!</div>
            <div className="text-[13px] text-[color:var(--color-ink-muted)]">
              Uploaded for <strong>{state.result.test_name}</strong>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-4">
          <button
            type="button"
            onClick={reset}
            className="h-12 rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] text-[14px] font-medium"
          >
            Upload another
          </button>
          <a
            href="#done"
            onClick={(e) => {
              e.preventDefault();
              setState({ kind: "idle", displayName: state.displayName });
            }}
            className="h-12 rounded-[8px] bg-[color:var(--color-primary)] text-white text-[14px] font-medium flex items-center justify-center"
          >
            Continue on desktop
          </a>
        </div>
      </Layout>
    );
  }

  // For the remaining states, render a primary tap target + status text.
  let banner: React.ReactNode = null;
  if (state.kind === "no_markers") {
    banner = (
      <div className="rounded-[6px] border border-[color:var(--color-destructive)] bg-[color:var(--color-destructive-tint)] text-[12.5px] p-3 mb-4">
        Couldn't find the test markers — try a clearer, well-lit photo.
      </div>
    );
  } else if (state.kind === "rate_limited") {
    banner = (
      <div className="rounded-[6px] border border-[color:var(--color-warning)] bg-[color:var(--color-warning-tint)] text-[12.5px] p-3 mb-4">
        Too many uploads in the last hour. Try again in about {state.retryAfterMin} min.
      </div>
    );
  } else if (state.kind === "network_error") {
    banner = (
      <div className="rounded-[6px] border border-[color:var(--color-destructive)] bg-[color:var(--color-destructive-tint)] text-[12.5px] p-3 mb-4">
        Couldn't reach the server. Check your connection and try again.
      </div>
    );
  }

  const uploading = state.kind === "uploading";

  return (
    <Layout>
      <div className="text-[12.5px] text-[color:var(--color-ink-subtle)] mb-3">
        Uploading as <strong>{("displayName" in state) ? state.displayName : ""}</strong>
      </div>
      {banner}
      <div className="flex-1" />
      <label className="block">
        <input
          ref={fileInputRef}
          data-testid="file-input"
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPick(f);
            e.target.value = "";
          }}
        />
        <span
          className="block h-16 rounded-[10px] bg-[color:var(--color-primary)] text-white text-[16px] font-medium flex items-center justify-center"
          aria-busy={uploading}
        >
          {uploading ? "Uploading…" : "Take or choose photo"}
        </span>
      </label>
    </Layout>
  );
}
