import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
  IconButton,
  MetalBar,
  cn,
} from "../ui";
import { X } from "lucide-react";
import {
  getSeedPreview,
  runSeedImport,
  type SeedPreview,
  type SeedImportResult,
} from "../api/seed";
import { ApiError } from "../api/_fetch";

/**
 * Top-bar "Load demo" pill + confirmation modal. Wraps both so the
 * TopBar can mount this as a single unit alongside Upload / Guide /
 * Log.
 *
 * Visibility rules:
 *   • multi_user mode only — standalone has no seed account to copy.
 *   • current user must NOT be the seed user itself (cleanly
 *     reported by ``GET /api/me``'s ``is_seed_user`` flag).
 *
 * The TopBar gates rendering on ``mode === 'multi_user'`` before
 * mounting this component; the seed-user check is enforced here
 * via the ``isSeedUser`` prop so the component owns the "should I
 * show?" predicate and stays testable in isolation.
 *
 * After a successful import we dispatch a window event so other
 * panels that cache their own listings (Library, Palette, Tests,
 * etc.) can refetch — and as a belt-and-braces guarantee, the
 * post-success branch reloads the page once the success summary
 * has been visible for a beat.
 */
export interface SeedImportButtonProps {
  /** ``true`` iff the backend reports the current user is the
   *  configured seed account — in which case the pill is hidden.
   *  ``null`` means "unknown" (e.g. /api/me failed) and is treated
   *  as "show the pill" since the server will 400 cleanly. */
  isSeedUser?: boolean | null;
}

export function SeedImportButton({ isSeedUser = false }: SeedImportButtonProps) {
  const [open, setOpen] = useState(false);
  if (isSeedUser) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Copy curated demo data into your account"
        aria-label="Seed Data"
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-3 rounded-[6px]",
          "border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]",
          "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)]",
          "hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-primary-tint)]/40",
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        )}
      >
        <Download className="h-3.5 w-3.5 flex-none" strokeWidth={1.75} />
        <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold whitespace-nowrap">
          Seed Data
        </span>
      </button>
      <SeedImportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SeedImportDialog({ open, onOpenChange }: DialogProps) {
  // ── preview load (on open) ───────────────────────────────────────
  const [preview, setPreview] = useState<SeedPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── import flow ──────────────────────────────────────────────────
  const [confirmed, setConfirmed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<SeedImportResult | null>(null);

  // Reset everything each time the modal opens so a previous error
  // / success state doesn't leak into a fresh attempt.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setPreviewError(null);
    setConfirmed(false);
    setImporting(false);
    setImportError(null);
    setImported(null);
    setPreviewLoading(true);
    getSeedPreview()
      .then((p) => setPreview(p))
      .catch((err: unknown) => {
        setPreviewError(messageFromError(err));
      })
      .finally(() => setPreviewLoading(false));
  }, [open]);

  // Auto-close after a successful import. We leave a brief beat so
  // the success counts are visible before the modal disappears, and
  // dispatch a "seed:imported" event so the rest of the SPA can
  // refresh its caches.
  useEffect(() => {
    if (!imported) return;
    window.dispatchEvent(
      new CustomEvent("seed:imported", { detail: imported }),
    );
    const id = window.setTimeout(() => {
      onOpenChange(false);
      // The cheapest, most-robust cache-invalidation: reload. Pages
      // re-fetch on mount, so the user sees the new data.
      window.location.reload();
    }, 1500);
    return () => window.clearTimeout(id);
  }, [imported, onOpenChange]);

  const alreadyImported = preview?.already_imported ?? false;
  const hasData = preview?.src_has_data ?? false;

  function handleImport() {
    setImporting(true);
    setImportError(null);
    runSeedImport()
      .then((res) => setImported(res))
      .catch((err: unknown) => {
        setImportError(messageFromError(err));
        setImporting(false);
      });
  }

  // Don't let the user dismiss while the import is in-flight — the
  // request will keep running on the server even if they cancel,
  // and we want them to see the result.
  const canCancel = !importing;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !canCancel) return;
        onOpenChange(o);
      }}
    >
      <DialogContent width="md" className="p-0 overflow-hidden">
        {/* Masthead — mirrors WelcomeDialog's framing so the seed flow
            reads as a peer of the welcome / claim experience rather
            than a generic dialog. */}
        <div className="relative px-6 pt-5 pb-4 bg-[color:var(--color-surface-elevated)]">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.24em] uppercase text-[color:var(--color-ink-subtle)] mb-1.5">
                <span
                  className="h-px w-4 bg-[color:var(--color-border-strong)]"
                  aria-hidden
                />
                Seed transfer · curated bench
              </div>
              <DialogTitle className="text-[18px] font-semibold text-[color:var(--color-ink)] leading-tight">
                Import demo data
              </DialogTitle>
            </div>
            <DialogClose asChild>
              <IconButton
                aria-label="Close"
                variant="ghost"
                size="sm"
                icon={<X className="h-4 w-4" />}
              />
            </DialogClose>
          </div>
        </div>

        <MetalBar />

        <div className="p-5">
          {previewLoading && (
            <div className="flex items-center gap-2 text-[12px] text-[color:var(--color-ink-muted)] py-4 font-mono uppercase tracking-[0.14em]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Reading source bench…
            </div>
          )}

          {previewError && (
            <div className="text-[12px] text-[color:var(--color-destructive)] py-2 font-mono">
              {previewError}
            </div>
          )}

          {preview && imported && (
            <SuccessSummary result={imported} />
          )}

          {preview && !imported && alreadyImported && (
            <AlreadyImportedBody onClose={() => onOpenChange(false)} />
          )}

          {preview && !imported && !alreadyImported && !hasData && (
            <EmptySeedBody onClose={() => onOpenChange(false)} />
          )}

          {preview && !imported && !alreadyImported && hasData && (
            <ConfirmBody
              preview={preview}
              confirmed={confirmed}
              onConfirmedChange={setConfirmed}
              importing={importing}
              importError={importError}
              canCancel={canCancel}
              onCancel={() => onOpenChange(false)}
              onImport={handleImport}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({
  preview,
  confirmed,
  onConfirmedChange,
  importing,
  importError,
  canCancel,
  onCancel,
  onImport,
}: {
  preview: SeedPreview;
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
  importing: boolean;
  importError: string | null;
  canCancel: boolean;
  onCancel: () => void;
  onImport: () => void;
}) {
  return (
    <>
      <p className="text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed mb-4 max-w-[48ch]">
        Copies a curated dataset from the demo bench onto yours — materials,
        presets, tests, results, palette and saved spectrums. Existing data
        is untouched; counts below are net-new rows.
      </p>

      {/* Structured manifest — hairline rows, monospace labels in the
          tracking-heavy uppercase style used across the workbench. */}
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2 flex items-center gap-2">
        <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
        Manifest
      </div>
      <div className="border border-[color:var(--color-border)] rounded-[6px] bg-[color:var(--color-surface-elevated)] mb-4 divide-y divide-[color:var(--color-border)]">
        <CountRow label="Materials" value={preview.materials} />
        <CountRow label="Presets" value={preview.presets} />
        <CountRow label="Tests" value={preview.tests} />
        <CountRow label="Results" value={preview.results} />
        <CountRow label="Palette entries" value={preview.palette_entries} />
        <CountRow label="Saved spectrums" value={preview.saved_spectrums} />
      </div>

      <p className="text-[11px] text-[color:var(--color-ink-subtle)] leading-snug mb-4 font-mono uppercase tracking-[0.10em]">
        Image bytes duplicated — large imports may run for ~1 min.
      </p>

      <label
        className="flex items-start gap-2 mb-5 select-none cursor-pointer"
        data-row="confirm"
      >
        <input
          type="checkbox"
          checked={confirmed}
          disabled={importing}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-[3px]"
          aria-label="I understand this will add rows to my account"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] leading-snug">
          Add rows to my bench
          <span className="block text-[9px] text-[color:var(--color-ink-subtle)] tracking-normal normal-case mt-0.5">
            I understand this writes to my account.
          </span>
        </span>
      </label>

      {importError && (
        <div className="text-[12px] text-[color:var(--color-destructive)] mb-3 font-mono">
          {importError}
        </div>
      )}

      <div className="flex justify-end gap-2 items-center">
        <Button variant="ghost" disabled={!canCancel} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!confirmed || importing}
          onClick={onImport}
        >
          {importing ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Transferring…
            </span>
          ) : (
            "Import →"
          )}
        </Button>
      </div>
    </>
  );
}

function AlreadyImportedBody({ onClose }: { onClose: () => void }) {
  return (
    <>
      <p className="text-[12.5px] text-[color:var(--color-ink-muted)] mb-5 leading-relaxed max-w-[48ch]">
        You've already imported demo data on this bench. Delete the imported
        rows from your library to re-import.
      </p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}

function EmptySeedBody({ onClose }: { onClose: () => void }) {
  return (
    <>
      <p className="text-[12.5px] text-[color:var(--color-ink-muted)] mb-5 leading-relaxed">
        Source bench is empty — nothing to import.
      </p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}

function SuccessSummary({ result }: { result: SeedImportResult }) {
  return (
    <div
      role="status"
      className="rounded-[6px] border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/40 p-4"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.20em] text-[color:var(--color-primary)] mb-2 flex items-center gap-2">
        <span className="h-px w-4 bg-[color:var(--color-primary)]/60" aria-hidden />
        Transfer complete
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] uppercase tracking-[0.10em] text-[color:var(--color-ink-muted)]">
        <span className="flex items-baseline justify-between">
          <span>Materials</span>
          <span className="tabular-nums text-[color:var(--color-ink)] font-semibold">{result.materials}</span>
        </span>
        <span className="flex items-baseline justify-between">
          <span>Presets</span>
          <span className="tabular-nums text-[color:var(--color-ink)] font-semibold">{result.presets}</span>
        </span>
        <span className="flex items-baseline justify-between">
          <span>Tests</span>
          <span className="tabular-nums text-[color:var(--color-ink)] font-semibold">{result.tests}</span>
        </span>
        <span className="flex items-baseline justify-between">
          <span>Results</span>
          <span className="tabular-nums text-[color:var(--color-ink)] font-semibold">{result.results}</span>
        </span>
        <span className="flex items-baseline justify-between">
          <span>Palette</span>
          <span className="tabular-nums text-[color:var(--color-ink)] font-semibold">{result.palette_entries}</span>
        </span>
        <span className="flex items-baseline justify-between">
          <span>Spectrums</span>
          <span className="tabular-nums text-[color:var(--color-ink)] font-semibold">{result.saved_spectrums}</span>
        </span>
      </div>
      {result.image_warnings.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[color:var(--color-primary)]/20 text-[10px] font-mono uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)]">
          {result.image_warnings.length} image bytes missing on source — skipped.
        </div>
      )}
    </div>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between px-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-muted)]">
        {label}
      </span>
      <span className="font-mono tabular-nums text-[12.5px] text-[color:var(--color-ink)] font-semibold">
        {value}
      </span>
    </div>
  );
}

function messageFromError(err: unknown): string {
  if (err instanceof ApiError) {
    // The server body is JSON like ``{"detail": "..."}``. Try to pull
    // the detail; fall back to the raw body / generic message.
    try {
      const parsed = JSON.parse(err.body) as { detail?: string };
      if (parsed.detail) return parsed.detail;
    } catch {
      /* not JSON — fall through */
    }
    return err.message || `${err.status} error`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error";
}
