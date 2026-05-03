import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
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
import { notify } from "../ui";
import type { Material, MaterialShape } from "../library";

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
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
  );
}
