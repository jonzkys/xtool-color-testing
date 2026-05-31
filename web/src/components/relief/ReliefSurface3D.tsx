/**
 * Relief — orbitable 3D surface preview.
 *
 * Renders a depth map as a displaced height-field surface you can orbit,
 * pan, and zoom. The parent flips ``heightData`` between the original and
 * cleaned buffers; this component just turns whichever buffer it is handed
 * into a mesh — the ``show`` prop is a label only, used for the corner tag.
 *
 * Code-splitting: three.js is imported DYNAMICALLY inside the setup effect,
 * never at module top-level, so Rollup hoists the whole engine into its own
 * chunk that loads only when the Relief page mounts the 3D tab. Touch this
 * file's imports with care — a static ``import * as THREE`` at the top would
 * drag ~600 kB back into the main bundle.
 *
 * Lifecycle: the renderer / scene / camera / controls are built ONCE and
 * held in a ref across the component's life. Subsequent ``heightData`` /
 * ``show`` changes re-displace the existing geometry in place; ``width`` /
 * ``height`` changes resize the renderer + camera. Only unmount tears the
 * WebGL context down (renderer.dispose is essential — contexts leak hard
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
  /** The height-field to display as a surface (parent picks orig vs clean). */
  heightData: ImageData | null;
  /** Label only — the parent passes the matching ``heightData``. */
  show: "original" | "cleaned";
  /** Host box in CSS px, fed from the page's ResizeObserver. */
  width: number;
  height: number;
}

/** Peak displacement in plane-units. The plane is 1 unit wide, so 0.25
 *  gives relief that reads clearly without towering over the footprint. */
const RELIEF_SCALE = 0.25;
/** Hard cap on mesh resolution per axis — a 4k depth map must never spawn
 *  a million-vertex grid. */
const MAX_SEG = 256;

/** Live three.js handles, created once and reused across re-renders. */
interface Engine {
  THREE: typeof import("three");
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  geometry: PlaneGeometry;
  material: MeshStandardMaterial;
  mesh: Mesh;
  raf: number;
}

/**
 * Displace a PlaneGeometry's Z by sampling ``data`` (downsampled to the
 * mesh grid) → luminance 0..1 → ``z = lum * RELIEF_SCALE``. The plane is
 * built in the XY plane with ``segX+1 × segY+1`` vertices laid out
 * row-major from top-left, which lines the vertex grid up directly with
 * image rows/columns. Recomputes normals so lighting follows the surface.
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
  let i = 0;
  for (let gy = 0; gy < rows; gy++) {
    // Map this mesh row onto a source image row (nearest-sample downscale).
    const sy = rows > 1 ? Math.round((gy / (rows - 1)) * (ih - 1)) : 0;
    for (let gx = 0; gx < cols; gx++) {
      const sx = cols > 1 ? Math.round((gx / (cols - 1)) * (iw - 1)) : 0;
      const o = (sy * iw + sx) * 4;
      // Rec. 601 luma, normalised 0..1. Depth maps are grayscale so any
      // channel would do, but a weighted luma is robust to faint tints.
      const lum =
        (0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]) / 255;
      pos.setZ(i, lum * RELIEF_SCALE);
      i++;
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function ReliefSurface3D({
  heightData,
  show,
  width,
  height,
}: ReliefSurface3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  // Latest props captured for the async setup, which may resolve after a
  // few re-renders (the dynamic import is one tick at best, slower cold).
  const latest = useRef({ heightData, width, height });
  latest.current = { heightData, width, height };

  // ── Engine setup (async, once) ────────────────────────────────────
  // Built only when there's data to show. The dynamic import + WebGL
  // bring-up happen here; a `disposed` flag guards against the component
  // unmounting (or heightData going null) before the import resolves.
  useEffect(() => {
    if (!heightData) return;
    // Already built (data arrived, went away, came back) → skip; the
    // data-change effect below handles re-displacement.
    if (engineRef.current) return;

    let disposed = false;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import(
        "three/examples/jsm/controls/OrbitControls.js"
      );
      // Bail if we were torn down while the chunk loaded.
      if (disposed || !hostRef.current) return;

      const { width: w, height: h, heightData: hd } = latest.current;
      const cw = Math.max(1, w);
      const ch = Math.max(1, h);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setSize(cw, ch);
      renderer.setClearColor(0x14110f, 1); // matches the 2D compare backdrop
      renderer.domElement.style.display = "block";
      renderer.domElement.style.borderRadius = "8px";
      hostRef.current.appendChild(renderer.domElement);

      const scene = new THREE.Scene();

      const camera = new THREE.PerspectiveCamera(45, cw / ch, 0.01, 100);
      // Look down at the plane from a front-raised three-quarter angle.
      camera.position.set(0, -1.05, 1.05);
      camera.up.set(0, 0, 1);
      camera.lookAt(0, 0, 0);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.6;
      controls.maxDistance = 6;
      controls.target.set(0, 0, RELIEF_SCALE * 0.4);

      // Plane is 1 wide × (h/w) tall so the surface keeps the depth map's
      // aspect ratio. Segments downsampled from the image, capped at MAX_SEG.
      const iw = hd ? hd.width : 2;
      const ih = hd ? hd.height : 2;
      const aspect = iw > 0 ? ih / iw : 1;
      const segX = Math.max(1, Math.min(MAX_SEG, iw - 1));
      const segY = Math.max(1, Math.min(MAX_SEG, ih - 1));
      const geometry = new THREE.PlaneGeometry(1, aspect, segX, segY);

      const material = new THREE.MeshStandardMaterial({
        color: 0xcabfae, // warm neutral plaster — reads as a carved blank
        roughness: 0.82,
        metalness: 0.04,
        flatShading: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // Angled key light + soft ambient so the relief micro-geometry reads.
      const dir = new THREE.DirectionalLight(0xffffff, 1.35);
      dir.position.set(-0.8, -1.0, 1.4);
      scene.add(dir);
      scene.add(new THREE.AmbientLight(0xb8b0a4, 0.55));

      if (hd) displace(geometry, hd, segX, segY);

      const engine: Engine = {
        THREE,
        renderer,
        scene,
        camera,
        controls,
        geometry,
        material,
        mesh,
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
      e.geometry.dispose();
      e.material.dispose();
      e.renderer.dispose();
      // forceContextLoss frees the GPU context immediately rather than
      // waiting on GC — important when toggling the tab repeatedly.
      e.renderer.forceContextLoss?.();
      const canvas = e.renderer.domElement;
      canvas.parentNode?.removeChild(canvas);
    };
    // Re-run only when heightData flips between null and present; the
    // engine is built once and mutated thereafter. width/height are read
    // from `latest` at build time and handled by the resize effect after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightData === null]);

  // ── Re-displace on data / show change ─────────────────────────────
  // Rebuild the geometry when the depth map (or the orig/clean flip)
  // changes. We rebuild rather than mutate because the segment count is a
  // function of image dimensions, which can differ across maps.
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !heightData) return;
    const { THREE } = e;
    const iw = heightData.width;
    const ih = heightData.height;
    const aspect = iw > 0 ? ih / iw : 1;
    const segX = Math.max(1, Math.min(MAX_SEG, iw - 1));
    const segY = Math.max(1, Math.min(MAX_SEG, ih - 1));

    const next = new THREE.PlaneGeometry(1, aspect, segX, segY);
    displace(next, heightData, segX, segY);

    const old = e.geometry;
    e.mesh.geometry = next;
    e.geometry = next;
    old.dispose();
    // `show` is a dependency so a flip with identical dimensions still
    // re-runs (the parent swaps the heightData reference, but be explicit).
  }, [heightData, show]);

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

  return (
    <div className="relative h-full w-full">
      <div
        ref={hostRef}
        aria-label={`Relief 3D surface — ${show}`}
        className="h-full w-full touch-none select-none rounded-[8px] cursor-grab active:cursor-grabbing"
        style={{ width, height }}
      />
      {/* Corner tag echoing the 2D compare's ORIGINAL / CLEANED labels. */}
      <span className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
        {show}
      </span>
    </div>
  );
}
