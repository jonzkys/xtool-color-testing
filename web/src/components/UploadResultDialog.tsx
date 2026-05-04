import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  QrCode,
  RotateCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { uploadResultAuto } from "../api/results";
import { getTest } from "../api/tests";
import type { ResultRecord, TestRecord } from "../types";
import { formatRoute } from "../router";
import { useIsDemo } from "../hooks/useIsDemo";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  MetalBar,
} from "../ui";
import { MobileQrTab } from "./MobileQrTab";

type Tab = "device" | "phone";

/** Concurrency cap for the upload pool. Three is a deliberate balance:
 *  the QR + warp pipeline is CPU-bound on the backend so flooding with
 *  N requests doesn't help, but firing one at a time wastes wall-clock
 *  on photo round-trips. */
const UPLOAD_CONCURRENCY = 3;

type FileStatus =
  | "queued"
  | "preflighting"
  | "uploading"
  | "success"
  | "duplicate"
  | "error";

interface FileEntry {
  id: string;
  file: File;
  status: FileStatus;
  /** Status-dependent payloads — kept in a flat shape so the row
   *  renderer can branch off ``status`` without prop juggling. */
  testId?: number;
  testName?: string;
  result?: ResultRecord;
  test?: TestRecord | null;
  duplicateOf?: number;
  duplicateAt?: string;
  errorMessage?: string;
}

/* ─── Public dialog ────────────────────────────────────────────────────── */

export function UploadResultDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isDemo = useIsDemo();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const idSeed = useRef(0);

  const [tab, setTab] = useState<Tab>("device");

  const handleOpenChange = useCallback(
    (o: boolean) => {
      if (!o) {
        setEntries([]);
        setDragOver(false);
      }
      onOpenChange(o);
    },
    [onOpenChange],
  );

  /** Append files to the queue, dropping non-image inputs. The pool
   *  effect below picks them up automatically; each entry runs through
   *  preflight → upload → terminal status (success / duplicate /
   *  error). Re-entering a previously-resolved file (same name + size
   *  + lastModified) is allowed — users may want to retry an error. */
  const enqueue = useCallback((files: FileList | File[]) => {
    const next: FileEntry[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      next.push({
        id: `f-${++idSeed.current}`,
        file: f,
        status: "queued",
      });
    }
    if (next.length === 0) return;
    setEntries((prev) => [...prev, ...next]);
  }, []);

  /* ─── Pool ───────────────────────────────────────────────────────── */
  // Process queued entries with bounded concurrency. The effect re-fires
  // every time entries changes; we use a ref-tracked active count so
  // entries can spawn extra work mid-render without races.
  const activeRef = useRef(0);
  useEffect(() => {
    if (entries.length === 0) return;
    const inflight = entries.filter((e) => e.status === "uploading" || e.status === "preflighting").length;
    activeRef.current = inflight;
    const slots = UPLOAD_CONCURRENCY - inflight;
    if (slots <= 0) return;
    const queued = entries.filter((e) => e.status === "queued").slice(0, slots);
    if (queued.length === 0) return;
    for (const entry of queued) void runUpload(entry);
    // The runUpload function is stable (no deps) — it reads/writes
    // entries via setState callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const updateEntry = useCallback(
    (id: string, patch: Partial<FileEntry>) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );
    },
    [],
  );

  const runUpload = useCallback(
    async (entry: FileEntry) => {
      updateEntry(entry.id, { status: "uploading" });
      try {
        const result = await uploadResultAuto(entry.file);
        let test: TestRecord | null = null;
        try {
          test = await getTest(result.test_id);
        } catch {
          /* non-fatal */
        }
        window.dispatchEvent(
          new CustomEvent("result:refetch", {
            detail: { testId: result.test_id },
          }),
        );
        updateEntry(entry.id, {
          status: "success",
          result,
          test,
          testId: result.test_id,
          testName: test?.name,
        });
      } catch (e) {
        const detail = parseErrorDetail(e);
        if (detail.kind === "duplicate" && detail.existingId != null) {
          updateEntry(entry.id, {
            status: "duplicate",
            duplicateOf: detail.existingId,
            duplicateAt: detail.uploadedAt,
          });
        } else {
          updateEntry(entry.id, {
            status: "error",
            errorMessage: detail.message,
          });
        }
      }
    },
    [updateEntry],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) enqueue(files);
    },
    [enqueue],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) enqueue(files);
      e.target.value = "";
    },
    [enqueue],
  );

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const retryEntry = useCallback((id: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id
          ? {
              ...e,
              status: "queued",
              errorMessage: undefined,
              duplicateOf: undefined,
              duplicateAt: undefined,
            }
          : e,
      ),
    );
  }, []);

  const summary = useMemo(() => {
    const tot = entries.length;
    const done = entries.filter((e) => e.status === "success").length;
    const dup = entries.filter((e) => e.status === "duplicate").length;
    const err = entries.filter((e) => e.status === "error").length;
    const inflight = entries.filter(
      (e) => e.status === "queued" || e.status === "uploading" || e.status === "preflighting",
    ).length;
    const settled = tot - inflight;
    return { tot, done, dup, err, inflight, settled };
  }, [entries]);

  const allSettled = entries.length > 0 && summary.inflight === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        width="md"
        className="p-0 overflow-hidden max-h-[88vh] flex flex-col"
      >
        <DialogTitle className="sr-only">Upload test photo</DialogTitle>

        {/* Header. Mirrors the workshop-instrument register: small mono
            caps tag → bold short title → one line of how-it-works. */}
        <div className="px-6 pt-5 pb-3 shrink-0">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            <span
              className="h-px w-4 bg-[color:var(--color-border-strong)]"
              aria-hidden
            />
            Upload · auto-match
          </div>
          <h2 className="mt-1.5 text-[16px] font-semibold text-[color:var(--color-ink)]">
            Drop photos in, tests routed out
          </h2>
          <p className="mt-1 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed max-w-[52ch]">
            Drop a single photo or a batch. Each file's QR routes it to
            its test, the warp + sample run server-side, and identical
            re-uploads are caught by SHA-256 so the same photo can't
            silently land twice.
          </p>
        </div>

        <MetalBar variant="soft" />

        {/* Both modes get the device + phone tabs. The phone path only
            actually works when the desktop is on a network the phone
            can reach (i.e. not 127.0.0.1) — but exposing the QR
            unconditionally lets standalone-mode users on a LAN use
            their phone too, instead of being silently excluded. */}
        <div className="flex border-b border-[color:var(--color-border)] mb-0 px-5 pt-3 shrink-0">
          {(["device", "phone"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "px-4 h-9 text-[13px] " +
                (tab === t
                  ? "border-b-2 border-[color:var(--color-primary)] text-[color:var(--color-ink)] font-medium"
                  : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]")
              }
            >
              {t === "device" ? "From this device" : "From phone"}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {tab === "device" && (
            <>
              {entries.length === 0 ? (
                <DropZone
                  dragOver={dragOver}
                  onDragOver={(e) => {
                    if (isDemo) return;
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={isDemo ? (e) => e.preventDefault() : onDrop}
                  onClick={() => {
                    if (!isDemo) inputRef.current?.click();
                  }}
                  disabled={isDemo}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <ul className="flex flex-col gap-1.5">
                    {entries.map((entry) => (
                      <FileRow
                        key={entry.id}
                        entry={entry}
                        onRetry={() => retryEntry(entry.id)}
                        onRemove={() => removeEntry(entry.id)}
                        onClose={() => handleOpenChange(false)}
                      />
                    ))}
                  </ul>
                  <AddMoreRow
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(e) => {
                      if (isDemo) return;
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={isDemo ? (e) => e.preventDefault() : onDrop}
                    dragOver={dragOver}
                    disabled={isDemo}
                  />
                  <SummaryStrip
                    summary={summary}
                    allSettled={allSettled}
                    onClose={() => handleOpenChange(false)}
                  />
                </div>
              )}

              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onPick}
                disabled={isDemo}
              />
            </>
          )}

          {tab === "phone" && <MobileQrTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Drop zone (empty state) ──────────────────────────────────────── */

function DropZone({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  disabled,
}: {
  dragOver: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-disabled={disabled}
      title={disabled ? "Uploading photos is disabled in the demo." : undefined}
      className={cn(
        "relative rounded-[12px] border-[1.5px] border-dashed",
        "px-5 py-9 text-center",
        "transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        disabled
          ? "cursor-not-allowed opacity-60 border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)]"
          : dragOver
            ? "cursor-pointer border-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)]"
            : "cursor-pointer border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] hover:border-[color:var(--color-primary)]/60 hover:bg-[color:var(--color-primary-tint)]/40",
      )}
    >
      <div
        className={cn(
          "mx-auto h-12 w-12 rounded-full flex items-center justify-center",
          "bg-[color:var(--color-surface)] border border-[color:var(--color-border-strong)]",
          "transition-transform duration-200",
          dragOver && "scale-110",
        )}
      >
        <UploadCloud
          className="h-5 w-5 text-[color:var(--color-primary)]"
          strokeWidth={1.75}
        />
      </div>
      <div className="mt-3 text-[13.5px] font-medium text-[color:var(--color-ink)]">
        {dragOver ? "Drop to upload" : "Drop photos here, or click to browse"}
      </div>
      <div className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)]">
        Single or batch · JPEG / PNG / HEIC · processed locally
      </div>
      <div className="mt-5 flex items-center justify-center gap-3 text-[color:var(--color-ink-subtle)]">
        <StepIcon Icon={ImageIcon} label="Photo" />
        <StepArrow />
        <StepIcon Icon={QrCode} label="Decode QR" />
        <StepArrow />
        <StepIcon Icon={CheckCircle2} label="Match test" />
      </div>
    </div>
  );
}

function StepIcon({ Icon, label }: { Icon: typeof ImageIcon; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span className="font-mono text-[9px] tracking-[0.16em] uppercase">
        {label}
      </span>
    </div>
  );
}

function StepArrow() {
  return (
    <div
      aria-hidden
      className="w-6 h-px bg-[color:var(--color-border-strong)] mb-[14px]"
    />
  );
}

/* ─── File row ─────────────────────────────────────────────────────── */

function FileRow({
  entry,
  onRetry,
  onRemove,
  onClose,
}: {
  entry: FileEntry;
  onRetry: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const tone = rowTone(entry.status);
  const sizeKb = (entry.file.size / 1024).toFixed(0);
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-[8px] border bg-[color:var(--color-surface-elevated)]",
        "px-3 py-2",
        tone.border,
      )}
    >
      <FileThumb file={entry.file} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[11.5px] tabular-nums text-[color:var(--color-ink)] truncate">
            {entry.file.name}
          </span>
          <span className="font-mono text-[9.5px] tabular-nums text-[color:var(--color-ink-subtle)] shrink-0">
            {sizeKb} kB
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 min-h-[18px]">
          <RowStatus entry={entry} onClose={onClose} />
          <RowActions
            entry={entry}
            onRetry={onRetry}
            onRemove={onRemove}
          />
        </div>
      </div>
    </li>
  );
}

function rowTone(status: FileStatus): { border: string } {
  switch (status) {
    case "success":
      return { border: "border-[color:var(--color-success)]/45" };
    case "duplicate":
      return { border: "border-[color:var(--color-warning)]/55" };
    case "error":
      return { border: "border-[color:var(--color-destructive)]/55" };
    case "uploading":
    case "preflighting":
      return { border: "border-[color:var(--color-primary)]/45" };
    default:
      return { border: "border-[color:var(--color-border)]" };
  }
}

/** Each entry's status row. Clean line-1: a status pill on the left,
 *  context (test name / duplicate hint / error) on the right. The
 *  language is consistent across states so the user can scan a long
 *  list without re-parsing every row. */
function RowStatus({
  entry,
  onClose,
}: {
  entry: FileEntry;
  onClose: () => void;
}) {
  switch (entry.status) {
    case "queued":
      return <Pill tone="neutral">queued</Pill>;
    case "preflighting":
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-primary)]">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          reading QR…
        </span>
      );
    case "uploading":
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-primary)]">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          processing…
        </span>
      );
    case "success":
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-success)] truncate">
          <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
          test #{entry.testId} · {entry.testName ?? "loaded"}
          {entry.test && (
            <a
              href={formatRoute({ name: "test-detail", id: entry.test.id })}
              onClick={onClose}
              className="font-mono text-[10px] tracking-[0.06em] tabular-nums text-[color:var(--color-primary)]/85 hover:text-[color:var(--color-primary)] inline-flex items-center gap-0.5 ml-1"
            >
              open
              <ExternalLink className="h-2.5 w-2.5" strokeWidth={2} />
            </a>
          )}
        </span>
      );
    case "duplicate":
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-warning)]">
          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
          duplicate of result #{entry.duplicateOf}
        </span>
      );
    case "error":
      return (
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-destructive)] truncate"
          title={entry.errorMessage}
        >
          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
          {entry.errorMessage ?? "upload failed"}
        </span>
      );
  }
}

function RowActions({
  entry,
  onRetry,
  onRemove,
}: {
  entry: FileEntry;
  onRetry: () => void;
  onRemove: () => void;
}) {
  if (entry.status === "uploading" || entry.status === "preflighting") {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      {entry.status === "error" && (
        <RowIconButton onClick={onRetry} title="Retry upload" Icon={RotateCcw} />
      )}
      <RowIconButton
        onClick={onRemove}
        title="Remove from list"
        Icon={Trash2}
      />
    </span>
  );
}

function RowIconButton({
  onClick,
  title,
  Icon,
}: {
  onClick: () => void;
  title: string;
  Icon: typeof RotateCcw;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "h-5 w-5 rounded-[3px] inline-flex items-center justify-center",
        "text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60",
        "transition-colors",
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
    </button>
  );
}

/** Local thumbnail using a blob: URL — never sent across the network,
 *  cleaned up on unmount. Falls back to a generic icon when the URL
 *  fails (e.g. HEIC on browsers that can't decode it). */
function FileThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div
      className={cn(
        "h-9 w-9 shrink-0 rounded-[4px] overflow-hidden",
        "border border-[color:var(--color-border)] bg-[color:var(--color-surface)]",
        "flex items-center justify-center",
      )}
    >
      {!errored && url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <ImageIcon
          className="h-3.5 w-3.5 text-[color:var(--color-ink-subtle)]"
          strokeWidth={1.75}
        />
      )}
    </div>
  );
}

/* ─── Pills ────────────────────────────────────────────────────────── */

function Pill({
  tone,
  children,
}: {
  tone: "neutral";
  children: React.ReactNode;
}) {
  void tone; // single-tone for now; reserved for future statuses
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 h-4 rounded-[2px]",
        "font-mono text-[8.5px] font-semibold tracking-[0.18em] uppercase",
        "border border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)]",
        "bg-[color:var(--color-surface)]",
      )}
    >
      {children}
    </span>
  );
}

/* ─── Add-more affordance under the queue ──────────────────────────── */

function AddMoreRow({
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOver,
  disabled,
}: {
  onClick: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  dragOver: boolean;
  disabled?: boolean;
}) {
  // The drop-target props came from the empty-state DropZone (which is a
  // <div role="button">). Re-using them on a real <button> here means
  // casting the React event types — they're structurally identical for
  // our handlers, which only read ``preventDefault`` + ``dataTransfer``.
  type DivDragHandler = (e: React.DragEvent<HTMLDivElement>) => void;
  const dragOverBtn = onDragOver as unknown as React.DragEventHandler<HTMLButtonElement>;
  const dropBtn = onDrop as unknown as React.DragEventHandler<HTMLButtonElement>;
  void (null as DivDragHandler | null);
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onClick();
      }}
      onDragOver={dragOverBtn}
      onDragLeave={onDragLeave}
      onDrop={dropBtn}
      disabled={disabled}
      className={cn(
        "w-full mt-1 px-3 py-2 rounded-[6px] border-[1.5px] border-dashed",
        "font-mono text-[10.5px] tracking-[0.18em] uppercase font-semibold",
        "transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        disabled
          ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)]/60 cursor-not-allowed"
          : dragOver
            ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)]"
            : "border-[color:var(--color-border-strong)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)]/60 hover:text-[color:var(--color-ink)]",
      )}
    >
      + Add more · drop or click
    </button>
  );
}

/* ─── Summary footer ──────────────────────────────────────────────── */

function SummaryStrip({
  summary,
  allSettled,
  onClose,
}: {
  summary: {
    tot: number;
    done: number;
    dup: number;
    err: number;
    inflight: number;
    settled: number;
  };
  allSettled: boolean;
  onClose: () => void;
}) {
  const { tot, done, dup, err, inflight } = summary;
  return (
    <div
      className={cn(
        "mt-2 flex items-center justify-between gap-3",
        "px-3 py-2 rounded-[6px] bg-[color:var(--color-surface)]",
        "border border-[color:var(--color-border)]",
      )}
    >
      <div className="flex items-center gap-3 font-mono text-[10px] tabular-nums">
        <span className="text-[color:var(--color-ink-muted)]">
          {tot} file{tot === 1 ? "" : "s"}
        </span>
        <SummaryStat
          label="done"
          value={done}
          tone="success"
        />
        {dup > 0 && (
          <SummaryStat label="dup" value={dup} tone="warning" />
        )}
        {err > 0 && (
          <SummaryStat label="err" value={err} tone="destructive" />
        )}
        {inflight > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[color:var(--color-primary)]">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            {inflight} in flight
          </span>
        )}
      </div>
      <Button
        variant={allSettled ? "primary" : "ghost"}
        size="sm"
        onClick={onClose}
      >
        {allSettled ? "Done" : "Close"}
      </Button>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "destructive";
}) {
  if (value === 0) {
    return (
      <span className="text-[color:var(--color-ink-subtle)]">
        {value} {label}
      </span>
    );
  }
  const colour =
    tone === "success"
      ? "text-[color:var(--color-success)]"
      : tone === "warning"
        ? "text-[color:var(--color-warning)]"
        : "text-[color:var(--color-destructive)]";
  return (
    <span className={cn("font-semibold", colour)}>
      {value} {label}
    </span>
  );
}

/* ─── Error parsing ────────────────────────────────────────────────── */

interface ParsedError {
  kind: "duplicate" | "other";
  message: string;
  existingId?: number;
  uploadedAt?: string;
}

function parseErrorDetail(err: unknown): ParsedError {
  const raw = (err as Error)?.message ?? "";
  // ApiError surfaces "STATUS BODY" — try to recover the JSON detail
  // payload so we can read ``existing_result_id`` for duplicates.
  // Fallback to the trimmed message when the payload isn't JSON.
  const stripped = raw.replace(/^\d{3}\s+/, "").trim();
  try {
    const body = JSON.parse(stripped);
    const detail = body?.detail;
    if (detail && typeof detail === "object") {
      if (detail.kind === "duplicate_image") {
        return {
          kind: "duplicate",
          message: detail.message ?? "duplicate of existing result",
          existingId:
            typeof detail.existing_result_id === "number"
              ? detail.existing_result_id
              : undefined,
          uploadedAt:
            typeof detail.existing_uploaded_at === "string"
              ? detail.existing_uploaded_at
              : undefined,
        };
      }
      if (typeof detail.message === "string") {
        return { kind: "other", message: detail.message };
      }
    }
    if (typeof detail === "string") {
      return { kind: "other", message: detail };
    }
  } catch {
    /* not JSON — fall through */
  }
  // Drop the leading status code prefix we add on ApiError, if present.
  return {
    kind: "other",
    message: stripped || "Upload failed",
  };
}

