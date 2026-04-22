import { useEffect, useState } from "react";

export type Route =
  | { name: "tests" }
  | { name: "test-new" }
  | { name: "test-detail"; id: number }
  | { name: "svg-stack" }
  | { name: "svg-layers" }
  | { name: "library" }
  | { name: "palette" }
  | { name: "spectrum"; id?: number }
  | { name: "styleguide" };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, "").replace(/^\/+/, "");
  if (h === "" || h === "tests") return { name: "tests" };
  if (h === "tests/new") return { name: "test-new" };
  const m = h.match(/^tests\/(\d+)$/);
  if (m) return { name: "test-detail", id: Number(m[1]) };
  if (h === "svg-stack") return { name: "svg-stack" };
  if (h === "svg-layers") return { name: "svg-layers" };
  if (h === "library") return { name: "library" };
  if (h === "palette") return { name: "palette" };
  if (h === "spectrum") return { name: "spectrum" };
  const ms = h.match(/^spectrum\/(\d+)$/);
  if (ms) return { name: "spectrum", id: Number(ms[1]) };
  if (h === "styleguide") return { name: "styleguide" };
  return { name: "tests" };
}

export function formatRoute(r: Route): string {
  switch (r.name) {
    case "tests":       return "#/tests";
    case "test-new":    return "#/tests/new";
    case "test-detail": return `#/tests/${r.id}`;
    case "svg-stack":   return "#/svg-stack";
    case "svg-layers":  return "#/svg-layers";
    case "library":     return "#/library";
    case "palette":     return "#/palette";
    case "spectrum":    return r.id != null ? `#/spectrum/${r.id}` : "#/spectrum";
    case "styleguide":  return "#/styleguide";
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
