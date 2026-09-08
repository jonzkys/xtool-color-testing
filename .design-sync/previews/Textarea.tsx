import { useState } from "react";
import { Field, Textarea } from "xcs-gen-web";

export function MaterialNotes() {
  const [notes, setNotes] = useState(
    "Brass 3.0mm, brushed face. Batch from the March order — noticeably softer than the offcuts, so the 4-pass spiral cut over-burns the exit edge.",
  );
  return (
    <div className="max-w-[420px]">
      <Field label="Notes" hint="Optional — anything that helps you remember this batch.">
        <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </div>
  );
}

export function RowsSweep() {
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <Field label="Burn test sheet — caption (rows=2)">
        <Textarea rows={2} defaultValue="Row A: 1200 mm/s · Row B: 900 mm/s" />
      </Field>
      <Field label="Run log (rows=6)">
        <Textarea
          rows={6}
          defaultValue={
            "Pass 1 — focus 0.0mm, clean channel\nPass 2 — focus -0.4mm\nPass 3 — focus -0.8mm, first through-cut on the outer arm\nPass 4 — focus -1.2mm, severed"
          }
        />
      </Field>
    </div>
  );
}

export function Invalid() {
  return (
    <div className="max-w-[420px]">
      <Field label="Label / notes" error="Notes cannot exceed 500 characters.">
        <Textarea
          invalid
          rows={3}
          defaultValue="Burnt copper at 1 mm gold, held for the annealed sheet only — see the validated palette entry for the full recipe and the cross-run burn sigma that gated it…"
        />
      </Field>
    </div>
  );
}

export function EmptyAndDisabled() {
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <Field label="Notes">
        <Textarea rows={3} placeholder="e.g. burnt copper, 1 mm gold" />
      </Field>
      <Field label="Generated .xcs summary" hint="Written by the generator on export.">
        <Textarea disabled rows={2} value="5 layers · 1 vector cut · 4 hatched fills" />
      </Field>
    </div>
  );
}
