import { useCallback, useEffect, useState } from "react";
import { BookOpen, Sparkles, UploadCloud } from "lucide-react";
import { formatRoute, type Route } from "../router";
import { cn, MetalBar, PageContainer, ThemeToggle } from "../ui";
import { UploadResultDialog } from "./UploadResultDialog";
import { AccountMenu } from "./AccountMenu";
import { MachineSwitcher } from "./MachineSwitcher";
import { getChangelog } from "../api/changelog";

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
  const [unseenChanges, setUnseenChanges] = useState(0);

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

  const refreshUnseen = useCallback(async () => {
    if (!mode) return;
    try {
      const payload = await getChangelog(mode);
      setUnseenChanges(payload.unseen_count);
    } catch {
      // Silent — TopBar badge isn't worth surfacing a toast for.
    }
  }, [mode]);

  // Once we know the mode, fetch the unseen count. Also listen for
  // the `changelog:seen` DOM event so the badge clears in the same
  // tab after the user views the page (without a round-trip).
  useEffect(() => {
    void refreshUnseen();
    const onSeen = () => setUnseenChanges(0);
    window.addEventListener("changelog:seen", onSeen);
    return () => window.removeEventListener("changelog:seen", onSeen);
  }, [refreshUnseen]);

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
            <TabLink route={route} target={{ name: "loom" }} onNavigate={onNavigate}>
              Loom
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
            <MachineSwitcher />
            {mode === "multi_user" && <AccountMenu />}
            <span
              aria-hidden="true"
              className="h-6 w-px bg-[color:var(--color-border-strong)]"
            />
            <button
              type="button"
              onClick={() => onNavigate({ name: "guide" })}
              title="Open the Getting Started guide"
              aria-label="Open the Getting Started guide"
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px]",
                "border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]",
                route.name === "guide"
                  ? "text-[color:var(--color-primary)] border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary-tint)]/40"
                  : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-primary-tint)]/40",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
              )}
            >
              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold">
                Guide
              </span>
            </button>
            <ChangelogButton
              active={route.name === "changelog"}
              unseen={unseenChanges}
              onClick={() => onNavigate({ name: "changelog" })}
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

function ChangelogButton({
  active,
  unseen,
  onClick,
}: {
  active: boolean;
  unseen: number;
  onClick: () => void;
}) {
  const hasUnseen = unseen > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={hasUnseen ? `${unseen} new update${unseen === 1 ? "" : "s"}` : "What's new"}
      aria-label="Open changelog"
      className={cn(
        "relative inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px]",
        "border bg-[color:var(--color-surface-elevated)]",
        "transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        active
          ? "text-[color:var(--color-primary)] border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary-tint)]/40"
          : hasUnseen
            // Unseen: promote to primary-accent border + subtle tint so
            // the button reads as "something here" without a noisy red
            // blob. Mirrors how the Loom badge is built.
            ? "text-[color:var(--color-primary)] border-[color:var(--color-primary)]/60 bg-[color:var(--color-primary-tint)]/50 hover:bg-[color:var(--color-primary-tint)]/70"
            : "text-[color:var(--color-ink-muted)] border-[color:var(--color-border)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-primary-tint)]/40",
      )}
    >
      <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold">
        {hasUnseen ? "New" : "Log"}
      </span>
      {hasUnseen && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[color:var(--color-primary)] px-1 font-mono text-[9px] font-bold text-white"
        >
          {unseen > 9 ? "9+" : unseen}
        </span>
      )}
    </button>
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
