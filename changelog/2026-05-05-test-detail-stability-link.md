---
id: 2026-05-05-test-detail-stability-link
date: 2026-05-05
level: minor
title: Test detail — results panel reclaims its space
summary: Dropped the averaged-swatch picker + "Ingest to palette" card from the test detail page. Results now fill the right column; an "View in Stability" button replaces the legacy ingest flow.
images:
  - src: 2026-05-05-test-detail-stripped.png
    caption: The right column now shows the upload button, a Stability deep-link, and a results list that fills the available height.
---

The averaged-swatch grid + "Ingest to palette" card got cramped
fast on tests with 3+ uploads — both fighting for the same
~600px column. They moved to the Stability page months ago via
VALIDATE / INGEST modes (much roomier canvas, σ slider, per-cell
overrides), so the duplicate UI on the test detail page was
mostly wasted pixels.

The right column on the test detail page now is just:

1. Upload photo button.
2. **View in Stability** — deep-links to `#/stability/{id}`.
3. The results list, filling the rest of the panel.

The Stability page now resolves the URL test's kind on mount, so
linking to a sweep test snaps the VALIDATION/SWEEP rail toggle to
SWEEP automatically. (Without that, the deep link silently lost
the selection — page mounted with kindFilter="validation",
listTests came back without the sweep id, picker reset to the
newest validation test.)
