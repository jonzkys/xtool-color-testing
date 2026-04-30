---
id: 2026-04-30-saved-spectrums
date: 2026-04-30
created_at: 2026-04-30T15:00:00Z
level: major
title: Saved spectrums — persist cropped sub-spectrums and their fits
summary: Crop the 1D spectrum page to a sub-range with a strong polynomial fit and save it. The new Saved tab in the workbench lists every saved record — name, source test, axis range, per-channel R², a strip rendered from the saved swatches. This is stage 1 of an upcoming colour-to-spectrum predictor that will read these saved records to map a target colour back to its place on a known gradient.
images:
  - src: saved-spectrums-list.png
    caption: A saved sub-spectrum from a speed sweep on stainless steel, cropped to 400→700 mm/s with a degree-2 polynomial fit (L 0.96 / a 0.84 / b 0.92).
---

The 1D spectrum page lets you crop a sweep down to a sub-range and
read off a polynomial fit (per-channel L\*/a\*/b\*, with R² per
channel). Until now that state was purely in-memory: there was no DB
table for spectrums, no save target, no way to recall a cropped +
fitted slice later. This release lays the persistence groundwork.

### What's new

A new **Save spectrum** button sits in the existing FitPanel on the
spectrum page. It enables once you've cropped to a sub-range and
picked a fit degree (1, 2, or 3), and disables when nothing's worth
saving — full-range sweeps, no fit, or fewer points than the
polynomial degree needs. Click it, give the spectrum a name, and the
record persists.

The dialog reads back what was computed: source test, axis bounds,
fit degree, per-channel R², and the Lab range covered by the saved
swatches. Saving stamps in the per-channel polynomial coefficients
(L/a/b separately), every swatch inside the crop, and a server-
derived Lab bounding box so the future predictor's per-material
prefilter is cheap from day one.

### The new Saved tab

A new top-level **Saved** tab in the workbench sits between Spectrum
and the right-hand controls. Every saved spectrum shows as a card
with the name, a link back to the source test, the axis range and
point count, per-channel R², the Lab range, and a strip of swatches
rendered from the saved data. A Min R² filter narrows the list when
you only care about strong fits.

### Persistence

Three normalised SQL tables — `saved_spectrums` carries the
indexed Lab bounding box and centroid, `saved_spectrum_swatches`
holds one row per data point inside the crop, and
`saved_spectrum_fit_coefficients` holds the polynomial coefficients
keyed by `(channel, degree)`. No JSON columns; every field is a
typed, queryable column. Cascade-deleting a saved spectrum cleans up
its children; deleting a source test preserves the saved spectrum
and just nulls out the back-reference.

While wiring this in we noticed SQLite was running with FK
enforcement off site-wide, which meant some long-standing FK
declarations in the schema were decorative. Turned the
`PRAGMA foreign_keys=ON` on per connection, fixed the handful of
existing tests that had been relying on the lax behaviour, and the
schema now actually does what it says.

### Where this is going

Stage 1 stops at "save and browse". The bigger feature — give it a
target colour, find which saved spectrums could contain that colour,
how close it is to each, and (eventually) fit a single new test
plate to existing spectrums with a small Δ-Lab offset — will live on
its own page and consume these saved records as inputs.

### Where to find it

Save: `#/spectrum/<id>` → crop → pick a fit degree → **Save spectrum** in the FitPanel.
Browse: `#/saved-spectrums` (Saved tab in the top nav).
