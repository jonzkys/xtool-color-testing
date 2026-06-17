/**
 * Depth Maps — standalone, shareable wrapper around the Relief tool.
 *
 * Mounted by ``App.tsx`` for ``#/depthmaps`` via an early return BEFORE the
 * multi-user gate / TopBar / WelcomeDialog (the same pattern ``mobile-upload``
 * uses). So the page renders with no app menu and no registration / demo
 * prompt — the URL can be shared with anyone. It's safe to expose because
 * ``ReliefPage``'s only backend call (``POST /api/relief/smooth``) is an
 * unauthenticated, stateless compute endpoint that touches no user data.
 *
 * The only chrome is a slim 56px header (matching the TopBar height so
 * ``ReliefPage``'s ``calc(100dvh - 56px)`` root fits unchanged): a wordmark,
 * a theme toggle, a GitHub link, and a "Main App" button back into the full app.
 */

import { useEffect } from "react";
import { type Route } from "../router";
import { Button, PageContainer, ThemeToggle, cn } from "../ui";
import { ReliefPage } from "./ReliefPage";

export interface DepthMapsStandaloneProps {
  onNavigate: (r: Route) => void;
}

export function DepthMapsStandalone({ onNavigate }: DepthMapsStandaloneProps) {
  useEffect(() => {
    const prev = document.title;
    document.title = "Depth Maps";
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <header className="shrink-0 bg-[color:var(--color-surface)] border-b border-[color:var(--color-border)]">
        <PageContainer bleed={false}>
          <div className="flex items-center gap-4 h-14">
            <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-ink)]">
              Depth Maps
            </span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-subtle)] sm:inline">
              depth-map smoother
            </span>
            <div className="ml-auto flex items-center gap-3">
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
                {/* GitHub mark — lucide-react dropped brand icons; inline SVG. */}
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
              <span
                aria-hidden="true"
                className="h-6 w-px bg-[color:var(--color-border-strong)]"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onNavigate({ name: "tests" })}
              >
                Main App
              </Button>
            </div>
          </div>
        </PageContainer>
      </header>
      <main id="main-content" className="flex-1 min-h-0 overflow-auto">
        <ReliefPage />
      </main>
    </div>
  );
}
