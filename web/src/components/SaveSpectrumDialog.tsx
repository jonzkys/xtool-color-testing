import { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui";
import { createSpectrum } from "../api/savedSpectrums";
import type {
  SavedSpectrum,
  SavedSpectrumCoefficients,
  SavedSpectrumSwatch,
} from "../types";

export interface SaveSpectrumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (saved: SavedSpectrum) => void;

  /** Source test name + id for default name and the FK. */
  testName: string;
  testId: number;

  /** Axis bounds (the crop) and the swatches inside it. */
  axisParam: string;
  axisMin: number;
  axisMax: number;
  swatches: SavedSpectrumSwatch[];

  /** Fit details — already computed on the spectrum page. */
  fitDegree: 1 | 2 | 3;
  fitCoefficients: SavedSpectrumCoefficients;
  fitR2: { l: number; a: number; b: number };
  displayedProjection: string;
}

function defaultName(
  testName: string,
  axisParam: string,
  min: number,
  max: number,
): string {
  return `${testName} · ${axisParam} ${min}-${max}`;
}

export function SaveSpectrumDialog(props: SaveSpectrumDialogProps) {
  const {
    open,
    onOpenChange,
    onSaved,
    testName,
    testId,
    axisParam,
    axisMin,
    axisMax,
    swatches,
    fitDegree,
    fitCoefficients,
    fitR2,
    displayedProjection,
  } = props;

  const [name, setName] = useState(
    defaultName(testName, axisParam, axisMin, axisMax),
  );
  // Reset the name to the freshly-derived default whenever the dialog
  // opens, so the user gets a name that reflects the *current* crop
  // rather than whatever crop was active when the dialog first
  // mounted. The dialog itself stays mounted across opens.
  useEffect(() => {
    if (open) setName(defaultName(testName, axisParam, axisMin, axisMax));
  }, [open, testName, axisParam, axisMin, axisMax]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setSaving(true);
    setError(null);
    void createSpectrum({
      name: name.trim(),
      source_test_id: testId,
      axis_param: axisParam,
      axis_min: axisMin,
      axis_max: axisMax,
      fit_form: "polynomial",
      fit_degree: fitDegree,
      fit_coefficients: fitCoefficients,
      fit_r2: fitR2,
      displayed_projection: displayedProjection,
      swatches,
    })
      .then((saved) => {
        onSaved(saved);
        onOpenChange(false);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setSaving(false));
  }

  // Lab range covered by the saved swatches — read-only summary.
  const Ls = swatches.map((s) => s.lab[0]);
  const As = swatches.map((s) => s.lab[1]);
  const Bs = swatches.map((s) => s.lab[2]);
  const labSummary =
    swatches.length > 0
      ? `L ${Math.min(...Ls).toFixed(0)}–${Math.max(...Ls).toFixed(0)} · ` +
        `a ${Math.min(...As).toFixed(0)}..${Math.max(...As).toFixed(0)} · ` +
        `b ${Math.min(...Bs).toFixed(0)}..${Math.max(...Bs).toFixed(0)}`
      : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="md">
        <DialogHeader>
          <DialogTitle>Save spectrum</DialogTitle>
        </DialogHeader>

        <label className="block mb-3">
          <span className="block text-[11.5px] uppercase tracking-[0.12em] text-[color:var(--color-ink-muted)] mb-1">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-9 px-3 rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[14px]"
            aria-label="name"
          />
        </label>

        <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 mb-3 text-[12px]">
          <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
            <div className="text-[color:var(--color-ink-muted)]">Source</div>
            <div className="font-mono">
              Test #{testId} · {testName}
            </div>
            <div className="text-[color:var(--color-ink-muted)]">Axis</div>
            <div className="font-mono">
              {axisParam}: {axisMin} → {axisMax} ({swatches.length} points)
            </div>
            <div className="text-[color:var(--color-ink-muted)]">Fit</div>
            <div className="font-mono">
              polynomial · degree {fitDegree}
              <br />
              L* R² {fitR2.l.toFixed(3)} · a* R² {fitR2.a.toFixed(3)} · b* R²{" "}
              {fitR2.b.toFixed(3)}
            </div>
            <div className="text-[color:var(--color-ink-muted)]">Lab range</div>
            <div className="font-mono">{labSummary}</div>
          </div>
        </div>

        {error && (
          <div className="text-[12px] text-[color:var(--color-destructive)] mb-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving || name.trim().length === 0}
            onClick={handleSubmit}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
