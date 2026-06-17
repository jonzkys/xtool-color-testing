/**
 * Relief — orbitable 3D surface preview.
 *
 * Renders a depth map as a displaced height-field surface you can orbit,
 * pan, and zoom. The parent flips ``heightData`` between the original and
 * cleaned buffers; this component just turns whichever buffer it is handed
 * into a mesh — the ``show`` prop is a label only, used for the corner tag.
 *
 * Compare mode: pass ``compareData`` and the component splits the canvas into
 * two side-by-side VIEWPORTS, each its own scene with its surface centred, and
 * drives BOTH from ONE shared camera. Orbit/zoom moves both to the identical
 * angle while each surface stays framed in its own panel — so you can study a
 * feature in both at once without one drifting out of view.
 *
 * Code-splitting: three.js is imported DYNAMICALLY inside the setup effect,
 * never at module top-level, so Rollup hoists the whole engine into its own
 * chunk that loads only when the Relief page mounts the 3D tab. Touch this
 * file's imports with care — a static ``import * as THREE`` at the top would
 * drag ~600 kB back into the main bundle.
 *
 * Lifecycle: the renderer / camera / controls are built ONCE and held in a ref.
 * Height-field changes re-displace the existing geometry in place; resize
 * updates the renderer + camera. The engine is rebuilt only when toggling
 * single↔compare (viewport layout differs) or on unmount (renderer.dispose is
 * essential — contexts leak hard otherwise, and browsers cap the live count).
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
  Vector2,
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
/** Gap (CSS px) between the two compare viewports. */
const VIEWPORT_GAP = 8;

/** Live three.js handles, created once and reused across re-renders. One scene
 *  per surface (each surface centred at the origin); a single shared camera. */
interface Engine {
  THREE: typeof import("three");
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  scenes: Scene[];
  meshes: Mesh[];
  geometries: PlaneGeometry[];
  material: MeshStandardMaterial;
  size: Vector2;
  compare: boolean;
  raf: number;
}

/**
 * Displace a PlaneGeometry's Z by sampling ``data`` (downsampled to the
 * mesh grid) → luminance 0..1 → ``z = lum * RELIEF_SCALE``. Each mesh vertex
 * AREA-AVERAGES the source pixels its cell covers, treating the (transparent)
 * background as floor — luminance 0. Nearest-sampling a coarse mesh over a
 * hard height step aliases it into a forest of spikes; averaging the WHOLE
 * cell turns every step into a clean one-cell ramp.
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

/** Add the standard key + ambient lights to a scene (each compare scene needs
 *  its own — lights don't cross scene boundaries). */
function addLights(THREE: typeof import("three"), scene: Scene) {
  const dir = new THREE.DirectionalLight(0xffffff, 1.35);
  dir.position.set(-0.8, -1.0, 1.4);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xb8b0a4, 0.55));
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
      renderer.autoClear = false; // we clear once/frame then draw each viewport
      renderer.domElement.style.display = "block";
      renderer.domElement.style.borderRadius = "8px";
      hostRef.current.appendChild(renderer.domElement);

      // Each viewport is half-width in compare; size the camera to that aspect.
      const vpW = isCompare ? (cw - VIEWPORT_GAP) / 2 : cw;
      const camera = new THREE.PerspectiveCamera(45, vpW / ch, 0.01, 100);
      const dist = isCompare ? 1.35 : 1.05;
      camera.position.set(0, -dist, dist);
      camera.up.set(0, 0, 1);
      camera.lookAt(0, 0, 0);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.6;
      controls.maxDistance = 6;
      controls.target.set(0, 0, RELIEF_SCALE * 0.4);

      const material = new THREE.MeshStandardMaterial({
        color: 0xcabfae, // warm neutral plaster — reads as a carved blank
        roughness: 0.82,
        metalness: 0.04,
        flatShading: false,
      });

      const datas = isCompare ? [hd, cd] : [hd];
      const scenes: Scene[] = [];
      const geometries: PlaneGeometry[] = [];
      const meshes: Mesh[] = [];
      datas.forEach((d) => {
        const scene = new THREE.Scene();
        const geo = d ? buildGeometry(THREE, d) : new THREE.PlaneGeometry(1, 1);
        const mesh = new THREE.Mesh(geo, material);
        scene.add(mesh);
        addLights(THREE, scene);
        scenes.push(scene);
        geometries.push(geo);
        meshes.push(mesh);
      });

      const engine: Engine = {
        THREE,
        renderer,
        camera,
        controls,
        scenes,
        meshes,
        geometries,
        material,
        size: new THREE.Vector2(cw, ch),
        compare: isCompare,
        raf: 0,
      };
      engineRef.current = engine;

      const tick = () => {
        if (disposed) return;
        engine.raf = requestAnimationFrame(tick);
        controls.update();
        const { x: sw, y: sh } = renderer.getSize(engine.size);

        // Clear the whole canvas once (incl. the gap), then draw each viewport.
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, sw, sh);
        renderer.clear();

        if (engine.scenes.length < 2) {
          renderer.render(engine.scenes[0], camera);
          return;
        }
        renderer.setScissorTest(true);
        const halfW = (sw - VIEWPORT_GAP) / 2;
        // Left viewport.
        renderer.setViewport(0, 0, halfW, sh);
        renderer.setScissor(0, 0, halfW, sh);
        renderer.render(engine.scenes[0], camera);
        // Right viewport.
        renderer.setViewport(halfW + VIEWPORT_GAP, 0, halfW, sh);
        renderer.setScissor(halfW + VIEWPORT_GAP, 0, halfW, sh);
        renderer.render(engine.scenes[1], camera);
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
      e.renderer.forceContextLoss?.();
      const canvas = e.renderer.domElement;
      canvas.parentNode?.removeChild(canvas);
    };
    // Re-run when data appears/disappears OR the single↔compare layout flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightData === null, compare]);

  // ── Re-displace on data / show change ─────────────────────────────
  // Rebuild a scene's mesh geometry when its height-field changes. We rebuild
  // rather than mutate because the segment count is a function of image
  // dimensions, which can differ across maps.
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
  }, [heightData, compareData, compare, show]);

  // ── Resize on host box change ─────────────────────────────────────
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const cw = Math.max(1, width);
    const ch = Math.max(1, height);
    e.renderer.setSize(cw, ch);
    const vpW = e.compare ? (cw - VIEWPORT_GAP) / 2 : cw;
    e.camera.aspect = vpW / ch;
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
          {/* Hairline divider between the two viewports. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10"
          />
        </>
      ) : (
        <span className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
          {show}
        </span>
      )}
    </div>
  );
}
