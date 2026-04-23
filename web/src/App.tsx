import { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { SvgStackPage } from "./components/SvgStackPage";
import { SvgLayersPage } from "./components/SvgLayersPage";
import { LibraryPage } from "./components/LibraryPage";
import { PalettePage } from "./components/PalettePage";
import { TestsPage } from "./pages/TestsPage";
import { TestDetailPage } from "./pages/TestDetailPage";
import { SpectrumPage } from "./pages/SpectrumPage";
import { Spectrum2DPage } from "./pages/Spectrum2DPage";
import { StyleguidePage } from "./pages/StyleguidePage";
import { WelcomeDialog } from "./components/WelcomeDialog";
import { getHealth } from "./api/users";
import { hasStoredKey } from "./api/users";
import { useRoute } from "./router";

export default function App() {
  const [route, navigate] = useRoute();
  // In multi-user mode with no stored key, the app is gated behind the
  // welcome modal. `gate` is null while we're still probing /api/health.
  const [gate, setGate] = useState<"ready" | "welcome" | null>(null);

  useEffect(() => {
    if (window.location.hash === "") navigate({ name: "tests" });
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h) => {
        if (cancelled) return;
        if (h.mode === "standalone" || hasStoredKey()) setGate("ready");
        else setGate("welcome");
      })
      .catch(() => {
        // If the backend isn't reachable, fail open to the usual UI —
        // the app's own error surfaces are better at explaining the
        // outage than a blank page with no chrome.
        if (!cancelled) setGate("ready");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const title =
    route.name === "tests"        ? "Tests"
    : route.name === "test-new"   ? "New test"
    : route.name === "test-detail" ? `Test #${route.id}`
    : route.name === "svg-stack"  ? "SVG stack"
    : route.name === "svg-layers" ? "SVG layers"
    : route.name === "library"    ? "Library"
    : route.name === "styleguide" ? "Styleguide"
    : route.name === "spectrum"   ? "Spectrum"
    : route.name === "spectrum-2d" ? "Spectrum · 2D"
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
        {gate === "ready" && route.name === "tests"        && <TestsPage />}
        {gate === "ready" && route.name === "test-new"     && <TestDetailPage testId="new" />}
        {gate === "ready" && route.name === "test-detail"  && <TestDetailPage testId={route.id} />}
        {gate === "ready" && route.name === "svg-stack"    && <SvgStackPage />}
        {gate === "ready" && route.name === "svg-layers"   && <SvgLayersPage />}
        {gate === "ready" && route.name === "library"      && <LibraryPage onMaterialsChange={() => {}} />}
        {gate === "ready" && route.name === "palette"      && <PalettePage />}
        {gate === "ready" && route.name === "spectrum"     && <SpectrumPage />}
        {gate === "ready" && route.name === "spectrum-2d"  && <Spectrum2DPage />}
        {gate === "ready" && route.name === "styleguide"   && <StyleguidePage />}
      </main>
      <WelcomeDialog
        open={gate === "welcome"}
        onResolved={() => setGate("ready")}
      />
    </div>
  );
}
