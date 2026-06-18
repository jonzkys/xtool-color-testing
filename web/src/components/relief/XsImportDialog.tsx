/**
 * Relief — ".xs import" picker.
 *
 * Shown after an ``.xs`` workspace is dropped on the Relief uploader (when it
 * holds 2+ depth-map jobs, or none). Lists each relief/emboss BITMAP job as a
 * thumbnail + type + size; clicking one loads it into the cleaner. With no
 * jobs it shows an error instead. The exactly-one case never reaches here — the
 * page imports it directly.
 */

import { useEffect, useMemo } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui";
import { pngBlob, type XsDepthJob } from "../../lib/relief/xsImport";

export interface XsImportDialogProps {
  open: boolean;
  jobs: XsDepthJob[];
  onPick: (job: XsDepthJob) => void;
  onCancel: () => void;
}

/** Friendly label for a job's processing type. */
function typeLabel(t: XsDepthJob["processingType"]): string {
  return t === "RELIEF" ? "Emboss · RELIEF" : "Relief · INTAGLIO";
}

export function XsImportDialog({ open, jobs, onPick, onCancel }: XsImportDialogProps) {
  // One object URL per job thumbnail; revoked when the set changes / unmounts.
  const urls = useMemo(
    () => jobs.map((j) => URL.createObjectURL(pngBlob(j.pngBytes))),
    [jobs],
  );
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const empty = jobs.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent width={empty ? "sm" : "lg"}>
        <DialogHeader>
          <DialogTitle>{empty ? "No depth maps found" : "Pick a depth map"}</DialogTitle>
          <DialogDescription>
            {empty
              ? "This .xs has no emboss or relief (depth-map) jobs to import."
              : "Choose a relief / emboss job to load into the cleaner."}
          </DialogDescription>
        </DialogHeader>

        {empty ? (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Close
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {jobs.map((job, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onPick(job)}
                className="group flex flex-col overflow-hidden rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-left transition-colors hover:border-[color:var(--color-primary)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/50"
              >
                <div
                  className="flex aspect-square items-center justify-center"
                  style={{
                    backgroundColor: "var(--color-bg)",
                    backgroundImage:
                      "repeating-conic-gradient(var(--color-border) 0% 25%, transparent 0% 50%)",
                    backgroundSize: "14px 14px",
                  }}
                >
                  <img
                    src={urls[i]}
                    alt={job.name}
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="flex flex-col gap-0.5 px-2.5 py-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-primary)]">
                    {typeLabel(job.processingType)}
                  </span>
                  <span className="truncate text-[12.5px] text-[color:var(--color-ink)]">
                    {job.name}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
                    {Math.round(job.widthMm)} × {Math.round(job.heightMm)} mm
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
