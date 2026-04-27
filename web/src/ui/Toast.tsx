import { useEffect, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { cn } from "./cn";

/**
 * Tiny toast notifier. A single host component (`<ToastHost />`)
 * sits in App's root and listens on `window` for a custom event;
 * any module can dispatch via `notify("message", "error")`.
 *
 * Auto-dismisses after 6s for info, 12s for errors. Click the close
 * button (or the toast itself) to dismiss early. Stacks up to 4
 * visible — older ones get evicted, not stacked indefinitely.
 *
 * Why a custom event vs. a context provider: callers from outside
 * the React tree (api/* helpers, the global fetch interceptor) can
 * fire it without prop-drilling or a provider that knows about every
 * call site.
 */

export type ToastLevel = "error" | "info";

export interface ToastMessage {
  id: number;
  message: string;
  level: ToastLevel;
}

const EVENT = "xcsgen:toast";
let _seq = 0;

export function notify(message: string, level: ToastLevel = "info"): void {
  if (typeof window === "undefined") return;
  const detail: ToastMessage = { id: ++_seq, message, level };
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
}

const MAX_VISIBLE = 4;
const TIMEOUT_MS: Record<ToastLevel, number> = { info: 6000, error: 12000 };

export function ToastHost() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const t = (e as CustomEvent<ToastMessage>).detail;
      setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), t]);
      const timeoutMs = TIMEOUT_MS[t.level];
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, timeoutMs);
    }
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-[1000] flex flex-col gap-2 max-w-[420px] pointer-events-none"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.level === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5",
            "rounded-[8px] shadow-[var(--shadow-popover)] border",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-2",
            t.level === "error"
              ? "border-[color:var(--color-destructive)]/40 bg-[color:var(--color-destructive-tint)] text-[color:var(--color-destructive)]"
              : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
          )}
        >
          <span className="mt-[1px] shrink-0">
            {t.level === "error" ? (
              <AlertTriangle className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Info className="h-4 w-4" strokeWidth={2} />
            )}
          </span>
          <span className="flex-1 text-[12.5px] leading-snug whitespace-pre-line">
            {t.message}
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            className="shrink-0 -mr-1 -mt-1 p-1 rounded hover:bg-black/5"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
