import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Image as ImageIcon, Loader2, QrCode, UploadCloud } from "lucide-react";
import { preflightUpload, uploadResultAuto, type UploadPreflight } from "../api/results";
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
import { getHealth } from "../api/users";

type Tab = "device" | "phone";

type State =
  | { kind: "idle" }
  | { kind: "preflighting"; fileName: string }
  | {
      kind: "confirm";
      fileName: string;
      file: File;
      preflight: UploadPreflight;
    }
  | { kind: "uploading"; fileName: string }
  | {
      kind: "success";
      result: ResultRecord;
      test: TestRecord | null;
      fileName: string;
    }
  | { kind: "error"; message: string };

export function UploadResultDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isDemo = useIsDemo();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>("device");
  const [mode, setMode] = useState<"standalone" | "multi_user" | null>(null);

  useEffect(() => {
    getHealth()
      .then((h) => setMode(
        h.mode === "standalone" ? "standalone" : "multi_user",
      ))
      .catch(() => setMode("standalone"));  // Fail closed: hide the tab.
  }, []);

  const handleOpenChange = useCallback(
    (o: boolean) => {
      if (!o) {
        setState({ kind: "idle" });
        setDragOver(false);
      }
      onOpenChange(o);
    },
    [onOpenChange],
  );

  // Full-processing upload (after preflight, or after user confirms re-processing).
  const runUpload = useCallback(async (file: File) => {
    setState({ kind: "uploading", fileName: file.name });
    try {
      const result = await uploadResultAuto(file);
      let test: TestRecord | null = null;
      try {
        test = await getTest(result.test_id);
      } catch {
        /* non-fatal; we still have the result */
      }
      // Tell any open page (TestDetailPage's ResultsPanel, in
      // particular) that a new result exists for this test, so it can
      // refetch without waiting for a hash navigation. Without this,
      // the user sees "Open test" succeed but the page doesn't show
      // the new result when they're already there.
      window.dispatchEvent(new CustomEvent("result:refetch", {
        detail: { testId: result.test_id },
      }));
      setState({ kind: "success", result, test, fileName: file.name });
    } catch (e) {
      setState({ kind: "error", message: errorText(e) });
    }
  }, []);

  // Entry point: preflight first so we can warn when the test already
  // has uploads. If it's fresh, we skip straight to the full upload.
  const start = useCallback(
    async (file: File) => {
      setState({ kind: "preflighting", fileName: file.name });
      try {
        const preflight = await preflightUpload(file);
        if (preflight.existing_result_count > 0) {
          setState({ kind: "confirm", fileName: file.name, file, preflight });
          return;
        }
        await runUpload(file);
      } catch (e) {
        setState({ kind: "error", message: errorText(e) });
      }
    },
    [runUpload],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void start(file);
    },
    [start],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void start(file);
      e.target.value = "";
    },
    [start],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent width="md" className="p-0 overflow-hidden">
        <DialogTitle className="sr-only">Upload test photo</DialogTitle>

        <div className="px-6 pt-5 pb-3">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            <span
              className="h-px w-4 bg-[color:var(--color-border-strong)]"
              aria-hidden
            />
            Upload · auto-match
          </div>
          <h2 className="mt-1.5 text-[16px] font-semibold text-[color:var(--color-ink)]">
            Photograph in, test routed out
          </h2>
          <p className="mt-1 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed max-w-[44ch]">
            Drop a photo of a burned test sheet. The server reads the QR,
            figures out which test it belongs to, warps the image, and
            samples every swatch.
          </p>
        </div>

        <MetalBar variant="soft" />

        {mode === "multi_user" && (
          <div className="flex border-b border-[color:var(--color-border)] mb-0 px-5 pt-3">
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
        )}

        <div className="p-5">
          {(tab === "device" || mode !== "multi_user") && (
            <>
              {state.kind === "idle" && (
                <DropZone
                  dragOver={dragOver}
                  onDragOver={(e) => {
                    if (isDemo) return;
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={isDemo ? (e) => e.preventDefault() : onDrop}
                  onClick={() => { if (!isDemo) inputRef.current?.click(); }}
                  disabled={isDemo}
                />
              )}

              {state.kind === "preflighting" && (
                <UploadingState
                  fileName={state.fileName}
                  label="Reading QR…"
                  steps={["Scan", "Detect test"]}
                />
              )}

              {state.kind === "confirm" && (
                <ConfirmReprocessState
                  preflight={state.preflight}
                  fileName={state.fileName}
                  onConfirm={() => runUpload(state.file)}
                  onCancel={() => setState({ kind: "idle" })}
                />
              )}

              {state.kind === "uploading" && (
                <UploadingState fileName={state.fileName} />
              )}

              {state.kind === "success" && (
                <SuccessState
                  result={state.result}
                  test={state.test}
                  fileName={state.fileName}
                  onClose={() => handleOpenChange(false)}
                  onAnother={() => setState({ kind: "idle" })}
                />
              )}

              {state.kind === "error" && (
                <ErrorState
                  message={state.message}
                  onRetry={() => setState({ kind: "idle" })}
                />
              )}

              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPick}
                disabled={isDemo}
              />
            </>
          )}

          {tab === "phone" && mode === "multi_user" && <MobileQrTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* --- States --------------------------------------------------------- */

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
        {dragOver ? "Drop to upload" : "Drop a photo here, or click to browse"}
      </div>
      <div className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)]">
        JPEG, PNG, HEIC · processed locally
      </div>

      {/* Step pictograph — reinforces what will happen server-side. */}
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

function StepIcon({
  Icon,
  label,
}: {
  Icon: typeof ImageIcon;
  label: string;
}) {
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

function UploadingState({
  fileName,
  label = "Processing…",
  steps = ["Decode", "Warp", "Sample"],
}: {
  fileName: string;
  label?: string;
  steps?: string[];
}) {
  return (
    <div className="rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-5 py-7 text-center">
      <div className="mx-auto h-12 w-12 rounded-full flex items-center justify-center bg-[color:var(--color-surface)] border border-[color:var(--color-border-strong)]">
        <Loader2
          className="h-5 w-5 text-[color:var(--color-primary)] animate-spin"
          strokeWidth={1.75}
        />
      </div>
      <div className="mt-3 text-[13.5px] font-medium text-[color:var(--color-ink)]">
        {label}
      </div>
      <div className="mt-1 font-mono text-[11.5px] text-[color:var(--color-ink-muted)] truncate">
        {fileName}
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
        {steps.map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            <span>{s}</span>
            {i < steps.length - 1 && (
              <span className="h-px w-4 bg-[color:var(--color-border-strong)]" />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function ConfirmReprocessState({
  preflight,
  fileName,
  onConfirm,
  onCancel,
}: {
  preflight: UploadPreflight;
  fileName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const n = preflight.existing_result_count;
  return (
    <div className="rounded-[12px] border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-tint)] px-5 py-5">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-warning)]/35 flex items-center justify-center shrink-0">
          <AlertTriangle
            className="h-4 w-4 text-[color:var(--color-warning)]"
            strokeWidth={2}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-[color:var(--color-ink)]">
            Test already has {n} upload{n === 1 ? "" : "s"}
          </div>
          <p className="mt-1 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
            This QR matches{" "}
            <span className="font-semibold text-[color:var(--color-ink)]">
              #{preflight.test_id} · {preflight.test_name}
            </span>
            . Processing another photo appends a new result; averaged
            swatches will recompute across all non-excluded uploads.
          </p>
          <div className="mt-1 font-mono text-[10.5px] tracking-[0.06em] text-[color:var(--color-ink-subtle)] truncate">
            {fileName}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={onConfirm}>
          Process anyway
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function errorText(e: unknown): string {
  const raw = (e as Error)?.message ?? "";
  // Strip the "400 " / "404 " status prefix our fetch wrapper adds.
  const msg = raw.replace(/^\d{3}\s+/, "").trim();
  return msg || "Upload failed";
}

function SuccessState({
  result,
  test,
  fileName,
  onClose,
  onAnother,
}: {
  result: ResultRecord;
  test: TestRecord | null;
  fileName: string;
  onClose: () => void;
  onAnother: () => void;
}) {
  const testHref = formatRoute({ name: "test-detail", id: result.test_id });
  const sampled = result.swatches.length;
  const sigmaMean = useMemo(() => {
    if (result.swatches.length === 0) return 0;
    const sum = result.swatches.reduce(
      (acc, s) => acc + (Number.isFinite(s.sigma) ? s.sigma : 0),
      0,
    );
    return sum / result.swatches.length;
  }, [result.swatches]);

  return (
    <div>
      <div className="rounded-[12px] border border-[color:var(--color-success)]/30 bg-[color:var(--color-success-tint)] px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-success)]/30 flex items-center justify-center shrink-0">
            <CheckCircle2
              className="h-4 w-4 text-[color:var(--color-success)]"
              strokeWidth={2}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-[color:var(--color-ink)]">
              Matched to test #{result.test_id}
              {test && (
                <span className="ml-1.5 text-[color:var(--color-ink-muted)] font-normal">
                  · {test.name}
                </span>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-[color:var(--color-ink-muted)] truncate">
              {fileName}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 divide-x divide-[color:var(--color-border)] rounded-[8px] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
          <Stat label="Swatches" value={String(sampled)} />
          <Stat
            label="Mean σ"
            value={sigmaMean > 0 ? sigmaMean.toFixed(2) : "—"}
          />
          <Stat label="Result" value={`#${result.id}`} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={testHref}
            onClick={(e) => {
              // If we're already on the test's page the hash won't
              // change and no hashchange event fires — the click
              // becomes a no-op visually. The result:refetch event
              // dispatched on upload success has already updated the
              // underlying ResultsPanel, so closing the dialog is
              // the right behaviour.
              if (window.location.hash === testHref) {
                e.preventDefault();
              }
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-[6px] bg-[color:var(--color-primary)] text-white font-medium text-[13px] no-underline hover:bg-[color:var(--color-primary-hover)] transition-colors"
          >
            Open test
          </a>
          <Button variant="ghost" size="sm" onClick={onAnother}>
            Upload another
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5">
      <div className="font-mono text-[9px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14px] tabular-nums text-[color:var(--color-ink)]">
        {value}
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div>
      <div className="rounded-[12px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-destructive)]/30 flex items-center justify-center shrink-0">
            <AlertCircle
              className="h-4 w-4 text-[color:var(--color-destructive)]"
              strokeWidth={2}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-[color:var(--color-destructive)]">
              Couldn’t match this photo
            </div>
            <p className="mt-1 text-[12.5px] text-[color:var(--color-ink)] leading-relaxed">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Try another photo
          </Button>
        </div>
      </div>
    </div>
  );
}
