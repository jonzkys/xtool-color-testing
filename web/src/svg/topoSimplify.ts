/**
 * Topology-preserving simplification for a batch of SVG shapes.
 *
 * The hook the rest of the pipeline plugs into is :func:`simplifyTopology`.
 * It accepts a list of ``ShapeInput`` (one per source SVG element, each
 * with one or more rings) and returns the same list with the points
 * within each ring reduced via Visvalingam-Whyatt, but with WEIGHT
 * PROPAGATION across shared edges so that adjacent rings stay aligned.
 *
 * Pipeline:
 *   1. Each ring becomes a Polygon (closed) or LineString (open) Feature
 *      tagged with the source shape id and ring index.
 *   2. ``topojson-server.topology()`` builds a planar topology, inferring
 *      junctions where 3+ rings meet (the points that V-W must keep).
 *      Coincident edges are stored as ONE arc, referenced by both sides.
 *   3. ``topojson-simplify.presimplify()`` annotates each interior vertex
 *      with the V-W triangle area it would lose if dropped.
 *   4. ``topojson-simplify.simplify(topo, weight)`` drops vertices whose
 *      annotated weight falls below the threshold. Because shared arcs
 *      are stored once, the same vertices get dropped from both sides
 *      simultaneously — no slivers.
 *   5. ``topojson-client.feature()`` rebuilds Feature geometries from
 *      the simplified arcs; we tag-match back to the original shapes.
 *
 * The function is pure — no DOM access. Caller is responsible for
 * parsing SVG into ``ShapeInput`` and writing the simplified rings back.
 */

import { topology } from "topojson-server";
import { presimplify, simplify as topoSimplify } from "topojson-simplify";
import { feature } from "topojson-client";
import type { Pt } from "./svgGeometry";

export interface RingInput {
  closed: boolean;
  points: Pt[];
}

export interface ShapeInput {
  id: string;
  rings: RingInput[];
}

export type ShapeOutput = ShapeInput;

/** Quantization grid passed to ``topojson-server.topology()`` so its
 *  junction detector hashes coords-on-a-grid rather than raw floats.
 *
 *  Without this, traced-image SVGs (vtracer, Potrace, Adobe export)
 *  routinely emit adjacent paths whose shared edges are off by
 *  sub-pixel amounts (e.g. one path's right boundary at ``x = 100.123``
 *  and the neighbour's left at ``x = 100.124``). They render
 *  seamlessly because they overlap by fractions of a pixel, but
 *  topology() treats those edges as independent arcs. V-W on each
 *  side then moves those arcs independently and the regions pull
 *  apart, opening gaps far larger than the simplification tolerance —
 *  the bug the user actually sees ("white gaps forming much larger
 *  than the simplification").
 *
 *  ``q = 1e5`` snaps coords onto a grid with precision = max(width,
 *  height) ÷ 100,000. For a 1344 × 768 SVG that's ~0.013 user units —
 *  far below display pixel size, far finer than any tracer's vertex
 *  precision. Sub-pixel mismatches collapse onto the same grid point;
 *  shared edges become single arcs again. */
const TOPOLOGY_QUANTIZATION = 1e5;

/** Run V-W with topology-preserving weight propagation across shared
 *  arcs. ``weight`` is twice-the-triangle-area in input-coord² units —
 *  a vertex is dropped when the triangle it forms with its neighbours
 *  has area < ``weight / 2``. Pass ``0`` to skip simplification.
 *
 *  Returns shapes in the same order as the input; ring counts and
 *  ring closure flags are preserved exactly. Shapes whose features
 *  collapse below 4 vertices (closed) or 2 (open) — degenerate after
 *  simplification — are returned with their original rings, not
 *  empty, so the caller's element doesn't render as a hole. */
export function simplifyTopology(
  shapes: ShapeInput[], weight: number,
): ShapeOutput[] {
  if (shapes.length === 0) return [];

  // 1. Build a GeoJSON FeatureCollection. Each ring is its own Feature
  //    so the topology builder sees the shared edges across shapes
  //    without polygon-vs-hole grouping confusing things. Tag every
  //    feature with `_shapeId` and `_ringIndex` so we can put the
  //    rings back on the right elements after simplification.
  const features: GeoJSONFeature[] = [];
  for (const sh of shapes) {
    for (let ri = 0; ri < sh.rings.length; ri++) {
      const r = sh.rings[ri];
      if (r.points.length < 2) continue;
      const coords: number[][] = r.points.map((p) => [p.x, p.y]);
      if (r.closed) {
        // GeoJSON polygons require the first vertex repeated at the end.
        if (
          coords.length > 0
          && (coords[0][0] !== coords[coords.length - 1][0]
              || coords[0][1] !== coords[coords.length - 1][1])
        ) {
          coords.push([coords[0][0], coords[0][1]]);
        }
        features.push({
          type: "Feature",
          properties: { _shapeId: sh.id, _ringIndex: ri, _closed: true },
          geometry: { type: "Polygon", coordinates: [coords] },
        });
      } else {
        features.push({
          type: "Feature",
          properties: { _shapeId: sh.id, _ringIndex: ri, _closed: false },
          geometry: { type: "LineString", coordinates: coords },
        });
      }
    }
  }
  if (features.length === 0) {
    return shapes.map((s) => ({ id: s.id, rings: s.rings }));
  }

  const fc: GeoJSONFeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  // 2. Build topology. Each named object becomes a TopoJSON object;
  //    we pack the FeatureCollection under a single key. Pass the
  //    quantization parameter so the junction detector hashes
  //    coords-on-a-grid instead of raw floats — see
  //    ``TOPOLOGY_QUANTIZATION`` for the rationale.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo: any = topology({ shapes: fc as any }, TOPOLOGY_QUANTIZATION);

  // 3 + 4. presimplify annotates V-W weights on every coordinate;
  //   simplify(topo, weight) drops vertices whose weight is below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pre: any = presimplify(topo);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const simplified: any =
    weight > 0 ? topoSimplify(pre, weight) : pre;

  // 5. Convert back to a FeatureCollection. The runtime returns a
  //    FeatureCollection because we packed the source as a
  //    FeatureCollection — topojson-client's type signature is
  //    over-narrow, hence the `unknown` hop.
  const out = feature(simplified, simplified.objects.shapes) as unknown as
    GeoJSONFeatureCollection;

  // Bucket simplified rings back onto their source shapes.
  const byId = new Map<string, RingInput[]>();
  for (const sh of shapes) byId.set(sh.id, []);

  for (const f of out.features) {
    const props = (f.properties ?? {}) as {
      _shapeId?: string; _ringIndex?: number; _closed?: boolean;
    };
    const id = props._shapeId;
    const closed = !!props._closed;
    if (!id || !byId.has(id)) continue;
    const slot = byId.get(id)!;
    const ri = props._ringIndex ?? slot.length;
    let pts: Pt[] = [];
    if (f.geometry.type === "Polygon") {
      const ring = f.geometry.coordinates[0] ?? [];
      pts = ring.map((c: number[]) => ({ x: c[0], y: c[1] }));
      // Strip the closing duplicate vertex topojson re-adds.
      if (
        pts.length >= 2
        && pts[0].x === pts[pts.length - 1].x
        && pts[0].y === pts[pts.length - 1].y
      ) {
        pts.pop();
      }
    } else if (f.geometry.type === "LineString") {
      pts = (f.geometry.coordinates as number[][]).map((c) => ({ x: c[0], y: c[1] }));
    }
    slot[ri] = { closed, points: pts };
  }

  // Reconstitute in input shape order. Replace any slot that came back
  // empty/degenerate with the original ring so the caller never sees
  // a vanished shape — V-W can over-prune a triangle to two points,
  // which would crash the SVG renderer.
  return shapes.map((sh) => {
    const got = byId.get(sh.id) ?? [];
    const rings: RingInput[] = sh.rings.map((orig, ri) => {
      const r = got[ri];
      if (!r) return orig;
      const minPts = r.closed ? 3 : 2;
      if (r.points.length < minPts) return orig;
      return r;
    });
    return { id: sh.id, rings };
  });
}

// --- Local GeoJSON types (avoiding the heavy @types/geojson dep) -----------

interface GeoJSONFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "LineString"; coordinates: number[][] };
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}
