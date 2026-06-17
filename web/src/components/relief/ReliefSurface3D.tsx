/**
 * Relief — orbitable 3D surface preview.
 *
 * Renders a depth map as a displaced height-field surface you can orbit,
 * pan, and zoom. The parent flips ``heightData`` between the original and
 * cleaned buffers; this component just turns whichever buffer it is handed
 * into a mesh — the ``show`` prop is a label only, used for the corner tag.
 *
 * Compare mode: pass ``compareData`` and the component renders TWO surfaces
 * side by side in ONE scene sharing ONE camera — orbit/zoom moves both
 * identically, so the eye compares the same angle. ``heightData`` is the
 * left surface, ``compareData`` the right; ``labels`` tags each.
 *
 * Code-splitting: three.js is imported DYNAMICALLY inside the setup effect,
 * never at module top-level, so Rollup hoists the whole engine into its own
 * chunk that loads only when the Relief page mounts the 3D tab. Touch this
 * file's imports with care — a static ``import * as THREE`` at the top would
 * drag ~600 kB back into the main bundle.
 *
 * Lifecycle: the renderer / scene / camera / controls are built ONCE and
 * held in a ref across the component's life. Subsequent height-field changes
 * re-displace the existing geometry in place; ``width`` / ``height`` changes
 * resize the renderer + camera. The engine is torn down and rebuilt only
 * when toggling between single and compare (the mesh count + framing differ)
 * or on unmount (renderer.dispose is essential — contexts leak hard
 * otherwise, and browsers cap the number of live ones).
 */

import { useEffect, useRef } from "react";
// Type-only imports are erased at compile time, so they do NOT pull three
// into the bundle — they just give us real types for the engine handles we
// stash in the ref. The runtime engine arrives via `await import("three")`.
import type {
  WebGLRenderer,
  PerspectiveCamera,
  Scene,
  Mesh,
  PlaneGeometry,
  MeshStandardMaterial,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface ReliefSurface3DProps {
  /** The height-field to display (single mode) or the LEFT surface (compare). */
  heightData: ImageData | null;
  /** Label only — the parent passes the matching ``heightData``. */
  show: "original" | "cleaned";
  /** Host box in CSS px, fed from the page's ResizeObserver. */
  width: number;
  height: number;
  /** When set, render a second surface to the RIGHT sharing one camera. */
  compareData?: ImageData | null;
  /** Corner tags for [left, right] in compare mode. */
  labels?: [string, string];
}

/** Peak displacement in plane-units. The plane is 1 unit wide, so 0.25
 *  gives relief that reads clearly without towering over the footprint. */
const RELIEF_SCALE = 0.25;
/** Hard cap on mesh resolution per axis — a 4k depth map must never spawn
 *  a million-vertex grid. */
const MAX_SEG = 256;
/** Half the gap between the two planes in compare mode (plane = 1 wide). */
const HALF_GAP = 0.09;

/** Live three.js handles, created once and reused across re-renders. */
interface Engine {
  THREE: typeof import("three");
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  geometries: PlaneGeometry[];
  meshes: Mesh[];
  material: MeshStandardMaterial;
  raf: number;
}

/** X-offset (plane-units) of surface ``i`` of ``count``. One surface is
 *  centred; two straddle the origin with a small gap so the camera frames
 *  both symmetrically. */
function xOffsetFor(i: number, count: number): number {
  if (count < 2) return 0;
  return i === 0 ? -(0.5 + HALF_GAP) : 0.5 + HALF_GAP;
}

/**
 * Displace a PlaneGeometry's Z by sampling ``data`` (downsampled to the
 * mesh grid) → luminance 0..1 → ``z = lum * RELIEF_SCALE``. The plane is
 * built in the XY plane with ``segX+1 × segY+1`` vertices laid out
 * row-major from top-left, which lines the vertex grid up directly with
 * image rows/columns. Recomputes normals so lighting follows the surface.
 *
 * Each mesh vertex AREA-AVERAGES the source pixels its cell covers, treating
 * the (transparent) background as floor — luminance 0. Nearest-sampling a
 * coarse mesh over a hard height step (a raised edge border meeting the
 * floor) aliases it into a forest of spikes; averaging the WHOLE cell turns
 * every step into a clean one-cell ramp.
 */
function displace(
  geometry: PlaneGeometry,
  data: ImageData,
  segX: number,
  segY: number,
) {
  const pos = geometry.attributes.position;
  const { width: iw, height: ih, data: px } = data;
  const cols = segX + 1;
  const rows = segY + 1;
  const stepX = cols > 1 ? iw / cols : iw;
  const stepY = rows > 1 ? ih / rows : ih;
  const halfX = Math.max(1, Math.round(stepX));
  const halfY = Math.max(1, Math.round(stepY));
  let i = 0;
  for (let gy = 0; gy < rows; gy++) {
    const cy = rows > 1 ? Math.round((gy / (rows - 1)) * (ih - 1)) : 0;
    const y0 = Math.max(0, cy - halfY);
    const y1 = Math.min(ih - 1, cy + halfY);
    for (let gx = 0; gx < cols; gx++) {
      const cx = cols > 1 ? Math.round((gx / (cols - 1)) * (iw - 1)) : 0;
      const x0 = Math.max(0, cx - halfX);
      const x1 = Math.min(iw - 1, cx + halfX);
      let sum = 0;
      let n = 0;
      for (let sy = y0; sy <= y1; sy++) {
        let o = (sy * iw + x0) * 4;
        for (let sx = x0; sx <= x1; sx++) {
          sum += 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
          o += 4;
          n++;
        }
      }
      const lum = (n > 0 ? sum / n : 0) / 255;
      pos.setZ(i, lum * RELIEF_SCALE);
      i++;
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** Build a centred 1×aspect plane sized to ``data`` and displace it. */
function buildGeometry(
  THREE: typeof import("three"),
  data: ImageData,
): PlaneGeometry {
  const iw = data.width;
  const ih = data.height;
  const aspect = iw > 0 ? ih / iw : 1;
  const segX = Math.max(1, Math.min(MAX_SEG, iw - 1));
  const segY = Math.max(1, Math.min(MAX_SEG, ih - 1));
  const geo = new THREE.PlaneGeometry(1, aspect, segX, segY);
  displace(geo, data, segX, segY);
  return geo;
}

export function ReliefSurface3D({
  heightData,
  show,
  width,
  height,
  compareData = null,
  labels,
}: ReliefSurface3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const compare = compareData != null;
  // Latest props captured for the async setup, which may resolve after a
  // few re-renders (the dynamic import is one tick at best, slower cold).
  const latest = useRef({ heightData, compareData, width, height });
  latest.current = { heightData, compareData, width, height };

  // ── Engine setup (async) ──────────────────────────────────────────
  // Built when there's data to show, and rebuilt when toggling between
  // single and compare (the mesh count + camera framing differ). The
  // `disposed` flag guards against teardown before the import resolves.
  useEffect(() => {
    if (!heightData) return;
    if (engineRef.current) return;

    let disposed = false;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import(
        "three/examples/jsm/controls/OrbitControls.js"
      );
      if (disposed || !hostRef.current) return;

      const {
        width: w,
        height: h,
        heightData: hd,
        compareData: cd,
      } = latest.current;
      const cw = Math.max(1, w);
      const ch = Math.max(1, h);
      const isCompare = cd != null;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setSize(cw, ch);
      renderer.setClearColor(0x14110f, 1); // matches the 2D compare backdrop
      renderer.domElement.style.display = "block";
      renderer.domElement.style.borderRadius = "8px";
      hostRef.current.appendChild(renderer.domElement);

      const scene = new THREE.Scene();

      const camera = new THREE.PerspectiveCamera(45, cw / ch, 0.01, 100);
      // Look down at the plane(s) from a front-raised three-quarter angle.
      // Compare mode pulls the camera back so both planes fit the frame.
      const dist = isCompare ? 1.95 : 1.05;
      camera.position.set(0, -dist, dist);
      camera.up.set(0, 0, 1);
      camera.lookAt(0, 0, 0);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.6;
      controls.maxDistance = isCompare ? 10 : 6;
      controls.target.set(0, 0, RELIEF_SCALE * 0.4);

      const material = new THREE.MeshStandardMaterial({
        color: 0xcabfae, // warm neutral plaster — reads as a carved blank
        roughness: 0.82,
        metalness: 0.04,
        flatShading: false,
      });

      const datas = isCompare ? [hd, cd] : [hd];
      const geometries: PlaneGeometry[] = [];
      const meshes: Mesh[] = [];
      datas.forEach((d, idx) => {
        const geo = d ? buildGeometry(THREE, d) : new THREE.PlaneGeometry(1, 1);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.x = xOffsetFor(idx, datas.length);
        scene.add(mesh);
        geometries.push(geo);
        meshes.push(mesh);
      });

      // Angled key light + soft ambient so the relief micro-geometry reads.
      const dir = new THREE.DirectionalLight(0xffffff, 1.35);
      dir.position.set(-0.8, -1.0, 1.4);
      scene.add(dir);
      scene.add(new THREE.AmbientLight(0xb8b0a4, 0.55));

      const engine: Engine = {
        THREE,
        renderer,
        scene,
        camera,
        controls,
        geometries,
        meshes,
        material,
        raf: 0,
      };
      engineRef.current = engine;

      const tick = () => {
        if (disposed) return;
        engine.raf = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
      };
      tick();
    })();

    return () => {
      disposed = true;
      const e = engineRef.current;
      engineRef.current = null;
      if (!e) return;
      cancelAnimationFrame(e.raf);
      e.controls.dispose();
      e.geometries.forEach((g) => g.dispose());
      e.material.dispose();
      e.renderer.dispose();
      // forceContextLoss frees the GPU context immediately rather than
      // waiting on GC — important when toggling the tab repeatedly.
      e.renderer.forceContextLoss?.();
      const canvas = e.renderer.domElement;
      canvas.parentNode?.removeChild(canvas);
    };
    // Re-run when data appears/disappears OR the single↔compare mode flips;
    // width/height are read from `latest` at build time and handled by the
    // resize effect after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightData === null, compare]);

  // ── Re-displace on data / show change ─────────────────────────────
  // Rebuild a mesh's geometry when its height-field changes. We rebuild
  // rather than mutate because the segment count is a function of image
  // dimensions, which can differ across maps. mesh.position (the x-offset)
  // is preserved across the geometry swap.
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !heightData) return;
    const datas = compare ? [heightData, compareData] : [heightData];
    datas.forEach((d, idx) => {
      const mesh = e.meshes[idx];
      if (!mesh || !d) return;
      const next = buildGeometry(e.THREE, d);
      const old = e.geometries[idx];
      mesh.geometry = next;
      e.geometries[idx] = next;
      old.dispose();
    });
    // `show` is a dep so a single-mode flip with identical dimensions still
    // re-runs (the parent swaps the heightData reference, but be explicit).
  }, [heightData, compareData, compare, show]);

  // ── Resize on host box change ─────────────────────────────────────
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const cw = Math.max(1, width);
    const ch = Math.max(1, height);
    e.renderer.setSize(cw, ch);
    e.camera.aspect = cw / ch;
    e.camera.updateProjectionMatrix();
  }, [width, height]);

  // ── Empty state ───────────────────────────────────────────────────
  if (!heightData) {
    return (
      <div
        className="flex h-full w-full items-center justify-center rounded-[8px] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]"
        style={{ minHeight: 200 }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)]">
            No depth map
          </span>
          <span className="max-w-[260px] text-[12px] text-[color:var(--color-ink-muted)]">
            Upload a grayscale depth map to orbit the relief as a 3D
            surface.
          </span>
        </div>
      </div>
    );
  }

  const leftLabel = compare ? (labels?.[0] ?? "original") : show;
  const rightLabel = labels?.[1] ?? "cleaned";

  return (
    <div className="relative h-full w-full">
      <div
        ref={hostRef}
        aria-label={
          compare
            ? `Relief 3D surface — ${leftLabel} vs ${rightLabel}`
            : `Relief 3D surface — ${show}`
        }
        className="h-full w-full touch-none select-none rounded-[8px] cursor-grab active:cursor-grabbing"
        style={{ width, height }}
      />
      {/* Corner tags echoing the 2D compare's ORIGINAL / CLEANED labels. */}
      {compare ? (
        <>
          <span className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
            {leftLabel}
          </span>
          <span className="pointer-events-none absolute right-3 top-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
            {rightLabel}
          </span>
        </>
      ) : (
        <span className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
          {show}
        </span>
      )}
    </div>
  );
}
