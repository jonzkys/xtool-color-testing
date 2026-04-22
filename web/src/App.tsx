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
    <div className="flex flex-col h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-[6px] focus:bg-[color:var(--color-primary)] focus:text-white focus:text-[12px] focus:font-medium"
      >
        Skip to main content
      </a>
      <TopBar title={title} route={route} onNavigate={navigate} />
      <main id="main-content" className="flex-1 min-h-0 overflow-auto">
        {route.name === "tests"        && <TestsPage />}
        {route.name === "test-new"     && <TestDetailPage testId="new" />}
        {route.name === "test-detail"  && <TestDetailPage testId={route.id} />}
        {route.name === "svg-stack"    && <SvgStackPage />}
        {route.name === "svg-layers"   && <SvgLayersPage />}
        {route.name === "library"      && <LibraryPage onMaterialsChange={() => {}} />}
        {route.name === "palette"      && <PalettePage />}
        {route.name === "styleguide"   && <StyleguidePage />}
      </main>
    </div>
  );
}
