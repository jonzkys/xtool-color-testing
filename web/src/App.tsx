import { useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { LoomPage } from "./pages/LoomPage";
import { SvgLayersPage } from "./components/SvgLayersPage";
import { LibraryPage } from "./components/LibraryPage";
import { PalettePage } from "./components/PalettePage";
import { TestsPage } from "./pages/TestsPage";
import { TestDetailPage } from "./pages/TestDetailPage";
import { SpectrumPage } from "./pages/SpectrumPage";
import { Spectrum2DPage } from "./pages/Spectrum2DPage";
import { StyleguidePage } from "./pages/StyleguidePage";
import { GuidePage } from "./pages/GuidePage";
import { ChangelogPage } from "./pages/ChangelogPage";
import { SavedSpectrumsPage } from "./pages/SavedSpectrumsPage";
import { WelcomeDialog } from "./components/WelcomeDialog";
import { getHealth } from "./api/users";
import { hasStoredKey } from "./api/users";
import { useRoute } from "./router";
import { MobileUploadPage } from "./pages/MobileUploadPage";
import { enterDemo } from "./api/userHeader";
import { useIsDemo } from "./hooks/useIsDemo";
import { DemoBanner } from "./components/DemoBanner";
import { ToastHost } from "./ui";

export default function App() {
  const [route, navigate] = useRoute();
  // In multi-user mode with no stored key, the app is gated behind the
  // welcome modal. `gate` is null while we're still probing /api/health.
  const [gate, setGate] = useState<"ready" | "welcome" | null>(null);
  const gateMountedRef = useRef(false);

  useEffect(() => {
    if (window.location.hash === "") navigate({ name: "tests" });
  }, [navigate]);

  const isDemo = useIsDemo();

  // ``#/demo`` is a side-effect route — enter demo mode, then bounce
  // either to the user's intended destination (``?next=<hash>``, used
  // when someone hits the welcome gate via a deep link such as
  // ``#/changelog``) or to the default Tests landing.
  const demoNext = route.name === "demo" ? route.next : undefined;
  useEffect(() => {
    if (route.name === "demo") {
      enterDemo();
      setGate("ready");
      if (demoNext) {
        window.location.hash = `#/${demoNext}`;
      } else {
        navigate({ name: "tests" });
      }
    }
  }, [route.name, demoNext, navigate]);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h) => {
        if (cancelled) return;
        gateMountedRef.current = true;
        if (h.mode === "standalone" || hasStoredKey()) setGate("ready");
        else setGate("welcome");
      })
      .catch(() => {
        if (cancelled) return;
        gateMountedRef.current = true;
        setGate("ready");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-probe the gate whenever it transitions back to null (e.g. after
  // a demo exit cleared the stored key, or after an in-tab demo entry
  // reset the gate). Reuses ``hasStoredKey`` rather than re-hitting
  // /api/health — by this point we already know the backend mode.
  useEffect(() => {
    if (gate !== null) return;
    if (!gateMountedRef.current) return;
    if (hasStoredKey()) {
      setGate("ready");
    } else {
      setGate("welcome");
    }
  }, [gate]);

  if (route.name === "mobile-upload") {
    // Mobile page renders alone — no TopBar, no WelcomeDialog, no
    // multi-user gate. The page authenticates via the mid in the URL
    // and never touches the desktop's stored api_key.
    return <MobileUploadPage mid={route.mid} />;
  }

  const title =
    route.name === "tests"        ? "Tests"
    : route.name === "test-new"   ? "New test"
    : route.name === "test-detail" ? `Test #${route.id}`
    : route.name === "loom"       ? "Loom"
    : route.name === "svg-layers" ? "SVG layers"
    : route.name === "library"    ? "Library"
    : route.name === "styleguide" ? "Styleguide"
    : route.name === "spectrum"   ? "Spectrum"
    : route.name === "spectrum-2d" ? "Spectrum · 2D"
    : route.name === "saved-spectrums" ? "Saved spectrums"
    : route.name === "guide"      ? "Guide"
    : route.name === "changelog"  ? "Changelog"
    : route.name === "demo"       ? "Demo"
    : "Palette";

  return (
    <div className="flex flex-col h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-[6px] focus:bg-[color:var(--color-primary)] focus:text-white focus:text-[12px] focus:font-medium"
      >
        Skip to main content
      </a>
      {isDemo && (
        <DemoBanner
          onExit={() => {
            // Force a re-render so the gate re-evaluates after the
            // storage slot is cleared (restored prev key → "ready";
            // no prev → "welcome").
            setGate(null);
            navigate({ name: "tests" });
          }}
        />
      )}
      <TopBar title={title} route={route} onNavigate={navigate} />
      <main id="main-content" className="flex-1 min-h-0 overflow-auto">
        {gate === "ready" && route.name === "tests"        && <TestsPage />}
        {gate === "ready" && route.name === "test-new"     && <TestDetailPage testId="new" />}
        {gate === "ready" && route.name === "test-detail"  && <TestDetailPage testId={route.id} />}
        {gate === "ready" && route.name === "loom"         && <LoomPage />}
        {gate === "ready" && route.name === "svg-layers"   && <SvgLayersPage />}
        {gate === "ready" && route.name === "library"      && <LibraryPage onMaterialsChange={() => {}} />}
        {gate === "ready" && route.name === "palette"      && <PalettePage />}
        {gate === "ready" && route.name === "spectrum"     && <SpectrumPage />}
        {gate === "ready" && route.name === "spectrum-2d"  && <Spectrum2DPage />}
        {gate === "ready" && route.name === "styleguide"   && <StyleguidePage />}
        {gate === "ready" && route.name === "guide"        && <GuidePage />}
        {gate === "ready" && route.name === "changelog"    && <ChangelogPage />}
        {gate === "ready" && route.name === "saved-spectrums" && <SavedSpectrumsPage />}
      </main>
      <WelcomeDialog
        open={gate === "welcome"}
        onResolved={() => setGate("ready")}
      />
      <ToastHost />
    </div>
  );
}
