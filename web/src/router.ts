import { useEffect, useState } from "react";

export type Route =
  | { name: "tests" }
  | { name: "test-new" }
  | { name: "test-detail"; id: number }
  | { name: "loom" }
  | { name: "svg-layers" }
  | { name: "library" }
  | { name: "palette" }
  | { name: "spectrum"; id?: number }
  | { name: "spectrum-2d"; id?: number }
  | { name: "styleguide" }
  | { name: "guide" }
  | { name: "changelog" }
  | { name: "demo" }
  | { name: "mobile-upload"; mid: string };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, "").replace(/^\/+/, "");
  if (h === "" || h === "tests") return { name: "tests" };
  if (h === "tests/new") return { name: "test-new" };
  const m = h.match(/^tests\/(\d+)$/);
  if (m) return { name: "test-detail", id: Number(m[1]) };
  if (h === "loom" || h === "svg-stack") return { name: "loom" };
  if (h === "svg-layers") return { name: "svg-layers" };
  if (h === "library") return { name: "library" };
  if (h === "palette") return { name: "palette" };
  if (h === "spectrum-2d") return { name: "spectrum-2d" };
  const m2d = h.match(/^spectrum-2d\/(\d+)$/);
  if (m2d) return { name: "spectrum-2d", id: Number(m2d[1]) };
  if (h === "spectrum") return { name: "spectrum" };
  const ms = h.match(/^spectrum\/(\d+)$/);
  if (ms) return { name: "spectrum", id: Number(ms[1]) };
  if (h === "styleguide") return { name: "styleguide" };
  if (h === "guide") return { name: "guide" };
  if (h === "changelog") return { name: "changelog" };
  if (h === "demo") return { name: "demo" };
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
    case "library":     return "#/library";
    case "palette":     return "#/palette";
    case "spectrum":    return r.id != null ? `#/spectrum/${r.id}` : "#/spectrum";
    case "spectrum-2d": return r.id != null ? `#/spectrum-2d/${r.id}` : "#/spectrum-2d";
    case "styleguide":  return "#/styleguide";
    case "guide":       return "#/guide";
    case "changelog":   return "#/changelog";
    case "demo":        return "#/demo";
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
