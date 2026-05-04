import {
  cloneElement,
  isValidElement,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { AxisHelp } from "./stabilityHelpCopy";
import { StabilityHelpSchematic } from "./StabilityHelpSchematic";

/* ─── HelpTip ─────────────────────────────────────────────────────────────
 *
 * Click-to-open help popover for the Stability page's row labels and
 * toolbar buttons. The trigger is the wrapped child (typically a small
 * `?` icon button); clicking it toggles a portal'd card anchored to the
 * trigger.
 *
 * The card is dismissed by:
 *   - clicking the trigger again
 *   - clicking outside the card
 *   - pressing Esc
 *
 * The trigger child stays fully interactive: we pass our toggle through
 * its existing onClick, so callers don't need to know the help exists.
 * Hover does nothing — earlier iterations layered a quick tooltip on top
 * of the rich card and the dual states read as confusing flicker.
 */

const FADE_MS = 100;

export interface HelpTipProps {
  help: AxisHelp;
  children: ReactElement;
  /** Optional className appended to the wrapping span. */
  className?: string;
}

export function HelpTip({ help, children, className }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const tipId = useId();

  const clearFadeTimer = (): void => {
    if (fadeTimerRef.current != null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  };

  useEffect(() => () => clearFadeTimer(), []);

  const close = (): void => {
    if (!open) return;
    setClosing(true);
    fadeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, FADE_MS);
  };

  const toggle = (): void => {
    clearFadeTimer();
    if (open && !closing) {
      close();
    } else {
      setClosing(false);
      setOpen(true);
    }
  };

  // Esc closes any visible card.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        clearFadeTimer();
        setClosing(false);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Click-outside closes. Listening on mousedown (capture) so the close
  // happens before the new click target's onClick — important when the
  // user clicks a sibling pill while the help is open.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target)) return;
      const card = document.querySelector(`[data-help-tip="${tipId}"]`);
      if (card?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () =>
      document.removeEventListener("mousedown", onMouseDown, true);
  }, [open, tipId]);

  // Wrap the child so we can intercept its click. Children must be a
  // valid React element; if not, we render them as-is and bail (no
  // help). React fragments aren't supported as the trigger.
  if (!isValidElement(children)) return <>{children}</>;

  const childTyped = children as ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    "aria-describedby"?: string;
    "aria-expanded"?: boolean;
  }>;
  const originalOnClick = childTyped.props.onClick;
  const childWithToggle = cloneElement(childTyped, {
    onClick: (e: React.MouseEvent): void => {
      // Run the trigger's own onClick first (lets buttons run their
      // logic), then toggle the help. If callers really want to
      // prevent the help, they can call e.stopPropagation() — but the
      // intended flow is: click the `?` icon → help opens.
      originalOnClick?.(e);
      toggle();
    },
    "aria-describedby": open ? tipId : undefined,
    "aria-expanded": open,
  });

  return (
    <span
      ref={wrapperRef}
      className={className}
      style={{ display: "inline-flex" }}
    >
      {childWithToggle}
      {open && wrapperRef.current && (
        <HelpTipPortal
          id={tipId}
          closing={closing}
          help={help}
          anchor={wrapperRef.current}
          onClose={close}
        />
      )}
    </span>
  );
}

/* ─── Portal'd help card ───────────────────────────────────────────────── */

interface PortalProps {
  id: string;
  closing: boolean;
  help: AxisHelp;
  anchor: HTMLElement;
  onClose: () => void;
}

function HelpTipPortal({ id, closing, help, anchor, onClose }: PortalProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    flipped: boolean;
  }>({ left: 0, top: 0, flipped: false });

  // Re-measure on mount; stays put after that. Ignored on closing so the
  // fade-out doesn't reflow.
  useLayoutEffect(() => {
    if (closing) return;
    if (!ref.current) return;
    const a = anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = a.left + a.width / 2 - p.width / 2;
    if (left + p.width + margin > vw) left = vw - p.width - margin;
    if (left < margin) left = margin;
    // Prefer below; flip above if it'd clip.
    let top = a.bottom + 8;
    let flipped = false;
    if (top + p.height + margin > vh) {
      top = a.top - p.height - 8;
      flipped = true;
    }
    setPlacement({ left, top, flipped });
  }, [closing, anchor]);

  // Cards are rendered into ``document.body`` so they're never clipped
  // by an ancestor's overflow. SSR-safe: ``createPortal`` only runs on
  // the client (``document`` is undefined on server).
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      id={id}
      ref={ref}
      role="dialog"
      aria-label={`Help: ${help.heading}`}
      data-help-tip={id}
      className={
        "fixed z-[1000] rounded-[8px] border border-[color:var(--color-border-strong)] " +
        "bg-[color:var(--color-surface-elevated)] shadow-lg"
      }
      style={{
        left: placement.left,
        top: placement.top,
        opacity: closing ? 0 : 1,
        transition: closing
          ? `opacity ${FADE_MS}ms ease-out`
          : "opacity 80ms ease-out",
      }}
    >
      <HelpCardBody help={help} onClose={onClose} />
    </div>,
    document.body,
  );
}

/* ─── Card body ────────────────────────────────────────────────────────── */

function HelpCardBody({
  help,
  onClose,
}: {
  help: AxisHelp;
  onClose: () => void;
}) {
  return (
    <div className="px-3.5 py-3 flex flex-col gap-3" style={{ width: 340 }}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase font-semibold text-[color:var(--color-ink-subtle)] flex-1 min-w-0">
          {help.heading}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help"
          className={
            "h-4 w-4 inline-flex items-center justify-center shrink-0 " +
            "rounded-[3px] text-[color:var(--color-ink-subtle)] " +
            "hover:bg-[color:var(--color-surface)] hover:text-[color:var(--color-ink)] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60"
          }
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden
            className="block"
          >
            <path
              d="M2 2 L8 8 M8 2 L2 8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <StabilityHelpSchematic schematic={help.schematic} />
        </div>
        <div className="flex flex-col gap-2.5 min-w-0 flex-1">
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
              Definition
            </div>
            <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink)] m-0">
              {help.definition}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
              How to read it
            </div>
            <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink-muted)] m-0">
              {help.guide}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Public re-exports for tests ──────────────────────────────────────── */

export const __testing__ = {
  FADE_MS,
};

// ``ReactNode`` re-exported so call sites that only need the type don't
// have to import from ``react`` directly. Kept for parity with sibling
// primitives.
export type { ReactNode };
