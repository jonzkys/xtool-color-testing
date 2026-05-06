import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { DialogClose } from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  MetalBar,
} from "../ui";
import { useAuthedImage } from "../hooks/useAuthedImage";
import { WBBadge } from "./WBBadge";
import type { ResultWBState } from "../types";

export interface ResultDebugDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resultId: number | null;
  /** Optional WB-correction state to render in the header / panel.
   *  Passed by the parent because the debug dialog itself only fetches
   *  debug-grade payloads — the parent already holds the full result. */
  wb?: ResultWBState | null;
}

/**
 * Debug view for a single result. Fires three classes of request:
 * a row count, the warped-with-grid overlay, and one strip image per
 * row (actual cell crop on top, captured swatch fill below). The row
 * images are lazy fetches the browser drives via <img> — same auth
 * pattern as the result-detail hero — so a 60-row test doesn't burn
 * pipeline cycles before the user scrolls.
 */
export function ResultDebugDialog({
  open,
  onOpenChange,
  resultId,
  wb,
}: ResultDebugDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {resultId !== null && <ResultDebugBody resultId={resultId} wb={wb} />}
    </Dialog>
  );
}

function ResultDebugBody({
  resultId,
  wb,
}: {
  resultId: number;
  wb?: ResultWBState | null;
}) {
  const wwgUrl = `/api/results/${resultId}/debug/warped-with-grid`;
  const wwgBlob = useAuthedImage(wwgUrl);

  const [rowCount, setRowCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRowCount(null);
    setError(null);
    (async () => {
      try {
        const r = await fetch(`/api/results/${resultId}/debug/row-count`);
        if (!r.ok) throw new Error(`row-count ${r.status}`);
        const data = await r.json();
        if (!cancelled) setRowCount(Number(data.rows));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [resultId]);

  return (
    <DialogContent
      width="lg"
      className="p-0 overflow-hidden max-w-[820px] max-h-[90vh] flex flex-col"
      aria-describedby={undefined}
    >
      <DialogTitle className="sr-only">
        Debug · Result #{resultId}
      </DialogTitle>

      <header className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--color-border)] shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
              Debug
            </div>
            <div className="font-mono text-[14px] text-[color:var(--color-ink)] mt-0.5">
              Result #{resultId}
            </div>
          </div>
          <WBBadge wb={wb} />
        </div>
        <DialogClose
          aria-label="Close"
          className="h-7 w-7 inline-flex items-center justify-center rounded-full text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </DialogClose>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Warped + grid overlay */}
        <section className="px-5 py-4">
          <div className="font-mono text-[9.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)] mb-2">
            Warped + sampling grid
          </div>
          {/* Warped capture is wider than tall, but with no height
              cap a wide modal stretched it to occupy most of the
              available 90vh and pushed the per-row strips below the
              fold. ``object-contain`` letterboxes inside the cap so
              the photograph keeps its aspect. */}
          <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-substrate)] overflow-hidden flex items-center justify-center">
            {wwgBlob ? (
              <img
                src={wwgBlob}
                alt="Warped capture with sampling grid overlaid"
                className="w-full max-h-[38vh] object-contain block"
              />
            ) : (
              <div className="h-[180px] w-full animate-pulse" />
            )}
          </div>
          {wb && wb.mode != null && wb.mode !== "disabled" && (
            <WBDiagnosticPanel wb={wb} />
          )}
        </section>

        <MetalBar variant="soft" />

        {/* Per-row actual vs captured strips */}
        <section className="px-5 py-4 flex flex-col gap-4">
          <div className="font-mono text-[9.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
            Actual vs captured · per row
          </div>
          {error && (
            <div className="text-[12px] text-[color:var(--color-destructive)]">
              {error}
            </div>
          )}
          {rowCount === null && !error && (
            <div className="text-[12px] text-[color:var(--color-ink-subtle)]">
              Loading…
            </div>
          )}
          {rowCount !== null && Array.from({ length: rowCount }, (_, i) => (
            <RowStrip key={i} resultId={resultId} row={i} />
          ))}
        </section>
      </div>
    </DialogContent>
  );
}

/**
 * Textual diagnostic readout for the WB pass: which canonical
 * calibration the capture matched, the measured anchor RGB, and the
 * per-channel correction (gain/gamma) applied. Hidden when the
 * pipeline didn't run WB. Hex anchors stay JSON-formatted for v1 — a
 * swatch-strip rendering is future work.
 */
function WBDiagnosticPanel({ wb }: { wb: ResultWBState }) {
  return (
    <div className="mt-4 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 font-mono text-[11px]">
      <div className="text-[10px] uppercase tracking-[0.22em] font-semibold text-[color:var(--color-ink-subtle)] mb-2">
        WB · {(wb.mode ?? "").toUpperCase()}
        {wb.canonical_id && (
          <span className="ml-2 normal-case tracking-[0.12em] text-[color:var(--color-ink-muted)]">
            {wb.canonical_id}
          </span>
        )}
      </div>
      {wb.anchor_rgb && (
        <div className="space-y-1">
          <div className="text-[color:var(--color-ink-muted)]">
            Measured anchor RGB
          </div>
          <pre className="text-[11px] text-[color:var(--color-ink)] whitespace-pre-wrap break-all">
            {JSON.stringify(wb.anchor_rgb, null, 2)}
          </pre>
        </div>
      )}
      {wb.correction && (
        <div className="mt-2 space-y-1">
          <div className="text-[color:var(--color-ink-muted)]">
            Per-channel correction
          </div>
          <pre className="text-[11px] text-[color:var(--color-ink)] whitespace-pre-wrap break-all">
            {JSON.stringify(wb.correction, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function RowStrip({ resultId, row }: { resultId: number; row: number }) {
  const url = `/api/results/${resultId}/debug/row/${row}`;
  const blob = useAuthedImage(url);
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-muted)] mb-1">
        Row {row + 1}
      </div>
      <div className="rounded-[4px] border border-[color:var(--color-border)] overflow-hidden bg-[color:var(--color-substrate)]">
        {blob ? (
          <img
            src={blob}
            alt={`Row ${row + 1} actual vs captured`}
            className="w-full h-auto block"
          />
        ) : (
          <div className="h-[60px] animate-pulse" />
        )}
      </div>
    </div>
  );
}
