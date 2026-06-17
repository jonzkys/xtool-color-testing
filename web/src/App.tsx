import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { TestsPage } from "./pages/TestsPage";
import { WelcomeDialog } from "./components/WelcomeDialog";
import { getHealth } from "./api/users";
import { hasStoredKey } from "./api/users";
import { useRoute } from "./router";
import { enterDemo } from "./api/userHeader";
import { useIsDemo } from "./hooks/useIsDemo";
import { DemoBanner } from "./components/DemoBanner";
import { ToastHost } from "./ui";

/* Route components are lazy-loaded so the initial bundle ships only
 * the Tests landing + the chrome (TopBar, WelcomeDialog, ToastHost).
 * Each page becomes its own chunk; cold visits don't pay for code
 * the user hasn't navigated to yet. ``TestsPage`` stays eager
 * because it's the default landing — lazy-loading it would add a
 * Suspense flash to every fresh visit.
 *
 * Pages export named symbols, so we wrap each ``import()`` to
 * surface ``default`` for ``React.lazy``.
 */
const TestDetailPage = lazy(() =>
  import("./pages/TestDetailPage").then((m) => ({ default: m.TestDetailPage })),
);
const LoomPage = lazy(() =>
  import("./pages/LoomPage").then((m) => ({ default: m.LoomPage })),
);
const SvgLayersPage = lazy(() =>
  import("./components/SvgLayersPage").then((m) => ({ default: m.SvgLayersPage })),
);
const PixelArtPage = lazy(() =>
  import("./pages/PixelArtPage").then((m) => ({ default: m.PixelArtPage })),
);
const LibraryPage = lazy(() =>
  import("./components/LibraryPage").then((m) => ({ default: m.LibraryPage })),
);
const PalettePage = lazy(() =>
  import("./components/PalettePage").then((m) => ({ default: m.PalettePage })),
);
const SpectrumPage = lazy(() =>
  import("./pages/SpectrumPage").then((m) => ({ default: m.SpectrumPage })),
);
const Spectrum2DPage = lazy(() =>
  import("./pages/Spectrum2DPage").then((m) => ({ default: m.Spectrum2DPage })),
);
const StabilityPage = lazy(() =>
  import("./pages/StabilityPage").then((m) => ({ default: m.StabilityPage })),
);
const StyleguidePage = lazy(() =>
  import("./pages/StyleguidePage").then((m) => ({ default: m.StyleguidePage })),
);
const GuidePage = lazy(() =>
  import("./pages/GuidePage").then((m) => ({ default: m.GuidePage })),
);
const ForgePage = lazy(() =>
  import("./pages/ForgePage").then((m) => ({ default: m.ForgePage })),
);
const SpiralPage = lazy(() =>
  import("./pages/SpiralPage").then((m) => ({ default: m.SpiralPage })),
);
const ChangelogPage = lazy(() =>
  import("./pages/ChangelogPage").then((m) => ({ default: m.ChangelogPage })),
);
const GcodeViewerPage = lazy(() =>
  import("./pages/GcodeViewerPage").then((m) => ({ default: m.GcodeViewerPage })),
);
const ReliefPage = lazy(() =>
  import("./pages/ReliefPage").then((m) => ({ default: m.ReliefPage })),
);
const SavedSpectrumsPage = lazy(() =>
  import("./pages/SavedSpectrumsPage").then((m) => ({ default: m.SavedSpectrumsPage })),
);
const ExposurePage = lazy(() =>
  import("./pages/ExposurePage").then((m) => ({ default: m.ExposurePage })),
);
const MobileUploadPage = lazy(() =>
  import("./pages/MobileUploadPage").then((m) => ({ default: m.MobileUploadPage })),
);
const DepthMapsStandalone = lazy(() =>
  import("./pages/DepthMapsStandalone").then((m) => ({
    default: m.DepthMapsStandalone,
  })),
);

/* Suspense fallback — deliberately minimal. The page-load delay is
 * dominated by network for the chunk fetch (a few hundred KB on a
 * cold hit, instant on a warm cache), so a spinner-or-shimmer would
 * just flash. The empty fallback preserves the page's frame so the
 * user doesn't see content jump when the chunk arrives. */
function PageFallback() {
  return <div className="flex-1 min-h-0" aria-hidden />;
}

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
    return (
      <Suspense fallback={<PageFallback />}>
        <MobileUploadPage mid={route.mid} />
      </Suspense>
    );
  }

  if (route.name === "depthmaps") {
    // Standalone, shareable depth-map smoother — renders alone (no TopBar,
    // no WelcomeDialog, no multi-user gate). Safe because its only backend
    // call (/api/relief/smooth) is unauthenticated and touches no user data.
    return (
      <Suspense fallback={<PageFallback />}>
        <DepthMapsStandalone onNavigate={navigate} />
      </Suspense>
    );
  }

  const title =
    route.name === "tests"        ? "Tests"
    : route.name === "test-new"   ? "New test"
    : route.name === "test-detail" ? `Test #${route.id}`
    : route.name === "loom"       ? "Loom"
    : route.name === "svg-layers" ? "SVG layers"
    : route.name === "pixel-art"  ? "Pixel art"
    : route.name === "library"    ? "Library"
    : route.name === "styleguide" ? "Styleguide"
    : route.name === "spectrum"   ? "Spectrum"
    : route.name === "spectrum-2d" ? "Spectrum · 2D"
    : route.name === "stability" ? "Stability"
    : route.name === "saved-spectrums" ? "Saved spectrums"
    : route.name === "exposure"   ? "Exposure"
    : route.name === "guide"      ? "Guide"
    : route.name === "spiral"     ? "Spiral Cut"
    : route.name === "forge"      ? "Contour Forge"
    : route.name === "changelog"  ? "Changelog"
    : route.name === "gcode"      ? "Gcode"
    : route.name === "relief"     ? "Relief"
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
        <Suspense fallback={<PageFallback />}>
          {gate === "ready" && route.name === "tests"        && <TestsPage />}
          {gate === "ready" && route.name === "test-new"     && <TestDetailPage testId="new" />}
          {gate === "ready" && route.name === "test-detail"  && <TestDetailPage testId={route.id} />}
          {gate === "ready" && route.name === "loom"         && <LoomPage />}
          {gate === "ready" && route.name === "svg-layers"   && <SvgLayersPage />}
          {gate === "ready" && route.name === "pixel-art"    && <PixelArtPage />}
          {gate === "ready" && route.name === "library"      && <LibraryPage onMaterialsChange={() => {}} />}
          {gate === "ready" && route.name === "palette"      && <PalettePage />}
          {gate === "ready" && route.name === "spectrum"     && <SpectrumPage />}
          {gate === "ready" && route.name === "spectrum-2d"  && <Spectrum2DPage />}
          {gate === "ready" && route.name === "stability"    && <StabilityPage />}
          {gate === "ready" && route.name === "styleguide"   && <StyleguidePage />}
          {gate === "ready" && route.name === "guide"        && <GuidePage />}
          {gate === "ready" && route.name === "spiral"       && <SpiralPage />}
          {gate === "ready" && route.name === "forge"        && <ForgePage />}
          {gate === "ready" && route.name === "changelog"    && <ChangelogPage />}
          {gate === "ready" && route.name === "gcode"        && <GcodeViewerPage />}
          {gate === "ready" && route.name === "relief"      && <ReliefPage />}
          {gate === "ready" && route.name === "saved-spectrums" && <SavedSpectrumsPage />}
          {gate === "ready" && route.name === "exposure"       && <ExposurePage materialId={route.materialId ?? null} />}
        </Suspense>
      </main>
      <WelcomeDialog
        open={gate === "welcome"}
        onResolved={() => setGate("ready")}
      />
      <ToastHost />
    </div>
  );
}
