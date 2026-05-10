---
id: 2026-05-10-wb-per-test-anchor
date: 2026-05-10
level: minor
title: Capture — flat-field anchors to the brightest photo in the test
summary: Bright, well-lit captures stop getting compressed; dim photos are lifted toward the test's best shot instead of a fixed substrate target.
---

White-balance flat-field correction used to normalise every photo to a
hardcoded substrate colour (`160, 160, 145`). When a photo measured
brighter than that — exactly when the engraving's colour is most
visible — the per-pixel gain dropped below 1.0, the highlights got
clipped, and saturated burns came out muddy.

The canonical anchor is now derived per-test from the brightest
perimeter strip ever observed across the test's photos (including the
one being uploaded). Implications:

- A bright, vibrant photo passes through with gain ≈ 1.0 — no compression.
- Dimmer photos in the same test are lifted toward that bright reference
  instead of toward a fixed dim target.
- New rows are stamped `wb_canonical_id = "v2.per-test-max.2026-05-10"`
  so legacy v1 rows remain identifiable.

Existing palette entries are not retroactively re-ingested. Re-uploading
a photo against the same test (or hitting the result detail dialog's
reingest path) recomputes against the new anchor.
