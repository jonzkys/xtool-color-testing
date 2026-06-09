---
id: 2026-06-09-forge-relief-vents
date: 2026-06-09
level: major
title: Forge — scrap-side relief vents
summary: Forge now adds targeted relief at corners and the scrap necks between near-touching edges, so a choking brass kerf can clear sideways.
images:
  - src: forge-relief-vents.png
    caption: Relief slots in the ring+dot gaps and between strokes — always on the scrap side.
---

Deep brass kerfs choke where the scrap can't escape — sharp corners, and the
tight necks between near-touching script strokes, ring+dot decorations and i/j
dots. Forge now finds those spots automatically and adds **scrap-side relief
vents**: short slots that open the choking kerf to free scrap so melt and dross
can clear sideways.

Vents are placed over the whole design — including the inner loops of holes and
disjoint islands — at corners (outward slots) and at near-gaps (slots running
along the scrap channel). A part-side guard checks the whole slot body, so a vent
can never bite the part itself; if a neck is too tight for the configured slot,
the slot shrinks to fit or is skipped.

Turn them on in the **Perforate / Relief** panel: choose pocket or slot, toggle
near-gap vents, and tune the gap threshold and slot length. The Lean preset now
ships slot relief with near-gaps on.

This is the geometry half of the cut-strategy experiment — the comparison mode
that prices candidate strategies against your baseline is next.
