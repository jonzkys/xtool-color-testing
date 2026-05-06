import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Sparkles, Target, Trash2, X } from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Field,
  Input,
  NumberField,
  Section,
  Select,
  Textarea,
  DemoLock,
} from "../ui";
import { useIsDemo } from "../hooks/useIsDemo";
import { listPaletteEntries, deletePaletteByMaterial } from "../api/palette";
import {
  getMaterialCalibration,
  patchMaterialCalibration,
} from "../api/wbCalibration";
import { notify } from "../ui";
import type { Material, MaterialShape } from "../library";
import type {
  BaseParams,
  CalibrationPatchSpec,
  MaterialCalibrationConfig,
} from "../types";
import { defaultBaseParams } from "../defaults";
import { BaseParamsEditor } from "./BaseParamsEditor";
import { CalibrationWizard } from "./CalibrationWizard";

/**
 * Modal for creating or editing a material. Replaces the bare
 * ``prompt("Material name?")`` flow on the Library page so users can
 * also (optionally) record a physical shape + size — the dimensions
 * the Tests-page auto-fit feature uses to size a generated grid to
 * the actual workpiece.
 *
 * Shape is optional. Existing materials with no shape carry on as
 * before; users can backfill via the Edit action whenever convenient.
 */

export interface MaterialEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided the modal is in edit-mode and prefills from this
   *  record; otherwise it's create-mode. */
  initial?: Material | null;
  onSubmit: (values: SubmitValues) => Promise<void> | void;
}

export interface SubmitValues {
  name: string;
  notes: string | null;
  shape: MaterialShape | null;
  diameter_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
}

type ShapeChoice = "none" | "circle" | "rect";

/** Sensible starter calibration patches for stainless-steel substrates.
 *  Three rows spanning light → mid → dark so the WB orchestrator has
 *  enough range to fit a usable correction. Users can tweak or replace
 *  these once the plate is burned. */
const STAINLESS_DEFAULTS: CalibrationPatchSpec[] = [
  {
    label: "light",
    params: {
      power: 8.0,
      speed: 1500,
      frequency: 30,
      density: 800,
      passes: 1,
      pulse_width: 120,
      laser: "red",
      scan_angle: 90,
    },
    canonical_rgb: null,
  },
  {
    label: "mid",
    params: {
      power: 18.0,
      speed: 1000,
      frequency: 80,
      density: 1000,
      passes: 1,
      pulse_width: 160,
      laser: "red",
      scan_angle: 90,
    },
    canonical_rgb: null,
  },
  {
    label: "dark",
    params: {
      power: 40.0,
      speed: 400,
      frequency: 120,
      density: 1200,
      passes: 2,
      pulse_width: 240,
      laser: "red",
      scan_angle: 90,
    },
    canonical_rgb: null,
  },
];

function rgbToHexString(rgb: [number, number, number]): string {
  const clamp = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(rgb[0])}${clamp(rgb[1])}${clamp(rgb[2])}`;
}

export function MaterialEditDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: MaterialEditDialogProps) {
  const isEdit = initial != null;
  const isDemo = useIsDemo();

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [shape, setShape] = useState<ShapeChoice>("none");
  const [diameter, setDiameter] = useState<number>(0);
  const [width, setWidth] = useState<number>(0);
  const [height, setHeight] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live count of palette entries belonging to this material. Fetched
  // lazily on dialog open in edit-mode; null until loaded so we can
  // disable the wipe button until we know what we're talking about.
  const [paletteCount, setPaletteCount] = useState<number | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Calibration panel — only fetched in edit-mode. ``null`` while
  // loading or for create-mode; once loaded the local copy is the
  // single source of truth until the user hits Save.
  const [calibration, setCalibration] = useState<MaterialCalibrationConfig | null>(null);
  const [calibrationDirty, setCalibrationDirty] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Reset draft state when the dialog opens with a different record.
  // Using ``open`` in the deps means a closed-then-reopened dialog
  // re-seeds from the initial value rather than holding stale edits.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setName(initial?.name ?? "");
    setNotes(initial?.notes ?? "");
    const s = initial?.shape ?? null;
    setShape(s ?? "none");
    setDiameter(initial?.diameter_mm ?? 0);
    setWidth(initial?.width_mm ?? 0);
    setHeight(initial?.height_mm ?? 0);
    setConfirmingClear(false);
    setPaletteCount(null);
    setCalibration(null);
    setCalibrationDirty(false);
    setCalibrationOpen(true);
    setWizardOpen(false);
  }, [open, initial]);

  // Fetch the live palette-entry count for the material being edited
  // so the danger-zone label reads "Clear N entries" rather than just
  // "Clear palette". One round-trip per dialog open in edit-mode.
  useEffect(() => {
    if (!open || !isEdit || !initial) return;
    let cancelled = false;
    (async () => {
      try {
        const entries = await listPaletteEntries({ material_id: initial.id });
        if (!cancelled) setPaletteCount(entries.length);
      } catch {
        // Non-fatal — leave the count null so the button surfaces a
        // generic "Clear palette" label and the API call is what
        // actually does the work.
        if (!cancelled) setPaletteCount(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, isEdit, initial]);

  // Fetch the live calibration record so the panel shows the most
  // recent state. Falls back to the seed shape (wb_supported=true,
  // empty patches) if the GET fails so the user can still configure
  // calibration on a material that doesn't have a row yet.
  useEffect(() => {
    if (!open || !isEdit || !initial) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getMaterialCalibration(initial.id);
        if (!cancelled) {
          setCalibration(cfg);
          setCalibrationDirty(false);
        }
      } catch {
        if (!cancelled) {
          setCalibration({
            wb_supported: true,
            clean_pass_params: null,
            calibration_patches: null,
          });
          setCalibrationDirty(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, isEdit, initial]);

  async function handleClearPalette() {
    if (!isEdit || !initial) return;
    setClearing(true);
    try {
      const { deleted } = await deletePaletteByMaterial(initial.id);
      notify(
        deleted === 0
          ? "No palette entries to clear."
          : `Cleared ${deleted} palette ${deleted === 1 ? "entry" : "entries"} for ${initial.name}.`,
        "info",
      );
      setPaletteCount(0);
      setConfirmingClear(false);
      // Notify any palette-displaying view (PalettePage, etc.) that
      // it should refetch. Listeners for "palette:refetch" can opt
      // in; absence of a listener is harmless.
      window.dispatchEvent(new CustomEvent("palette:refetch", {
        detail: { material_id: initial.id },
      }));
    } catch (e) {
      notify(`Couldn't clear palette: ${(e as Error).message}`, "error");
    } finally {
      setClearing(false);
    }
  }

  function buildPayload(): SubmitValues | string {
    const trimmed = name.trim();
    if (!trimmed) return "Material name is required.";
    const base = {
      name: trimmed,
      notes: notes.trim() || null,
    };
    if (shape === "none") {
      return {
        ...base,
        shape: null,
        diameter_mm: null,
        width_mm: null,
        height_mm: null,
      };
    }
    if (shape === "circle") {
      if (!diameter || diameter <= 0) {
        return "Diameter must be greater than zero.";
      }
      return {
        ...base,
        shape: "circle",
        diameter_mm: diameter,
        width_mm: null,
        height_mm: null,
      };
    }
    // rect
    if (!width || width <= 0 || !height || height <= 0) {
      return "Width and height must each be greater than zero.";
    }
    return {
      ...base,
      shape: "rect",
      diameter_mm: null,
      width_mm: width,
      height_mm: height,
    };
  }

  async function handleSubmit() {
    const result = buildPayload();
    if (typeof result === "string") {
      setError(result);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(result);
      // Persist calibration changes alongside the material patch when
      // the user touched anything in the calibration panel. We only
      // PATCH on dirty so a benign open-and-close doesn't clobber a
      // calibration row the user filled in elsewhere.
      if (isEdit && initial && calibrationDirty && calibration) {
        await patchMaterialCalibration(initial.id, calibration);
      }
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Helpers for the calibration panel ----------------------------------

  function patchCalibration(p: Partial<MaterialCalibrationConfig>) {
    setCalibration((prev) => {
      const base = prev ?? {
        wb_supported: true,
        clean_pass_params: null,
        calibration_patches: null,
      };
      return { ...base, ...p };
    });
    setCalibrationDirty(true);
  }

  function setPatches(
    next: CalibrationPatchSpec[] | null,
  ) {
    patchCalibration({ calibration_patches: next });
  }

  function addPatch() {
    const existing = calibration?.calibration_patches ?? [];
    if (existing.length >= 8) return;
    const idx = existing.length + 1;
    setPatches([
      ...existing,
      {
        label: `patch-${idx}`,
        params: defaultBaseParams(),
        canonical_rgb: null,
      },
    ]);
  }

  function loadStainlessDefaults() {
    setPatches(STAINLESS_DEFAULTS.map((p) => ({ ...p, params: { ...p.params } })));
  }

  function updatePatch(index: number, p: Partial<CalibrationPatchSpec>) {
    const existing = calibration?.calibration_patches ?? [];
    const next = existing.map((row, i) => (i === index ? { ...row, ...p } : row));
    setPatches(next);
  }

  function deletePatch(index: number) {
    const existing = calibration?.calibration_patches ?? [];
    const next = existing.filter((_, i) => i !== index);
    setPatches(next.length === 0 ? null : next);
  }

  function openWizard() {
    setWizardOpen(true);
  }

  // Refresh the calibration record after the wizard records new
  // measurements so the canonical-RGB swatches in the panel update
  // without forcing the user to close + re-open the dialog.
  async function refreshCalibration() {
    if (!isEdit || !initial) return;
    try {
      const cfg = await getMaterialCalibration(initial.id);
      setCalibration(cfg);
      setCalibrationDirty(false);
    } catch {
      // Non-fatal — leave the local copy alone; the user can re-open
      // the dialog to retry the fetch.
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="sm"
        className="p-0 max-w-[480px] flex flex-col"
        aria-describedby={undefined}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--color-border)] shrink-0">
          <div>
            <div className="font-mono text-[9.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
              Library
            </div>
            <DialogTitle className="text-[16px] mt-0.5 block">
              {isEdit ? "Edit material" : "New material"}
            </DialogTitle>
          </div>
          <DialogClose
            aria-label="Close"
            className="h-7 w-7 inline-flex items-center justify-center rounded-full text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </DialogClose>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="flex flex-col gap-5 p-5"
        >
          <Section title="Identity" dense>
            <Field label="Name">
              <Input
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Stainless steel card"
                maxLength={64}
              />
            </Field>
            <Field
              label="Notes"
              hint="Optional — anything that helps you remember this batch."
            >
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </Field>
          </Section>

          <Section
            title="Physical shape"
            description="Optional — feeds the Tests page auto-fit feature so generated grids land inside the workpiece."
            dense
          >
            <Field label="Shape">
              <Select
                value={shape}
                onChange={(e) => setShape(e.target.value as ShapeChoice)}
              >
                <option value="none">None — no auto-fit</option>
                <option value="circle">Circle</option>
                <option value="rect">Rectangle</option>
              </Select>
            </Field>
            {shape === "circle" && (
              <Field label="Diameter (mm)">
                <NumberField
                  value={diameter}
                  min={1}
                  max={1000}
                  onChange={setDiameter}
                />
              </Field>
            )}
            {shape === "rect" && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Width (mm)"
                  value={width}
                  min={1}
                  max={1000}
                  onChange={setWidth}
                />
                <NumberField
                  label="Height (mm)"
                  value={height}
                  min={1}
                  max={1000}
                  onChange={setHeight}
                />
              </div>
            )}
          </Section>

          {isEdit && initial && (
            <CalibrationSection
              calibration={calibration}
              isDemo={isDemo}
              dirty={calibrationDirty}
              wbSupported={calibration?.wb_supported ?? true}
              cleanPass={calibration?.clean_pass_params ?? null}
              patches={calibration?.calibration_patches ?? null}
              onToggleWb={(v) => patchCalibration({ wb_supported: v })}
              onCleanPassChange={(p) => patchCalibration({ clean_pass_params: p })}
              onAddPatch={addPatch}
              onLoadStainless={loadStainlessDefaults}
              onUpdatePatch={updatePatch}
              onDeletePatch={deletePatch}
              onCalibrate={openWizard}
              expanded={calibrationOpen}
              onToggleExpanded={() => setCalibrationOpen((v) => !v)}
            />
          )}

          {error && (
            <div className={cn(
              "rounded-[6px] border border-[color:var(--color-destructive)]/30",
              "bg-[color:var(--color-destructive-tint)] px-3 py-2",
              "text-[12.5px] text-[color:var(--color-destructive)]",
            )}>
              {error}
            </div>
          )}

          {isEdit && initial && (
            <Section
              title="Danger zone"
              description="Wipe palette entries for this material. Tests and results stay — you can re-ingest selectively from the existing results afterward."
              dense
            >
              {!confirmingClear ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
                      Palette
                    </span>
                    <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
                      {paletteCount === null
                        ? "—"
                        : paletteCount === 1
                          ? "1 entry"
                          : `${paletteCount} entries`}
                    </span>
                  </div>
                  <DemoLock label="Clearing the palette is disabled in the demo.">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isDemo || paletteCount === 0 || paletteCount === null}
                      onClick={() => setConfirmingClear(true)}
                      className="gap-1.5"
                    >
                      <AlertTriangle
                        className="h-3.5 w-3.5 text-[color:var(--color-destructive)]"
                        strokeWidth={2.2}
                      />
                      <span>Clear palette</span>
                    </Button>
                  </DemoLock>
                </div>
              ) : (
                <div
                  className={cn(
                    "rounded-[6px] border border-[color:var(--color-destructive)]/40",
                    "bg-[color:var(--color-destructive-tint)] p-3 flex flex-col gap-2",
                  )}
                >
                  <div className="text-[12.5px] text-[color:var(--color-destructive)] leading-snug">
                    Delete{" "}
                    <span className="font-mono tabular-nums font-semibold">
                      {paletteCount}
                    </span>{" "}
                    palette {paletteCount === 1 ? "entry" : "entries"} for
                    {" "}
                    <span className="font-semibold">{initial.name}</span>?
                    Tests and results are kept. This can't be undone.
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={clearing}
                      onClick={() => setConfirmingClear(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={clearing}
                      onClick={() => void handleClearPalette()}
                    >
                      {clearing ? "Clearing…" : "Yes, clear palette"}
                    </Button>
                  </div>
                </div>
              )}
            </Section>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[color:var(--color-border)] -mx-5 px-5 -mb-5 pb-4">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={submitting || !name.trim()}
            >
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    {isEdit && initial && calibration && (
      <CalibrationWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        materialId={initial.id}
        materialName={initial.name}
        patches={calibration.calibration_patches ?? []}
        onComplete={() => void refreshCalibration()}
      />
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Calibration sub-section.
// ---------------------------------------------------------------------------

interface CalibrationSectionProps {
  calibration: MaterialCalibrationConfig | null;
  isDemo: boolean;
  dirty: boolean;
  wbSupported: boolean;
  cleanPass: BaseParams | null;
  patches: CalibrationPatchSpec[] | null;
  onToggleWb: (v: boolean) => void;
  onCleanPassChange: (p: BaseParams | null) => void;
  onAddPatch: () => void;
  onLoadStainless: () => void;
  onUpdatePatch: (index: number, p: Partial<CalibrationPatchSpec>) => void;
  onDeletePatch: (index: number) => void;
  onCalibrate: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

function CalibrationSection({
  calibration,
  isDemo,
  dirty,
  wbSupported,
  cleanPass,
  patches,
  onToggleWb,
  onCleanPassChange,
  onAddPatch,
  onLoadStainless,
  onUpdatePatch,
  onDeletePatch,
  onCalibrate,
  expanded,
  onToggleExpanded,
}: CalibrationSectionProps) {
  const dimmed = !wbSupported;
  const patchList = patches ?? [];
  const canCalibrate = wbSupported && patchList.length >= 2 && !dirty;

  return (
    <Section
      title="Calibration"
      description="Burn a strip on every test plate so palette colours stay consistent across lighting."
      actions={
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)]"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" strokeWidth={2.2} />
          ) : (
            <ChevronRight className="h-3 w-3" strokeWidth={2.2} />
          )}
          {expanded ? "Hide" : "Show"}
        </button>
      }
      dense
    >
      {/* WB-supported toggle is always visible so users on tricky
          substrates can opt out without expanding the panel. */}
      <label className="flex items-start gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
        <input
          type="checkbox"
          checked={wbSupported}
          onChange={(e) => onToggleWb(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          White-balance correction supported
          <span className="block text-[11px] text-[color:var(--color-ink-subtle)]">
            {wbSupported
              ? "Calibration will run on ingest when a strip is present."
              : "Disable for substrates that don't tolerate the clean pass — calibration is skipped at ingest."}
          </span>
        </span>
      </label>

      {expanded && (
        <div
          className={cn(
            "flex flex-col gap-4",
            dimmed && "opacity-50 pointer-events-none",
          )}
          aria-disabled={dimmed}
        >
          {calibration === null ? (
            <p className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
              Loading calibration…
            </p>
          ) : (
            <>
              {/* Clean-pass params --------------------------------- */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
                    Clean-pass recipe
                  </span>
                  {cleanPass && (
                    <button
                      type="button"
                      onClick={() => onCleanPassChange(null)}
                      className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-destructive)]"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {cleanPass ? (
                  <BaseParamsEditor
                    value={cleanPass}
                    onChange={onCleanPassChange}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onCleanPassChange(defaultBaseParams())}
                  >
                    Add clean-pass recipe
                  </Button>
                )}
                <p className="text-[11px] text-[color:var(--color-ink-subtle)] leading-snug">
                  A low-energy raster that wipes any prior toning before the patches go down.
                </p>
              </div>

              {/* Patches ------------------------------------------ */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
                    Patches
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink-subtle)]">
                    {patchList.length}/8
                  </span>
                </div>

                {patches === null && (
                  <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex flex-col gap-2">
                    <p className="text-[12px] text-[color:var(--color-ink-muted)] leading-snug">
                      No patches configured yet. Start with the stainless defaults
                      (light · mid · dark) or add your own.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={onLoadStainless}
                        className="gap-1.5"
                      >
                        <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
                        Use stainless-steel defaults
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onAddPatch}
                        className="gap-1.5"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
                        Add patch
                      </Button>
                    </div>
                  </div>
                )}

                {patchList.map((patch, idx) => (
                  <PatchRow
                    key={idx}
                    index={idx}
                    patch={patch}
                    onUpdate={(p) => onUpdatePatch(idx, p)}
                    onDelete={() => onDeletePatch(idx)}
                  />
                ))}

                {patches !== null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onAddPatch}
                    disabled={patchList.length >= 8}
                    className="gap-1.5 self-start"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
                    Add patch
                  </Button>
                )}
              </div>

              {/* Calibrate CTA ------------------------------------ */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-[11.5px] text-[color:var(--color-ink-subtle)] leading-snug max-w-[28ch]">
                  {patchList.length < 2
                    ? "Configure at least two patches to run the wizard."
                    : dirty
                      ? "Save your changes before running the wizard."
                      : "Burn a calibration plate, photograph it, and record measured colours."}
                </p>
                <DemoLock label="Calibration is disabled in the demo.">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={isDemo || !canCalibrate}
                    onClick={onCalibrate}
                    className="gap-1.5"
                  >
                    <Target className="h-3.5 w-3.5" strokeWidth={2.2} />
                    Calibrate
                  </Button>
                </DemoLock>
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// One row in the patches list.
// ---------------------------------------------------------------------------

interface PatchRowProps {
  index: number;
  patch: CalibrationPatchSpec;
  onUpdate: (p: Partial<CalibrationPatchSpec>) => void;
  onDelete: () => void;
}

function PatchRow({ patch, onUpdate, onDelete }: PatchRowProps) {
  const [paramsOpen, setParamsOpen] = useState(false);
  const swatchHex = patch.canonical_rgb
    ? rgbToHexString(patch.canonical_rgb)
    : null;

  return (
    <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* Canonical-RGB swatch — 24×24, neutral border, fixed grid
            cell on a dashed track when unset so the row doesn't jitter
            once a colour gets recorded. */}
        {swatchHex ? (
          <span
            className="h-6 w-6 rounded-[4px] border border-[color:var(--color-border-strong)] shrink-0"
            style={{ background: swatchHex }}
            title={`canonical_rgb ${swatchHex}`}
            aria-label={`Canonical RGB ${swatchHex}`}
          />
        ) : (
          <span
            className="h-6 w-6 rounded-[4px] border border-dashed border-[color:var(--color-border-strong)] shrink-0"
            title="Not yet measured"
            aria-label="Not yet measured"
          />
        )}
        <Input
          mono
          value={patch.label}
          maxLength={16}
          placeholder="label"
          onChange={(e) => onUpdate({ label: e.target.value })}
          className="flex-1 min-w-0"
        />
        <button
          type="button"
          onClick={() => setParamsOpen((v) => !v)}
          className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)] inline-flex items-center gap-1 px-1.5"
          aria-expanded={paramsOpen}
        >
          {paramsOpen ? (
            <ChevronDown className="h-3 w-3" strokeWidth={2.2} />
          ) : (
            <ChevronRight className="h-3 w-3" strokeWidth={2.2} />
          )}
          Recipe
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete patch"
          className="h-7 w-7 inline-flex items-center justify-center rounded-[4px] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          Canonical RGB
        </span>
        <span className="font-mono text-[11.5px] tabular-nums text-[color:var(--color-ink-muted)]">
          {swatchHex
            ? swatchHex
            : <span className="italic">(not yet measured)</span>}
        </span>
      </div>
      {paramsOpen && (
        <div className="pt-2 border-t border-[color:var(--color-border)]">
          <BaseParamsEditor
            value={patch.params}
            onChange={(params) => onUpdate({ params })}
          />
        </div>
      )}
    </div>
  );
}
