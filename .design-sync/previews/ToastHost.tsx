import { useEffect } from "react";
import { Badge, Card, ToastHost, notify } from "xcs-gen-web";

/** Stand-in for the page the host overlays — toasts are always on top of work. */
function WorkbenchBackdrop() {
  return (
    <Card className="max-w-[420px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink)]">
          Hatch passes
        </span>
        <Badge variant="accent" size="sm">2 passes</Badge>
      </div>
      <div className="mt-3 flex flex-col gap-1 font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
        <span>Pass 1 · 45° · 0.12 mm · Brass 3.0mm</span>
        <span>Pass 2 · 135° · 0.08 mm · Brass 3.0mm</span>
      </div>
    </Card>
  );
}

export function InfoAndError() {
  useEffect(() => {
    notify("Generated hatch-passes.xcs — 841 shapes, 2 passes.", "info");
    notify("Pass 2 spacing (0.08 mm) is below the measured kerf width.", "error");
  }, []);
  return (
    <>
      <WorkbenchBackdrop />
      <ToastHost />
    </>
  );
}

export function InfoOnly() {
  useEffect(() => {
    notify("Burn test sheet queued for F2 Ultra.", "info");
    notify("Ingested 48 swatches into the validated palette.", "info");
  }, []);
  return (
    <>
      <WorkbenchBackdrop />
      <ToastHost />
    </>
  );
}

export function MultilineError() {
  useEffect(() => {
    notify(
      "Export failed — Studio drops single paths past ~1,570 points.\nSpiral arm 3 is 1,884 points; split it before exporting.",
      "error",
    );
  }, []);
  return (
    <>
      <WorkbenchBackdrop />
      <ToastHost />
    </>
  );
}

export function AtCapacity() {
  useEffect(() => {
    notify("Uploaded burn-sheet-1042.jpg.", "info");
    notify("Fiducials found — 4 / 4, reprojection 0.31 px.", "info");
    notify("White balance fell back to chromaticity-only.", "error");
    notify("Ingested 48 swatches into the validated palette.", "info");
    notify("Cell 6×3 rejected — cross-run burn σ 1.87.", "error");
  }, []);
  return (
    <>
      <WorkbenchBackdrop />
      <ToastHost />
    </>
  );
}
