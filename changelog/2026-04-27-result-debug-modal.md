---
id: 2026-04-27-result-debug-modal
date: 2026-04-27
created_at: 2026-04-27T14:05:00Z
level: major
title: Debug view per result — sampling grid + actual-vs-captured strips
summary: A new bug icon on each result row opens a debug modal showing the warped capture with the sampling grid overlaid, plus a per-row strip comparing the actual cell crop against the colour the sampler picked.
images:
  - src: result-debug-modal.png
    caption: Top — warped capture with the sampling grid drawn on top (yellow grid bounds, red cell rectangles, blue centre dots). Below — per-row strips with the actual cell crop on top and a flat fill of the sampler's chosen colour beneath.
---

The capture pipeline used to be a black box once the photo was
uploaded. If a swatch came out wrong it was hard to tell whether the
geometry was off (sampling the wrong patch of metal) or the pixels
were genuinely that colour. The new per-result debug view exposes
both.

**One bug icon per result row.** Click it to open the modal — same
gesture pattern as the existing reingest / delete actions, just one
button to the left.

**Sampling grid on the warped image.** The first panel shows the
rectified burn-space image with the grid overlay drawn on top: a
yellow outline around the overall grid bounds, red rectangles around
each cell, and a blue dot at every sample centre. If the homography
mis-aligned a row, you see it immediately. The strip's title bar
echoes the test parameters so a screenshot is self-contained.

**Actual vs captured, row by row.** Below the grid view, every row
of the test renders as a horizontal strip: top half is the actual
cell crop from the warped image; bottom half is a flat fill of the
exact colour the sampler wrote to the swatch list. Side-by-side, you
can spot a swatch that's drifted yellow or grey when the cell clearly
wasn't.

Both views are computed on demand — no extra storage. The capture
pipeline already runs for the warped-image hero we shipped earlier;
the debug renders piggy-back off the same warp.
