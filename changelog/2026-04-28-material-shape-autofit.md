---
id: 2026-04-28-material-shape-autofit
date: 2026-04-28
created_at: 2026-04-28T08:05:00Z
level: major
title: Materials get a shape, tests can auto-fit to it
summary: Materials gain optional shape + size metadata. Tests get an Auto-fit toggle that derives the grid width and height from the workpiece outline minus a buffer and the registration markers — pre-filled from the material's defaults, editable per-test.
images:
  - src: material-shape-modal.png
    caption: The new material modal — name, optional shape (None / Circle / Rectangle), conditional dimension fields (diameter, or width × height), and notes. Same modal handles edit so existing materials can be backfilled.
---

Sizing a test grid used to be a manual measurement chore — pull out
the calipers, type widths and heights into the form, hope the QR and
ArUco markers don't push the grid past the edge of the workpiece.
This release introduces a workflow where the material remembers its
own shape, and the Tests page reads that to size the grid for you.

### Materials gain shape + size

A new modal replaces the old `prompt("Material name?")`. Alongside
the name and notes (which existed already), there's an optional
**Physical shape** section:

- **Shape** — None / Circle / Rectangle
- **Circle** — diameter in mm
- **Rectangle** — width × height in mm

All shape fields are optional. Existing materials are unchanged —
no backfill, no migration headache. When you open Edit (the pencil
icon) on a material that pre-dates this feature, the shape section
is just empty and you can fill it in (or leave it blank) at your
own pace.

The same modal handles new and edit, so the keyboard flow is
identical regardless of which mode you're in.

### Tests page — Auto-fit grid

A new **Auto-fit to material** toggle lives on the Test tab,
between Material and Layout. When on:

- Shape, dimensions, and a buffer slider appear, **pre-filled from
  the active material** (when it has shape metadata configured).
- The grid's Width and Height become read-only and recompute from
  the inputs above.
- Buffer (default 2%, range 0–10%) leaves empty space on every side
  so the burn lands inside the material's footprint with margin to
  spare for alignment.
- Per-test override: edits in the auto-fit panel apply to this
  test's spec only, never push back to the material record.

If the active material has **no shape configured**, a warning
prompts you to either set the shape on the panel for one-off use,
or update the material on the Library page so the next test starts
pre-filled.

The math respects the registration markers — QR and ArUco eat
their own corner real estate, and the grid is sized to fit
*inside* what's left:

- Rectangle → `grid_w/h = material_dim × (1 - 2·buffer) - marker_chrome`
- Circle → inscribed square minus marker chrome (v1 — arbitrary
  aspect inside a circle is a future tightening pass when there's
  a real use case)

For wrapped 1D tests (multiple rows of a single sweep), the per-row
cell height is computed correctly — the inter-row axis-label gap is
honoured so the grid lines up with what the generator emits.

### Square cells

**Square cells** plays nicely with auto-fit: with both on, the
recompute picks the largest *square* cell that fits inside the
material outline (limited by whichever axis runs out first), then
sizes the grid to match. The grid may end up smaller than the
material on one axis — that's the price of squareness inside the
available area, and it's what you almost always want when sweeping
on a small workpiece.

### What stays manual

Auto-fit only computes the grid bounds. **Rows, step counts, gap,
and cell shape stay user-driven** — this is a sizing helper, not a
test designer. Switching auto-fit off restores the previous manual
control over Width and Height.
