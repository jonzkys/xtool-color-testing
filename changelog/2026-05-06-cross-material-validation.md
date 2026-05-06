---
id: 2026-05-06-cross-material-validation
date: 2026-05-06
level: major
title: Validation tests — seed picks from another material's palette
summary: Validation tests get a "Source palette" select. Pick known-good colours from material A and burn them on material B to find out how close the colours land — without rerunning every sweep test from scratch on the new material.
images:
  - src: 2026-05-06-cross-material-validation.png
    caption: Cross-material validation in action — source palette set to SS Tag, picks from a previous Circular tag run preserved in their own group above the picker.
---

Most metals burn similarly. The exact ΔE wanders a bit between
substrates — different alloys, different surface finishes, different
oxidation rates — but the *colour* you get from a given (power,
speed, frequency, passes) recipe is usually within 5–10 ΔE of what
you'd get on a similar metal. Sweeping every recipe combination on
each new material to find that out is a lot of burns.

Validation tests now have a **Source palette** select at the top of
the picker tab. Default is "Same as burn material" — what every
validation test has always done. Switch it to a different material
and the picker grid pulls *that* material's palette. The cells the
test produces are still burned on the test's own material; only the
expected colours come from the source.

When you upload a result and walk it through the Stability page's
VALIDATE flow, the burn-mean of each cell is compared against the
*source* material's expected Lab. That's the answer to "is my
material B burning these colours close enough to what material A
gave us?". Cells that come back tight save as new validated palette
entries on material B's palette; cells that drift surface as
candidates for the σ slider.

### Multi-source picks

Toggling the source while picks already exist used to be a footgun —
the picks belonged to the old source's palette but the picker now
showed the new source's, so the user lost sight of what they'd
already chosen. The picker now shows a **"Picks from {material}"**
group above the picker for every source the test references that
isn't the active one. Each pick is a small swatch with a hover-×
remove button, plus a "remove all" action on the group header.

Picks made against the active source still highlight in the grid as
they always have. Cells L*-sort across sources on save, so the burn
ordering on the .xcs file is correct regardless of which material
each colour came from.

### What's stored

A new `source_material_id` field on the validation test spec — the
spec column is JSON, so no migration. Null/omitted means "use the
test's own material", matching the historical behaviour. The picker
defaults `null` so existing tests open exactly as they did.

### Why this is small

The validate flow only ever read `expected_hex` / `expected_lab` /
`params` off `validation_cells` — never the palette entry itself.
That made the cross-material wiring almost free: the picker just had
to learn to ask for a different material's palette, and the cell
list does the rest of the work as before. The Stability page's
VALIDATE save still creates new entries on the *test's* material,
which is what you want — the source palette was a colour reference,
not a destination.
