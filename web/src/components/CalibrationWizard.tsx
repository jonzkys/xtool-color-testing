import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ImageDown,
  Target,
  X,
} from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  Field,
  Input,
  notify,
} from "../ui";
import {
  downloadCalibrationXcs,
  measureCalibrationPhoto,
  submitCalibrationMeasurement,
} from "../api/wbCalibration";
import { hexToRgb, rgbToHex } from "../color/math";
import type { CalibrationPatchSpec } from "../types";

/**
 * Multi-step modal that walks the user through:
 *
 *   1. burn — download a calibration .xcs and run it on the machine
 *   2. shoot — upload a photo of the burned plate (kept as a thumb)
 *   3. measure — type or pick the colour for each patch from the photo
 *   4. record — POST measurements to the backend, show success
 *
 * No in-browser auto-detection in v1 — manual entry is the path.
 * Keeps the loop tight for users who already have a colour picker
 * (or just an eyeballed hex) handy.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Convert a measured-RGB tuple from the auto-measure endpoint
 *  (floats in 0–255, possibly fractional) into the hex form the
 *  step-3 inputs expect. */
function rgbTupleToHex(rgb: [number, number, number] | number[]): string {
  return rgbToHex(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0);
}

type Step = 1 | 2 | 3 | 4;

interface MeasurementRow {
  label: string;
  hex: string;
}

export interface CalibrationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialId: number;
  materialName: string;
  patches: CalibrationPatchSpec[];
  /** Called after a successful measurement save so the parent can
   *  re-fetch and refresh the canonical-RGB swatches. */
  onComplete?: () => void;
}

export function CalibrationWizard({
  open,
  onOpenChange,
  materialId,
  materialName,
  patches,
  onComplete,
}: CalibrationWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [downloading, setDownloading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [rows, setRows] = useState<MeasurementRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoMeasuring, setAutoMeasuring] = useState(false);
  // Set when the server-side auto-measure couldn't lock onto fiducials
  // → step 3 falls back to manual entry with a banner explaining why.
  const [autoMeasureNote, setAutoMeasureNote] = useState<string | null>(null);

  // Reset step + transient flags ONLY on the open false→true transition.
  // ``patches`` may change reference mid-flow (after step 4 saves and
  // the parent re-fetches the material's calibration) — re-running
  // setStep(1) on every patches change would yank the user back to
  // step 1 right after they finished the wizard.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current) {
      setStep(1);
      setError(null);
      setConfirmAbandon(false);
      setAutoMeasureNote(null);
      wasOpenRef.current = true;
    }
    // Re-align rows to the current patch list every time it changes
    // (labels can be edited upstream). Carry over any hex match by label.
    setRows((prev) => {
      const byLabel = new Map(prev.map((r) => [r.label, r.hex]));
      return patches.map((p) => ({
        label: p.label,
        hex: byLabel.get(p.label) ?? "",
      }));
    });
  }, [open, patches]);

  // Free the object URL when we're done with it, otherwise we leak
  // a blob:// reference per upload.
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const stepLabel = STEP_LABELS[step - 1];
  const allMeasured =
    rows.length > 0 && rows.every((r) => HEX_RE.test(r.hex));
  const monotonicWarning = useMemo(
    () => detectMonotonicWarning(rows),
    [rows],
  );

  function dirtyEnoughToConfirm(): boolean {
    if (step >= 4) return false;
    if (photoUrl) return true;
    if (rows.some((r) => r.hex.trim() !== "")) return true;
    return false;
  }

  function attemptClose() {
    if (saving) return;
    if (dirtyEnoughToConfirm()) {
      setConfirmAbandon(true);
      return;
    }
    onOpenChange(false);
  }

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      await downloadCalibrationXcs(materialId, materialName);
      notify("Calibration .xcs downloaded.", "info");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  function handlePhoto(file: File) {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
    void autoMeasure(file);
  }

  /** Hand the photo to the backend's measure-photo endpoint, which warps
   *  it to burn-space using the QR/ArUco fiducials and samples each
   *  patch's centre. On success, prefill the step-3 hex inputs. On
   *  failure (markers undetectable, decode error), surface a banner and
   *  fall back to manual entry. */
  async function autoMeasure(file: File) {
    setAutoMeasuring(true);
    setAutoMeasureNote(null);
    try {
      const result = await measureCalibrationPhoto(materialId, file);
      const byLabel = new Map(
        result.measurements.map((m) => [m.label, m.measured_rgb]),
      );
      setRows((prev) =>
        prev.map((r) => {
          const rgb = byLabel.get(r.label);
          if (!rgb) return r;
          return { ...r, hex: rgbTupleToHex(rgb) };
        }),
      );
      setAutoMeasureNote(
        "Auto-measured from the photo — adjust any swatch that looks off.",
      );
    } catch (e) {
      setAutoMeasureNote(
        `Couldn't auto-measure (${(e as Error).message}). Enter values manually.`,
      );
    } finally {
      setAutoMeasuring(false);
    }
  }

  function setRowHex(idx: number, hex: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, hex } : r)),
    );
  }

  async function handleSave() {
    if (!allMeasured) return;
    setSaving(true);
    setError(null);
    try {
      const measurements = rows
        .filter((r) => HEX_RE.test(r.hex))
        .map((r) => ({
          label: r.label,
          measured_rgb: hexToRgb(r.hex),
        }));
      await submitCalibrationMeasurement(materialId, { measurements });
      setStep(4);
      onComplete?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          attemptClose();
          return;
        }
        onOpenChange(true);
      }}
    >
      <DialogContent
        width="md"
        className="p-0 max-w-[480px] flex flex-col"
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => {
          if (saving) {
            e.preventDefault();
            return;
          }
          if (dirtyEnoughToConfirm()) {
            e.preventDefault();
            setConfirmAbandon(true);
          }
        }}
        onPointerDownOutside={(e) => {
          if (saving || dirtyEnoughToConfirm()) e.preventDefault();
        }}
      >
        {/* Header — step indicator in the workshop register. */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--color-border)] shrink-0">
          <div>
            <div className="font-mono text-[9.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
              Step {step} of 4 · {stepLabel}
            </div>
            <DialogTitle className="text-[16px] mt-0.5 block">
              {STEP_HEADINGS[step - 1]}
            </DialogTitle>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={attemptClose}
            className="h-7 w-7 inline-flex items-center justify-center rounded-full text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        {/* Step indicator track. */}
        <div className="flex items-center gap-1.5 px-5 pt-3">
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              aria-hidden="true"
              className={cn(
                "h-[3px] flex-1 rounded-full transition-colors",
                n <= step
                  ? "bg-[color:var(--color-primary)]"
                  : "bg-[color:var(--color-border)]",
              )}
            />
          ))}
        </div>

        <div className="flex flex-col gap-4 p-5">
          {step === 1 && (
            <StepGenerate
              materialName={materialName}
              downloading={downloading}
              onDownload={handleDownload}
              onContinue={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepPhoto
              photoUrl={photoUrl}
              onPhoto={handlePhoto}
              onContinue={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <StepMeasure
              rows={rows}
              photoUrl={photoUrl}
              monotonicWarning={monotonicWarning}
              onChange={setRowHex}
              allMeasured={allMeasured}
              saving={saving}
              onSave={handleSave}
              autoMeasuring={autoMeasuring}
              autoMeasureNote={autoMeasureNote}
            />
          )}
          {step === 4 && (
            <StepDone
              rows={rows}
              onClose={() => onOpenChange(false)}
            />
          )}

          {error && (
            <div
              className={cn(
                "rounded-[6px] border border-[color:var(--color-destructive)]/30",
                "bg-[color:var(--color-destructive-tint)] px-3 py-2",
                "text-[12.5px] text-[color:var(--color-destructive)]",
              )}
            >
              {error}
            </div>
          )}

          {/* Back link — only on steps 2-4, hidden on the success step
              once the user has clicked Done implicitly. */}
          {step > 1 && step < 4 && (
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-[color:var(--color-border)] -mx-5 px-5 -mb-5 pb-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => setStep((s) => (s === 1 ? 1 : ((s - 1) as Step)))}
                className="gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
                Back
              </Button>
              <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
                {materialName}
              </span>
            </div>
          )}
        </div>

        {/* Abandon-confirm overlay. */}
        {confirmAbandon && (
          <div
            className={cn(
              "absolute inset-0 z-10 flex items-center justify-center p-5",
              "bg-[color:var(--color-surface)]/95 backdrop-blur-[2px]",
              "rounded-[14px]",
            )}
          >
            <div className="rounded-[8px] border border-[color:var(--color-destructive)]/40 bg-[color:var(--color-destructive-tint)] p-4 max-w-[360px] flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="h-4 w-4 mt-0.5 text-[color:var(--color-destructive)]"
                  strokeWidth={2.2}
                />
                <p className="text-[13px] text-[color:var(--color-destructive)] leading-snug">
                  Abandon calibration? Measurements will be discarded.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmAbandon(false)}
                >
                  Keep going
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirmAbandon(false);
                    onOpenChange(false);
                  }}
                >
                  Abandon
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const STEP_LABELS = ["Generate", "Photograph", "Measure", "Save"] as const;
const STEP_HEADINGS = [
  "Burn the calibration plate",
  "Photograph the burned plate",
  "Confirm measured colours",
  "Calibration recorded",
] as const;

// ---------------------------------------------------------------------------
// Step 1 — generate.
// ---------------------------------------------------------------------------

function StepGenerate({
  materialName,
  downloading,
  onDownload,
  onContinue,
}: {
  materialName: string;
  downloading: boolean;
  onDownload: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-[color:var(--color-ink-muted)] leading-relaxed">
        We'll emit a calibration plate as <span className="font-mono">.xcs</span>.
        Burn it on your machine, then come back here and continue.
      </p>
      <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex items-center gap-3">
        <Target
          className="h-5 w-5 text-[color:var(--color-ink-muted)] shrink-0"
          strokeWidth={2}
        />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
            Plate
          </div>
          <div className="font-mono text-[12.5px] tabular-nums text-[color:var(--color-ink)] truncate">
            {materialName}-calibration.xcs
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={onDownload}
          disabled={downloading}
          className="gap-1.5"
        >
          <Download className="h-4 w-4" strokeWidth={2.2} />
          {downloading ? "Preparing…" : "Download .xcs"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onContinue}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — photo upload.
// ---------------------------------------------------------------------------

function StepPhoto({
  photoUrl,
  onPhoto,
  onContinue,
}: {
  photoUrl: string | null;
  onPhoto: (file: File) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-[color:var(--color-ink-muted)] leading-relaxed">
        Photograph it under good, even lighting. Upload the image below.
      </p>
      <Field label="Plate photo">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPhoto(f);
          }}
          className="block w-full text-[12.5px] file:mr-3 file:px-3 file:py-1.5 file:rounded-[6px] file:border file:border-[color:var(--color-border-strong)] file:bg-[color:var(--color-surface)] file:text-[color:var(--color-ink)] file:font-mono file:text-[11px] file:uppercase file:tracking-[0.16em] file:cursor-pointer"
        />
      </Field>
      {photoUrl && (
        <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-2 flex items-center gap-3">
          <img
            src={photoUrl}
            alt="Calibration plate"
            className="h-20 w-20 object-cover rounded-[4px] border border-[color:var(--color-border-strong)]"
          />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
              Reference photo
            </div>
            <p className="text-[12px] text-[color:var(--color-ink-muted)] leading-snug mt-0.5">
              You'll see this beside the colour inputs on the next step so
              you can match each patch by eye.
            </p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={!photoUrl}
          onClick={onContinue}
          className="gap-1.5"
        >
          <ImageDown className="h-4 w-4" strokeWidth={2.2} />
          Continue
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — measure.
// ---------------------------------------------------------------------------

function StepMeasure({
  rows,
  photoUrl,
  monotonicWarning,
  onChange,
  allMeasured,
  saving,
  onSave,
  autoMeasuring,
  autoMeasureNote,
}: {
  rows: MeasurementRow[];
  photoUrl: string | null;
  monotonicWarning: boolean;
  onChange: (idx: number, hex: string) => void;
  allMeasured: boolean;
  saving: boolean;
  onSave: () => void;
  autoMeasuring: boolean;
  autoMeasureNote: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      {autoMeasuring && (
        <div className="text-[12px] text-[color:var(--color-ink-muted)] italic">
          Auto-measuring patches from your photo…
        </div>
      )}
      {autoMeasureNote && !autoMeasuring && (
        <div
          className={cn(
            "rounded-[6px] border border-[color:var(--color-border)]",
            "bg-[color:var(--color-surface-elevated)] px-3 py-2",
            "text-[12px] text-[color:var(--color-ink-muted)] leading-snug",
          )}
        >
          {autoMeasureNote}
        </div>
      )}
      <p className="text-[13px] text-[color:var(--color-ink-muted)] leading-relaxed">
        Confirm each measured patch against the reference photo. Adjust
        any swatch that looks off.
      </p>
      <div className="flex gap-3">
        {photoUrl && (
          <img
            src={photoUrl}
            alt="Calibration plate"
            className="h-32 w-32 object-cover rounded-[6px] border border-[color:var(--color-border-strong)] shrink-0"
          />
        )}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {rows.map((row, idx) => (
            <MeasureRow
              key={row.label + idx}
              row={row}
              onChange={(hex) => onChange(idx, hex)}
            />
          ))}
        </div>
      </div>
      {monotonicWarning && (
        <div
          className={cn(
            "rounded-[6px] border border-[color:var(--color-warning,#b8860b)]/40",
            "bg-[color:var(--color-surface-elevated)] px-3 py-2",
            "flex items-start gap-2 text-[12px] text-[color:var(--color-ink-muted)]",
          )}
        >
          <AlertTriangle
            className="h-3.5 w-3.5 mt-0.5 text-[color:var(--color-warning,#b8860b)] shrink-0"
            strokeWidth={2.2}
          />
          <span>
            Measurements aren't monotonic light → dark. Check the patch
            order matches the row order before saving.
          </span>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={!allMeasured || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function MeasureRow({
  row,
  onChange,
}: {
  row: MeasurementRow;
  onChange: (hex: string) => void;
}) {
  const valid = HEX_RE.test(row.hex);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      {/* Single big swatch — click anywhere on it to open the native
          colour picker. The actual ``<input type="color">`` lives inside
          and is visually transparent so we control the look while still
          delegating the picker UI to the browser. */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={`Pick colour for ${row.label}`}
        className={cn(
          "relative h-9 w-9 rounded-[6px] border shrink-0 cursor-pointer",
          "border-[color:var(--color-border-strong)]",
          "hover:border-[color:var(--color-primary)]",
          valid ? "" : "border-dashed",
        )}
        style={{ background: valid ? row.hex : "transparent" }}
      >
        <input
          ref={inputRef}
          type="color"
          value={valid ? row.hex : "#888888"}
          onChange={(e) => onChange(e.target.value)}
          tabIndex={-1}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </button>
      <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] w-[68px] truncate">
        {row.label}
      </span>
      <Input
        mono
        value={row.hex}
        placeholder="#rrggbb"
        invalid={row.hex !== "" && !valid}
        onChange={(e) => onChange(e.target.value)}
        className="w-[120px]"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — done.
// ---------------------------------------------------------------------------

function StepDone({
  rows,
  onClose,
}: {
  rows: MeasurementRow[];
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[color:var(--color-ink)]">
        <CheckCircle2
          className="h-5 w-5 text-[color:var(--color-primary)]"
          strokeWidth={2.2}
        />
        <p className="text-[13px] leading-snug">
          Calibration recorded. The next test you ingest on this material
          will use these patches as anchors.
        </p>
      </div>
      <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex flex-col gap-2">
        <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          Recorded measurements
        </span>
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2">
              <span
                className="h-5 w-5 rounded-[4px] border border-[color:var(--color-border-strong)] shrink-0"
                style={{ background: r.hex }}
              />
              <span className="font-mono text-[11.5px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)] w-[68px] truncate">
                {r.label}
              </span>
              <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
                {r.hex}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={onClose}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Detect a non-monotonic light → dark sequence by comparing the
 *  perceived luminance of each row's measured hex. We only flag once
 *  every row has a valid hex; partial sequences shouldn't nag the user
 *  while they're still typing. */
function detectMonotonicWarning(rows: MeasurementRow[]): boolean {
  if (rows.length < 2) return false;
  const lums: number[] = [];
  for (const r of rows) {
    if (!HEX_RE.test(r.hex)) return false;
    const rgb = hexToRgb(r.hex);
    // ITU-R BT.601 luma — close enough for a "is this getting darker?"
    // check; we don't need a perceptual model here.
    lums.push(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
  }
  // Monotonic decreasing (light → dark) is the expected ordering.
  for (let i = 1; i < lums.length; i++) {
    if (lums[i] > lums[i - 1] + 1) return true; // tolerance for noise
  }
  return false;
}

