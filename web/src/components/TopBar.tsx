import { formatRoute, type Route } from "../router";

interface Props {
  title: string;
  route: Route;
  onNavigate: (r: Route) => void;
}

export function TopBar({ title, route, onNavigate }: Props) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 16px", background: "white", borderBottom: "1px solid #ddd",
    }}>
      <div style={{ fontWeight: 600, fontSize: 16 }}>xcs-gen</div>
      <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
        <TabLink route={route} target={{ name: "tests" }} onNavigate={onNavigate}>Tests</TabLink>
        <TabLink route={route} target={{ name: "svg-stack" }} onNavigate={onNavigate}>SVG stack</TabLink>
        <TabLink route={route} target={{ name: "svg-layers" }} onNavigate={onNavigate}>SVG layers</TabLink>
        <TabLink route={route} target={{ name: "library" }} onNavigate={onNavigate}>Library</TabLink>
        <TabLink route={route} target={{ name: "palette" }} onNavigate={onNavigate}>Palette</TabLink>
      </div>
      <div style={{ color: "#888" }}>|</div>
      <div style={{ color: "#555" }}>{title}</div>
      <div style={{ flex: 1 }} />
    </div>
  );
}

function TabLink({ route, target, onNavigate, children }: {
  route: Route; target: Route; onNavigate: (r: Route) => void; children: React.ReactNode;
}) {
  const active = route.name === target.name ||
    (target.name === "tests" && (route.name === "test-new" || route.name === "test-detail"));
  return (
    <a href={formatRoute(target)}
       onClick={e => { e.preventDefault(); onNavigate(target); }}
       style={{
         padding: "6px 12px",
         border: "1px solid " + (active ? "#336" : "#ddd"),
         background: active ? "#e8ecf3" : "white",
         color: active ? "#336" : "#555",
         borderRadius: 4, fontWeight: active ? 600 : 400, fontSize: 13,
         textDecoration: "none",
       }}>{children}</a>
  );
}
