/**
 * Relief — collapsible sidebar group.
 *
 * A ``Card`` whose header toggles the body open/closed, persisting the state
 * in ``localStorage`` so the user's layout sticks across reloads. Used to fold
 * the Relief sidebar into two top-level groups (Cutout / Surface) that fit on
 * one screen. Header carries an optional ``?`` tooltip and a right-hand slot
 * (e.g. an on/off pill).
 */

import { useState, type ReactNode } from "react";
import { Card, HelpTooltip } from "../../ui";

export interface CollapsibleGroupProps {
  title: string;
  /** Persist the open/closed state under this localStorage key. */
  storageKey: string;
  defaultOpen?: boolean;
  /** Long-form description shown as a ``?`` tooltip beside the title. */
  hint?: ReactNode;
  /** Right-aligned header slot (status pill, count, …). */
  headerRight?: ReactNode;
  children: ReactNode;
}

function readOpen(key: string, fallback: boolean): boolean {
  if (typeof localStorage === "undefined") return fallback;
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === "1";
}

export function CollapsibleGroup({
  title,
  storageKey,
  defaultOpen = true,
  hint,
  headerRight,
  children,
}: CollapsibleGroupProps) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage?.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* private mode / quota — non-fatal, state still toggles in-session */
      }
      return next;
    });
  };

  return (
    <Card padded={false} className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40 rounded-sm"
        >
          <svg
            aria-hidden
            viewBox="0 0 10 10"
            className={
              "h-2.5 w-2.5 shrink-0 text-[color:var(--color-ink-subtle)] transition-transform duration-150 " +
              (open ? "rotate-90" : "")
            }
          >
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-ink)]">
            {title}
          </span>
        </button>
        {hint != null && <HelpTooltip>{hint}</HelpTooltip>}
        {headerRight}
      </div>
      {open && (
        <>
          <div
            aria-hidden
            className="mx-4 h-px"
            style={{ background: "var(--metal-bar-soft)" }}
          />
          <div className="flex flex-col gap-4 p-4">{children}</div>
        </>
      )}
    </Card>
  );
}
