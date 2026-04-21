import { useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { SvgStackPage } from "./components/SvgStackPage";
import { SvgLayersPage } from "./components/SvgLayersPage";
import { LibraryPage } from "./components/LibraryPage";
import { PalettePage } from "./components/PalettePage";
import { TestsPage } from "./pages/TestsPage";
import { TestDetailPage } from "./pages/TestDetailPage";
import { StyleguidePage } from "./pages/StyleguidePage";
import { useRoute } from "./router";

export default function App() {
  const [route, navigate] = useRoute();

  useEffect(() => {
    if (window.location.hash === "") navigate({ name: "tests" });
  }, [navigate]);

  const title =
    route.name === "tests"        ? "Tests"
    : route.name === "test-new"   ? "New test"
    : route.name === "test-detail" ? `Test #${route.id}`
    : route.name === "svg-stack"  ? "SVG stack"
    : route.name === "svg-layers" ? "SVG layers"
    : route.name === "library"    ? "Library"
    : route.name === "styleguide" ? "Styleguide"
    : "Palette";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar title={title} route={route} onNavigate={navigate} />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {route.name === "tests"        && <TestsPage />}
        {route.name === "test-new"     && <TestDetailPage testId="new" />}
        {route.name === "test-detail"  && <TestDetailPage testId={route.id} />}
        {route.name === "svg-stack"    && <SvgStackPage />}
        {route.name === "svg-layers"   && <SvgLayersPage />}
        {route.name === "library"      && <LibraryPage onMaterialsChange={() => {}} />}
        {route.name === "palette"      && <PalettePage />}
        {route.name === "styleguide"   && <StyleguidePage />}
      </div>
    </div>
  );
}
