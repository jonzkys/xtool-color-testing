---
id: 2026-04-27-test-detail-redesign
date: 2026-04-27
created_at: 2026-04-27T13:30:00Z
level: major
title: Test detail page — fixed-height layout with tabbed editor
summary: The test page no longer scrolls. Parameters live on four tabs; the right-hand panels (preview, results, swatches) each scroll within their own region. Result viewer now defaults to the warped colour-only image with a toggle back to the photograph.
---

Tests with hundreds of result entries used to push the rest of the
test page off the screen — you'd scroll past the form, the preview,
and the upload button just to reach the swatches at the bottom. The
page is now viewport-fitted and split into regions that scroll
independently.

**Tabbed editor on the left.** The six stacked sections are now four
tabs:

- **Test** — Material · Width / Height / Gap · Cell shape · Square cells · Aggregator.
- **Sweep** — X / Y axis · Rows. (Rows used to live in Layout — it belongs with the sweep that uses it.)
- **Base params** — Recipe fields plus engraving direction and multi-pass angle.
- **Registration** — Marker mode + QR / ArUco sizes.

Material moves into the Test tab; the standalone "Material" row above
the editor is gone.

**Swept fields render disabled.** When you sweep `power` on the X
axis, the Power field on the Base params tab now shows greyed out
with an *Overridden by X-axis sweep* caption beneath it. Same for any
swept parameter on either axis. Stops the silent-override confusion
where you'd edit a value the sweep ignores.

**Right column — preview pinned, results split.** A compact 160-px
preview sits at the top of the right column with the burn dimensions
overlaid. Beneath it the Results list is capped at 40% of viewport
height (scrolls internally if you have lots of retests), and Averaged
swatches plus the ingest controls take the rest with their own scroll.
The two regions scroll independently so you can hold a result visible
while reviewing its swatches.

**Result modal hero defaults to warped.** Opening a result now shows
the rectified burn-space image (just the colour grid, with the
substrate edges and fiducials cropped out — what the sampler actually
sees) instead of the raw photograph. A WARPED / ORIGINAL pill at the
top-centre of the hero swaps between them.

**Spectrum strip tiles without gaps.** The L\* spectrum sliver in the
result modal now uses 1D Voronoi tiling so each swatch owns the
territory between its neighbours' midpoints. Sparse sweeps (4–6
swatches) used to show visible substrate gaps between stripes;
they're gone.
