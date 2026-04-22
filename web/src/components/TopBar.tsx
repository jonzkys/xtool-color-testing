import { useEffect, useState } from "react";
import { UploadCloud } from "lucide-react";
import { formatRoute, type Route } from "../router";
import { cn, MetalBar, PageContainer, ThemeToggle } from "../ui";
import { UploadResultDialog } from "./UploadResultDialog";
import { AccountMenu } from "./AccountMenu";

interface Props {
  title: string;
  route: Route;
  onNavigate: (r: Route) => void;
}

/**
 * App chrome. Stays full-width so the metallic bar and the border beneath
 * span edge-to-edge; the inner row uses PageContainer to match page content.
 */
export function TopBar({ title, route, onNavigate }: Props) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mode, setMode] = useState<"standalone" | "multi_user" | null>(null);

  // Probe the backend once so we can render a mode badge + user chip
  // when running in multi-user mode. Intentionally silent on failure
  // — the chrome stays minimal if the health endpoint is unreachable.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j: { mode?: "standalone" | "multi_user" }) => {
        if (j.mode === "standalone" || j.mode === "multi_user") setMode(j.mode);
      })
      .catch(() => {});
  }, []);

  return (
    <header className="shrink-0 bg-[color:var(--color-surface)] border-b border-[color:var(--color-border)]">
      <PageContainer bleed={false}>
        <div className="flex items-center gap-6 h-14">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[15px] font-semibold tracking-tight text-[color:var(--color-ink)]">
              xcs-gen
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)]">
              workbench
            </span>
          </div>
          <nav className="flex items-center gap-1">
            <TabLink route={route} target={{ name: "tests" }} onNavigate={onNavigate}>
              Tests
            </TabLink>
            <TabLink route={route} target={{ name: "svg-stack" }} onNavigate={onNavigate}>
              SVG stack
            </TabLink>
            <TabLink route={route} target={{ name: "svg-layers" }} onNavigate={onNavigate}>
              SVG layers
            </TabLink>
            <TabLink route={route} target={{ name: "library" }} onNavigate={onNavigate}>
              Library
            </TabLink>
            <TabLink route={route} target={{ name: "palette" }} onNavigate={onNavigate}>
              Palette
            </TabLink>
            <TabLink route={route} target={{ name: "spectrum" }} onNavigate={onNavigate}>
              Spectrum
            </TabLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[12.5px] text-[color:var(--color-ink-muted)]">{title}</span>
            {mode === "multi_user" && <AccountMenu />}
            <span
              aria-hidden="true"
              className="h-6 w-px bg-[color:var(--color-border-strong)]"
            />
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              title="Upload test photo"
              aria-label="Upload test photo"
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px]",
                "border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]",
                "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)]",
                "hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-primary-tint)]/40",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
              )}
            >
              <UploadCloud className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold">
                Upload
              </span>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </PageContainer>
      <MetalBar />
      <UploadResultDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </header>
  );
}

function TabLink({
  route,
  target,
  onNavigate,
  children,
}: {
  route: Route;
  target: Route;
  onNavigate: (r: Route) => void;
  children: React.ReactNode;
}) {
  const active =
    route.name === target.name ||
    (target.name === "tests" && (route.name === "test-new" || route.name === "test-detail"));

  return (
    <a
      href={formatRoute(target)}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(target);
      }}
      className={cn(
        "relative px-3 h-14 inline-flex items-center text-[13px]",
        "transition-colors no-underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)] focus-visible:ring-inset",
        active
          ? "text-[color:var(--color-primary)] font-medium"
          : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
        active &&
          "after:absolute after:left-3 after:right-3 after:bottom-[-1px] after:h-[2px] after:bg-[color:var(--color-primary)] after:rounded-full",
      )}
    >
      {children}
    </a>
  );
}
