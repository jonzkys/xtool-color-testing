---
id: 2026-05-03-topo-simplify-quantize
date: 2026-05-03
level: minor
title: SVG simplification no longer opens white gaps between adjacent regions
summary: Traced-image SVGs (vtracer, Potrace, Adobe export) emit adjacent paths whose shared edges differ by sub-pixel amounts. The simplifier was treating those edges as independent and pulling the regions apart; it now snaps coords onto a 1e5 grid before junction detection, so shared edges register as single arcs and Visvalingam-Whyatt moves both sides in lockstep.
---

If your trace had any meaningful detail, even a tolerance of 1.0 was
opening visible gaps between regions you'd never moved. The
simplifier handed `topology()` raw float coordinates, so two paths
whose shared edge was at `x = 100.123` on one side and `x = 100.124`
on the other were treated as separate arcs. Each side's V-W weight
table came out slightly different — sometimes dropping a vertex on
one side that the other kept — and the regions pulled apart.

Tracers routinely emit those mismatches because they fit each region
independently. The fix passes a quantization grid (`1e5`) to
topojson's topology builder so coords snap to ~0.013-unit precision
before junction detection. Far below pixel size, fine enough that no
real geometry detail rounds away, coarse enough to merge the
mismatches that were causing the gaps.

Bonus: simplification is also slightly faster on dense traces because
the dedup step now collapses many more arcs.
