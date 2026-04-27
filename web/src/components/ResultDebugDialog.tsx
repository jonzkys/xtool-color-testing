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

export interface ResultDebugDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resultId: number | null;
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
}: ResultDebugDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {resultId !== null && <ResultDebugBody resultId={resultId} />}
    </Dialog>
  );
}

function ResultDebugBody({ resultId }: { resultId: number }) {
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
        <div>
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
            Debug
          </div>
          <div className="font-mono text-[14px] text-[color:var(--color-ink)] mt-0.5">
            Result #{resultId}
          </div>
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
          <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-substrate)] overflow-hidden">
            {wwgBlob ? (
              <img
                src={wwgBlob}
                alt="Warped capture with sampling grid overlaid"
                className="w-full h-auto block"
              />
            ) : (
              <div className="h-[200px] animate-pulse" />
            )}
          </div>
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
