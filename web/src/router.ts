import { useEffect, useState } from "react";

export type Route =
  | { name: "tests" }
  | { name: "test-new" }
  | { name: "test-detail"; id: number }
  | { name: "loom" }
  | { name: "svg-layers" }
  | { name: "pixel-art" }
  | { name: "library" }
  | { name: "palette" }
  | { name: "exposure"; materialId?: number }
  | { name: "spectrum"; id?: number }
  | { name: "spectrum-2d"; id?: number }
  | { name: "stability"; id?: number; cell?: number }
  | { name: "styleguide" }
  | { name: "guide" }
  | { name: "spiral" }
  | { name: "forge" }
  | { name: "changelog" }
  | { name: "gcode" }
  | { name: "relief" }
  | { name: "depthmaps" }
  | { name: "demo"; next?: string }
  | { name: "saved-spectrums" }
  | { name: "mobile-upload"; mid: string };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, "").replace(/^\/+/, "");
  if (h === "" || h === "tests") return { name: "tests" };
  if (h === "tests/new") return { name: "test-new" };
  const m = h.match(/^tests\/(\d+)$/);
  if (m) return { name: "test-detail", id: Number(m[1]) };
  if (h === "loom" || h === "svg-stack") return { name: "loom" };
  if (h === "svg-layers") return { name: "svg-layers" };
  if (h === "pixel-art") return { name: "pixel-art" };
  if (h === "library") return { name: "library" };
  if (h === "palette") return { name: "palette" };
  if (h === "exposure") return { name: "exposure" };
  const me = h.match(/^exposure\/(\d+)$/);
  if (me) return { name: "exposure", materialId: Number(me[1]) };
  if (h === "spectrum-2d") return { name: "spectrum-2d" };
  const m2d = h.match(/^spectrum-2d\/(\d+)$/);
  if (m2d) return { name: "spectrum-2d", id: Number(m2d[1]) };
  if (h === "spectrum") return { name: "spectrum" };
  if (h === "saved-spectrums") return { name: "saved-spectrums" };
  const ms = h.match(/^spectrum\/(\d+)$/);
  if (ms) return { name: "spectrum", id: Number(ms[1]) };
  if (h === "stability") return { name: "stability" };
  // ``#/stability/<id>`` and ``#/stability/<id>?cell=<n>`` — the
  // optional ``cell`` query param deep-links to a specific cell so
  // the palette page can navigate "this validated entry → its
  // source cell" in one click.
  const mstCell = h.match(/^stability\/(\d+)\?cell=(\d+)$/);
  if (mstCell) {
    return {
      name: "stability",
      id: Number(mstCell[1]),
      cell: Number(mstCell[2]),
    };
  }
  const mst = h.match(/^stability\/(\d+)$/);
  if (mst) return { name: "stability", id: Number(mst[1]) };
  if (h === "styleguide") return { name: "styleguide" };
  if (h === "guide") return { name: "guide" };
  if (h === "spiral") return { name: "spiral" };
  if (h === "forge") return { name: "forge" };
  if (h === "changelog") return { name: "changelog" };
  if (h === "gcode") return { name: "gcode" };
  if (h === "relief") return { name: "relief" };
  // Standalone, shareable depth-map smoother — rendered alone (no menu/gate)
  // by App.tsx, never added to the TopBar menu.
  if (h === "depthmaps") return { name: "depthmaps" };
  // ``#/demo`` accepts an optional ``?next=<hash>`` so a deep link
  // (e.g. someone shared #/changelog) survives the welcome → demo
  // detour. Anything else stays at the default landing page.
  if (h === "demo") return { name: "demo" };
  const demoNext = h.match(/^demo\?next=(.+)$/);
  if (demoNext) return { name: "demo", next: decodeURIComponent(demoNext[1]) };
  const mm = h.match(/^m\/([A-Za-z0-9_\-]+)$/);
  if (mm) return { name: "mobile-upload", mid: mm[1] };
  return { name: "tests" };
}

export function formatRoute(r: Route): string {
  switch (r.name) {
    case "tests":       return "#/tests";
    case "test-new":    return "#/tests/new";
    case "test-detail": return `#/tests/${r.id}`;
    case "loom":        return "#/loom";
    case "svg-layers":  return "#/svg-layers";
    case "pixel-art":   return "#/pixel-art";
    case "library":     return "#/library";
    case "palette":     return "#/palette";
    case "exposure":    return r.materialId == null ? "#/exposure" : `#/exposure/${r.materialId}`;
    case "spectrum":    return r.id != null ? `#/spectrum/${r.id}` : "#/spectrum";
    case "spectrum-2d": return r.id != null ? `#/spectrum-2d/${r.id}` : "#/spectrum-2d";
    case "stability": {
      if (r.id == null) return "#/stability";
      return r.cell != null
        ? `#/stability/${r.id}?cell=${r.cell}`
        : `#/stability/${r.id}`;
    }
    case "saved-spectrums": return "#/saved-spectrums";
    case "styleguide":  return "#/styleguide";
    case "guide":       return "#/guide";
    case "spiral":      return "#/spiral";
    case "forge":       return "#/forge";
    case "changelog":   return "#/changelog";
    case "gcode":       return "#/gcode";
    case "relief":      return "#/relief";
    case "depthmaps":   return "#/depthmaps";
    case "demo":        return r.next ? `#/demo?next=${encodeURIComponent(r.next)}` : "#/demo";
    case "mobile-upload": return `#/m/${r.mid}`;
  }
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (r: Route) => { window.location.hash = formatRoute(r); };
  return [route, navigate];
}
