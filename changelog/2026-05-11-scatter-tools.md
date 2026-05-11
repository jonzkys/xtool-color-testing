---
id: 2026-05-11-scatter-tools
date: 2026-05-11
level: major
title: Exposure scatter — Crop tool, trackpad pan, taller chart
summary: New Crop pill (drag a rect to zoom), 2-finger trackpad swipe pans the chart, the focus crosshair is now opt-in via the Color tab, and the whole page fits in one viewport.
images:
  - src: 2026-05-11-scatter-tools.png
    caption: Chart now fills the available height. Correlations moved under the right rail; Hue ribbon + Exposure range removed.
---

The scatter has grown into the page's hero panel — bigger viewport,
better mouse and trackpad ergonomics, and less clutter around it.

**Crop.** A new `◰ Crop` pill in the under-chart pill bar puts the
chart into crop mode: drag a rectangle and the viewport zooms to it on
release. A banner across the top of the chart reminds you `Drag to
crop · ESC cancels`. The cmd-drag shortcut still works for the
keyboard-fluent. Double-clicking the chart still resets.

**Trackpad gestures.** Wheel events now route by modifier:

| Gesture                   | Event           | Behavior                |
|---|---|---|
| 2-finger swipe (trackpad) | `wheel` plain    | **Pan** (deltaX, deltaY) |
| Pinch on trackpad         | `wheel + ctrlKey` | **Zoom** at cursor       |
| Mouse wheel               | `wheel` plain    | **Pan** vertically       |
| Shift + mouse wheel       | `wheel + shiftKey` | **Zoom** at cursor       |

Browsers synthesize `ctrlKey` for trackpad pinches, so we don't have
to sniff. Shift-wheel is a desktop-mouse escape hatch for users who
want the old wheel-zoom feel.

**Focus crosshair → Color tab toggle.** The dashed L-shape that used
to anchor the focused dot to the axes was on by default; it's now an
opt-in overlay in the **Color** tab alongside Colour field / Contours
/ Fade dots.

**Neighbours moved.** The Neighbours panel (related-colour explorer)
was the third section inside the Info tab. It's now the top section
of the **Color** tab. The Info tab keeps just the Focused card and
the Indices chips, so it's about half the height it was.

**Page fits one viewport.** The scatter card now flex-grows to absorb
whatever vertical space the under-chart rows leave, with a 220 px
floor so it never goes unreadable. To make the height add up
honestly, two panels got cut: the **Hue ribbon** (ordered-by-X
colour strip beneath the chart) and the **Exposure range** brush
slider — both were sitting unused. The **Correlations matrix**
moved out of the main column and into the bottom of the right rail,
pinned under the tab strip so it's always visible regardless of
which tab is active.

What you can stop doing:

- Scrolling the exposure page on a 13-inch laptop.
- Holding cmd to box-zoom (still works, but the pill is discoverable).
- Mentally filtering out the crosshair when you want a clean dot-cloud.
- Wondering what the Hue ribbon was for (it served no purpose; that's
  why it's gone).
