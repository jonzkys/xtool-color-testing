import * as React from "react";

export type ExposureRailTabId = "info" | "filters" | "stats" | "color";

export interface ExposureRailTab {
  readonly id: ExposureRailTabId;
  readonly label: string;
  /** Optional badge for status (e.g. active filter count). Falsy = no badge. */
  readonly badge?: number | null;
  /** Tab body — rendered when this tab is active. */
  readonly body: React.ReactNode;
}

interface Props {
  tabs: readonly ExposureRailTab[];
  active: ExposureRailTabId;
  onActiveChange: (id: ExposureRailTabId) => void;
}

/** A compact tab strip with a body container. Built for the right rail
 *  of the exposure page: Info / Filters / Stats / Color. Labels are
 *  monospace uppercase per the Workshop-Instrument design language,
 *  active tab gets the primary tint, badges (e.g. active filter count)
 *  sit inline beside the label.
 *
 *  The active tab is owned by the parent so it can sync to a URL hash
 *  key. Component is fully controlled — no internal state. */
export function ExposureRailTabs({ tabs, active, onActiveChange }: Props) {
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <div
        role="tablist"
        className="flex border border-[color:var(--color-border)] rounded-sm overflow-hidden"
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          const hasBadge = typeof t.badge === "number" && t.badge > 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onActiveChange(t.id)}
              className={
                "relative flex-1 min-w-0 px-0 py-1 font-mono text-[9.5px] uppercase tracking-[0.05em] truncate transition-colors " +
                (isActive
                  ? "bg-[color:var(--color-primary)] text-white"
                  : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]")
              }
              title={hasBadge ? `${t.label} (${t.badge} active)` : t.label}
            >
              {t.label}
              {hasBadge && (
                <span
                  aria-hidden
                  className={
                    "absolute top-0.5 right-0.5 inline-flex items-center justify-center min-w-[12px] h-[12px] px-[3px] rounded-sm font-mono text-[8.5px] tabular-nums leading-none " +
                    (isActive
                      ? "bg-white text-[color:var(--color-primary)]"
                      : "bg-[color:var(--color-primary)] text-white")
                  }
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        aria-labelledby={`tab-${activeTab.id}`}
        className="flex flex-col gap-4 min-h-0 flex-1"
      >
        {activeTab.body}
      </div>
    </div>
  );
}

/** Read the active rail tab from the URL hash query (`...?tab=info`).
 *  Falls back to the supplied default when missing or invalid. */
export function readRailTabFromUrl(
  hash: string,
  fallback: ExposureRailTabId,
): ExposureRailTabId {
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return fallback;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const v = params.get("tab");
  if (v === "info" || v === "filters" || v === "stats" || v === "color") return v;
  return fallback;
}

/** Two-way sync between the active tab state and the URL hash query.
 *  Reads once on mount; writes on every change via history.replaceState. */
export function useRailTabUrlSync(
  state: ExposureRailTabId,
  setState: (id: ExposureRailTabId) => void,
): void {
  const initialised = React.useRef(false);

  React.useEffect(() => {
    const hash = window.location.hash || "";
    const fromUrl = readRailTabFromUrl(hash, state);
    if (fromUrl !== state) setState(fromUrl);
    initialised.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!initialised.current) return;
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    const route = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
    const params = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : "");
    if (state === "info") {
      params.delete("tab");  // info is the default — keep URL clean
    } else {
      params.set("tab", state);
    }
    const qs = params.toString();
    const next = qs ? `${route}?${qs}` : route;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [state]);
}
