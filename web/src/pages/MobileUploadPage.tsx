import { useEffect, useRef, useState } from "react";
import {
  checkMobileId,
  uploadFromMobile,
  type MobileUploadResponse,
} from "../api/mobileUpload";
import { useIsDemo } from "../hooks/useIsDemo";
import { cn } from "../ui";

interface Props { mid: string }

/* ─── Mobile upload page ──────────────────────────────────────────────
 *
 * Touch-first companion to the desktop UploadResultDialog. The
 * desktop side is a list of rows; mobile mirrors that layout but with
 * fatter touch targets and a single primary action sticky at the
 * bottom (the camera button).
 *
 * Concurrency is bounded to two: phone uplinks are usually flakier
 * than desktop, and parallelism above two often hurts on cellular.
 */

const UPLOAD_CONCURRENCY = 2;

type FileStatus =
  | "queued"
  | "uploading"
  | "success"
  | "duplicate"
  | "no_markers"
  | "rate_limited"
  | "network_error";

interface FileEntry {
  id: string;
  file: File;
  previewUrl: string;
  status: FileStatus;
  result?: MobileUploadResponse;
  duplicateOf?: number;
  retryAfterMin?: number;
  errorMessage?: string;
}

type Bootstrap =
  | { kind: "loading" }
  | { kind: "invalid_mid" }
  | { kind: "ready"; displayName: string };

export function MobileUploadPage({ mid }: Props) {
  const isDemo = useIsDemo();
  const [bootstrap, setBootstrap] = useState<Bootstrap>({ kind: "loading" });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const idSeed = useRef(0);

  // Validate the mid on mount.
  useEffect(() => {
    let cancelled = false;
    checkMobileId(mid).then((res) => {
      if (cancelled) return;
      if (!res.ok) setBootstrap({ kind: "invalid_mid" });
      else
        setBootstrap({ kind: "ready", displayName: res.display_name });
    }).catch(() => {
      if (!cancelled) setBootstrap({ kind: "invalid_mid" });
    });
    return () => { cancelled = true; };
  }, [mid]);

  // Revoke any object URLs we created when the page unmounts. Without
  // this, repeated picks on a long-lived mobile session leak Blobs —
  // 10s of MB of unfreed memory in our previous single-file flow.
  useEffect(() => {
    return () => {
      for (const e of entries) {
        try {
          URL.revokeObjectURL(e.previewUrl);
        } catch {
          /* noop */
        }
      }
    };
    // intentional: only run on unmount; entries are cleaned when
    // individual rows are removed via the dedicated revoke path below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bounded-concurrency pool, mirroring the desktop dialog. Re-fires on
  // every entries change; an entry's status flipping to ``uploading``
  // reduces the available slots.
  useEffect(() => {
    if (entries.length === 0) return;
    const inflight = entries.filter((e) => e.status === "uploading").length;
    const slots = UPLOAD_CONCURRENCY - inflight;
    if (slots <= 0) return;
    const queued = entries.filter((e) => e.status === "queued").slice(0, slots);
    if (queued.length === 0) return;
    for (const entry of queued) void runUpload(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const updateEntry = (id: string, patch: Partial<FileEntry>) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  };

  const enqueue = (files: FileList | File[]) => {
    const next: FileEntry[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      next.push({
        id: `m-${++idSeed.current}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        status: "queued",
      });
    }
    if (next.length === 0) return;
    setEntries((prev) => [...prev, ...next]);
  };

  const runUpload = async (entry: FileEntry) => {
    updateEntry(entry.id, { status: "uploading" });
    try {
      const result = await uploadFromMobile(mid, entry.file);
      updateEntry(entry.id, { status: "success", result });
    } catch (e: unknown) {
      const kind = (e as { kind?: string })?.kind;
      // Try to recover the duplicate hint from our wrapper's payload.
      const duplicate = (e as { existingResultId?: number })?.existingResultId;
      if (duplicate != null) {
        updateEntry(entry.id, {
          status: "duplicate",
          duplicateOf: duplicate,
        });
      } else if (kind === "no_markers") {
        updateEntry(entry.id, { status: "no_markers" });
      } else if (kind === "rate_limited") {
        const retryAfter = (e as { retryAfter?: number })?.retryAfter ?? 60;
        const mins = Math.max(1, Math.ceil(retryAfter / 60));
        updateEntry(entry.id, {
          status: "rate_limited",
          retryAfterMin: mins,
        });
      } else if (kind === "invalid_mid") {
        setBootstrap({ kind: "invalid_mid" });
      } else {
        updateEntry(entry.id, { status: "network_error" });
      }
    }
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id);
      if (target) {
        try {
          URL.revokeObjectURL(target.previewUrl);
        } catch {
          /* noop */
        }
      }
      return prev.filter((e) => e.id !== id);
    });
  };

  const retryEntry = (id: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id
          ? {
              ...e,
              status: "queued",
              duplicateOf: undefined,
              retryAfterMin: undefined,
              errorMessage: undefined,
            }
          : e,
      ),
    );
  };

  const Layout = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen flex flex-col p-5 bg-[color:var(--color-surface)] text-[color:var(--color-ink)]">
      {children}
    </div>
  );

  if (bootstrap.kind === "loading") {
    return <Layout><div>Loading…</div></Layout>;
  }
  if (bootstrap.kind === "invalid_mid") {
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

  const inflight = entries.filter((e) => e.status === "uploading").length;
  const totalDone = entries.filter((e) => e.status === "success").length;

  return (
    <Layout>
      <div className="text-[12.5px] text-[color:var(--color-ink-subtle)] mb-3">
        Uploading as <strong>{bootstrap.displayName}</strong>
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-[color:var(--color-ink-muted)] text-[13px] px-4">
          <div className="text-[15px] font-semibold text-[color:var(--color-ink)] mb-1.5">
            Photograph in
          </div>
          <p className="leading-relaxed">
            Take a photo or pick several from your gallery. Each one gets
            routed to its test by its QR code; identical re-uploads are
            caught automatically.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {entries.map((entry) => (
            <MobileFileRow
              key={entry.id}
              entry={entry}
              onRetry={() => retryEntry(entry.id)}
              onRemove={() => removeEntry(entry.id)}
            />
          ))}
        </ul>
      )}

      {entries.length > 0 && (
        <div className="text-center text-[11.5px] tracking-[0.12em] uppercase font-semibold text-[color:var(--color-ink-subtle)] mb-3">
          {totalDone}/{entries.length} done
          {inflight > 0 && <span className="ml-2">· {inflight} in flight</span>}
        </div>
      )}

      <div className="flex-1" />

      {/* Primary action: always available, fat target. ``multiple``
          lets the gallery picker return a batch — the camera capture
          path stays single-shot per the OS but the user can take →
          upload → take again, queueing as they go. */}
      <label className="block">
        <input
          ref={fileInputRef}
          data-testid="file-input"
          type="file"
          /* iOS Safari with ``accept="image/*"`` transcodes HEIC to
           * JPEG before delivering the File — this transcode runs
           * inside the picker, so with ``multiple`` selected the
           * picker can sit open 5-30s converting every photo before
           * the change event fires. Listing HEIC/HEIF explicitly
           * tells iOS we accept the native bytes; the backend
           * already decodes HEIC via pillow_heif so the wire format
           * is fine. The trailing ``image/*`` keeps the desktop /
           * non-iOS experience unchanged. */
          accept="image/heic,image/heif,image/jpeg,image/png,image/webp,image/*"
          multiple
          className="hidden"
          disabled={isDemo}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) enqueue(files);
            e.target.value = "";
          }}
        />
        <span
          className={cn(
            "block h-16 rounded-[10px] text-white text-[16px] font-medium",
            "flex items-center justify-center",
            isDemo
              ? "bg-[color:var(--color-primary)] opacity-50 cursor-not-allowed"
              : "bg-[color:var(--color-primary)]",
          )}
          aria-busy={inflight > 0}
        >
          {entries.length === 0
            ? "Take or choose photos"
            : "Add more photos"}
        </span>
      </label>
      {isDemo && (
        <p className="mt-2 text-[12px] text-center text-[color:var(--color-ink-muted)]">
          Uploading photos is disabled in the demo.
        </p>
      )}
    </Layout>
  );
}

/* ─── Mobile file row ─────────────────────────────────────────────────── */

function MobileFileRow({
  entry,
  onRetry,
  onRemove,
}: {
  entry: FileEntry;
  onRetry: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-[8px] border bg-[color:var(--color-surface-elevated)] px-3 py-2",
        rowBorder(entry.status),
      )}
    >
      <img
        src={entry.previewUrl}
        alt=""
        className="h-12 w-12 rounded-[6px] object-cover border border-[color:var(--color-border)] shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[color:var(--color-ink)] truncate">
          {entry.file.name}
        </div>
        <div className="mt-0.5 text-[12px]">
          <MobileStatus entry={entry} />
        </div>
      </div>
      <MobileActions
        entry={entry}
        onRetry={onRetry}
        onRemove={onRemove}
      />
    </li>
  );
}

function MobileStatus({ entry }: { entry: FileEntry }) {
  switch (entry.status) {
    case "queued":
      return <span className="text-[color:var(--color-ink-subtle)]">queued</span>;
    case "uploading":
      return (
        <span className="text-[color:var(--color-primary)] font-medium">
          Uploading…
        </span>
      );
    case "success":
      return (
        <span className="text-[color:var(--color-success)]">
          Uploaded — {entry.result?.test_name ?? "matched"}
        </span>
      );
    case "duplicate":
      return (
        <span className="text-[color:var(--color-warning)]">
          Duplicate of #{entry.duplicateOf}
        </span>
      );
    case "no_markers":
      return (
        <span className="text-[color:var(--color-destructive)]">
          Markers not detected — retry with a clearer photo.
        </span>
      );
    case "rate_limited":
      return (
        <span className="text-[color:var(--color-warning)]">
          Rate-limited — try again in ~{entry.retryAfterMin} min.
        </span>
      );
    case "network_error":
      return (
        <span className="text-[color:var(--color-destructive)]">
          Couldn't reach the server.
        </span>
      );
  }
}

function MobileActions({
  entry,
  onRetry,
  onRemove,
}: {
  entry: FileEntry;
  onRetry: () => void;
  onRemove: () => void;
}) {
  if (entry.status === "uploading") return null;
  const showRetry =
    entry.status === "no_markers" ||
    entry.status === "network_error" ||
    entry.status === "rate_limited";
  return (
    <div className="flex items-center gap-1 shrink-0">
      {showRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry"
          className="h-8 px-2 rounded-[5px] text-[12px] font-mono tracking-[0.12em] uppercase text-[color:var(--color-primary)] border border-[color:var(--color-primary)]/40"
        >
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="h-8 w-8 rounded-[5px] text-[14px] text-[color:var(--color-ink-subtle)]"
      >
        ✕
      </button>
    </div>
  );
}

function rowBorder(status: FileStatus): string {
  switch (status) {
    case "success":
      return "border-[color:var(--color-success)]/45";
    case "duplicate":
    case "rate_limited":
      return "border-[color:var(--color-warning)]/45";
    case "no_markers":
    case "network_error":
      return "border-[color:var(--color-destructive)]/45";
    case "uploading":
      return "border-[color:var(--color-primary)]/45";
    default:
      return "border-[color:var(--color-border)]";
  }
}
