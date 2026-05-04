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
            <TabLink route={route} target={{ name: "stability" }} onNavigate={onNavigate}>
              Stability
            </TabLink>
            <TabLink route={route} target={{ name: "saved-spectrums" }} onNavigate={onNavigate}>
              Saved
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
            <a
              href="https://github.com/jonzkys/xtool-color-testing"
              target="_blank"
              rel="noopener noreferrer"
              title="View source on GitHub"
              aria-label="View source on GitHub (opens in new tab)"
              className={cn(
                "inline-flex items-center justify-center h-7 w-7 rounded-[6px]",
                "border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]",
                "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)]",
                "hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-primary-tint)]/40",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
              )}
            >
              {/* GitHub mark — lucide-react v1.8 dropped brand icons; inline SVG keeps the real octocat */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </a>
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
