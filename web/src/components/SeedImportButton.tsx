import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  cn,
} from "../ui";
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
        aria-label="Load demo data"
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px]",
          "border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]",
          "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)]",
          "hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-primary-tint)]/40",
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        )}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold">
          Load demo
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
      <DialogContent width="md">
        <DialogHeader>
          <DialogTitle>Import demo data</DialogTitle>
        </DialogHeader>

        {previewLoading && (
          <div className="flex items-center gap-2 text-[12px] text-[color:var(--color-ink-muted)] py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading preview…
          </div>
        )}

        {previewError && (
          <div className="text-[12px] text-[color:var(--color-destructive)] py-2">
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
      <p className="text-[13px] text-[color:var(--color-ink)] mb-3">
        This will copy data from the demo account into your account.
      </p>

      <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 mb-3">
        <CountRow label="materials" value={preview.materials} />
        <CountRow label="presets" value={preview.presets} />
        <CountRow label="tests" value={preview.tests} />
        <CountRow label="results" value={preview.results} />
        <CountRow label="palette entries" value={preview.palette_entries} />
        <CountRow label="saved spectrums" value={preview.saved_spectrums} />
      </div>

      <p className="text-[11.5px] text-[color:var(--color-ink-muted)] leading-snug mb-4">
        Counts above are new rows that will be added to your account.
        Existing data is untouched. Image bytes are duplicated — this may
        take a minute on a large import.
      </p>

      <label className="flex items-start gap-2 mb-4 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={importing}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5"
          aria-label="I understand this will add rows to my account"
        />
        <span className="text-[12.5px] text-[color:var(--color-ink)]">
          I understand this will add rows to my account
        </span>
      </label>

      {importError && (
        <div className="text-[12px] text-[color:var(--color-destructive)] mb-2">
          {importError}
        </div>
      )}

      <div className="flex justify-end gap-2">
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
              Importing… (this can take a minute)
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
      <p className="text-[13px] text-[color:var(--color-ink)] mb-4">
        You've already imported demo data. Delete the imported rows to
        re-import.
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
      <p className="text-[13px] text-[color:var(--color-ink)] mb-4">
        Demo account has no data to import.
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
      className="rounded-[6px] border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/40 p-3 text-[13px] text-[color:var(--color-ink)]"
    >
      <div className="font-semibold mb-1">Import complete.</div>
      <div className="text-[12px] text-[color:var(--color-ink-muted)]">
        Imported {result.materials} materials, {result.presets} presets,{" "}
        {result.tests} tests, {result.results} results,{" "}
        {result.palette_entries} palette entries, {result.saved_spectrums}{" "}
        saved spectrums.
      </div>
      {result.image_warnings.length > 0 && (
        <div className="mt-2 text-[11.5px] text-[color:var(--color-ink-muted)]">
          {result.image_warnings.length} image bytes were missing on the
          source and weren't copied.
        </div>
      )}
    </div>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 text-[12.5px]">
      <span className="text-[color:var(--color-ink-muted)]">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
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
