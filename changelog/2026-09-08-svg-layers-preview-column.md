---
id: 2026-09-08-svg-layers-preview-column
date: 2026-09-08
level: minor
title: SVG Layers — the original on top, one render below
summary: The right-hand column showed the same processed artwork twice, once in detected colours and once in matched ones, and never showed you the file you started from. It now stacks the original upload above a single render, with a DESIGN / BURN toggle deciding which colours that render paints — so the comparison you actually make, source against output, is the one on screen.
---

The two panes were both the same geometry. Reading one against the other told
you what the palette match changed; neither told you what the *trace* changed,
which is the question you ask first when a photo comes back with the wrong
shapes in it.

So the top pane is now the file exactly as you dropped it — the photo, or the
SVG, before tracing, merging or simplifying touched it. It stays put while the
render below it changes, which is the whole point of stacking them.

The render underneath carries a **DESIGN / BURN** toggle. DESIGN paints the
colours detected in the file; BURN paints the matched palette colours the
machine will lay down. It remembers which you picked, and stays on DESIGN
until at least one layer has a match to show. The isolate-layer eye moved into
that pane's header, where it now dims the render you are actually looking at —
previously it applied to the upper pane only, so the lower one ignored it.

This reverses a deliberate decision from the 2026-04-27 palette redesign,
which kept the two previews side by side so the export toggle could not be
confused with them. That confusion is still worth avoiding — hence DESIGN /
BURN rather than a second control reading "matched" a few inches from the
export pill that already says it.
