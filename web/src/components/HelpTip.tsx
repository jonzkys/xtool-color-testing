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

/* ─── HelpTip ─────────────────────────────────────────────────────────────
 *
 * Generic hover-to-open help card. Accepts any Body component that takes
 * a ``help`` prop of the same type as the ``help`` prop passed here.
 *
 * Behaviours:
 *   - Pointer enter / focus → ``OPEN_DELAY_MS`` then card opens
 *   - Pointer leave (trigger or card) → ``LEAVE_DELAY_MS`` grace then
 *     fades out — so the user can move the cursor into the card
 *   - Click on the trigger → close instantly
 *   - Esc → close
 */

const OPEN_DELAY_MS = 450;
const LEAVE_DELAY_MS = 220;
const FADE_OUT_MS = 100;

export interface HelpTipProps<H> {
  help: H;
  Body: React.ComponentType<{ help: H }>;
  children: ReactElement;
  /** Optional className appended to the wrapping span. */
  className?: string;
}

export function HelpTip<H>({ help, Body, children, className }: HelpTipProps<H>) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const tipId = useId();

  const clearTimer = (
    ref: React.MutableRefObject<number | null>,
  ): void => {
    if (ref.current != null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const cancelAllTimers = (): void => {
    clearTimer(openTimerRef);
    clearTimer(leaveTimerRef);
    clearTimer(fadeTimerRef);
  };

  useEffect(() => () => cancelAllTimers(), []);

  // Esc closes any visible card.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        cancelAllTimers();
        setClosing(false);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const scheduleOpen = (): void => {
    cancelAllTimers();
    setClosing(false);
    if (open) return;
    openTimerRef.current = window.setTimeout(() => {
      setOpen(true);
    }, OPEN_DELAY_MS);
  };

  const scheduleClose = (): void => {
    clearTimer(openTimerRef);
    clearTimer(leaveTimerRef);
    if (!open) return;
    leaveTimerRef.current = window.setTimeout(() => {
      setClosing(true);
      fadeTimerRef.current = window.setTimeout(() => {
        setOpen(false);
        setClosing(false);
      }, FADE_OUT_MS);
    }, LEAVE_DELAY_MS);
  };

  const cancelClose = (): void => {
    clearTimer(leaveTimerRef);
    clearTimer(fadeTimerRef);
    setClosing(false);
  };

  // When the trigger is clicked we close the card immediately so the
  // action (which typically toggles the pill) doesn't fight a stale
  // help card. The child's own onClick still runs because we use
  // ``onClickCapture`` rather than intercepting it.
  const onClickCapture = (): void => {
    cancelAllTimers();
    setClosing(false);
    setOpen(false);
  };

  // Wrap the child so we can attach listeners without rewriting the
  // pill button. Children must be a valid React element; if not, we
  // render them as-is and bail (no help). React fragments aren't
  // supported as the trigger.
  if (!isValidElement(children)) return <>{children}</>;

  // Pass aria-describedby down to the actual trigger element so the
  // help text is announced — but only when the card is visible, so
  // the announcement doesn't fire ambiently.
  const childProps = open
    ? ({ "aria-describedby": tipId } as Record<string, string>)
    : {};
  const childWithA11y = cloneElement(
    children as ReactElement<Record<string, unknown>>,
    childProps,
  );

  return (
    <span
      ref={wrapperRef}
      className={className}
      onPointerEnter={scheduleOpen}
      onPointerLeave={scheduleClose}
      onFocus={scheduleOpen}
      onBlur={scheduleClose}
      onClickCapture={onClickCapture}
      style={{ display: "inline-flex" }}
    >
      {childWithA11y}
      {open && wrapperRef.current && (
        <HelpTipPortal
          id={tipId}
          closing={closing}
          help={help}
          Body={Body}
          anchor={wrapperRef.current}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
        />
      )}
    </span>
  );
}

/* ─── Portal'd help card ───────────────────────────────────────────────── */

interface PortalProps<H> {
  id: string;
  closing: boolean;
  help: H;
  Body: React.ComponentType<{ help: H }>;
  anchor: HTMLElement;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

function HelpTipPortal<H>({
  id,
  closing,
  help,
  Body,
  anchor,
  onPointerEnter,
  onPointerLeave,
}: PortalProps<H>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    flipped: boolean;
  }>({ left: 0, top: 0, flipped: false });

  // Re-measure on mount; stays put after that. Ignored on closing so
  // the fade-out doesn't reflow.
  useLayoutEffect(() => {
    if (closing) return;
    if (!ref.current) return;
    const a = anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceRight = vw - a.right - margin - gap;
    const spaceLeft = a.left - margin - gap;
    const spaceBelow = vh - a.bottom - margin - gap;
    const spaceAbove = a.top - margin - gap;

    let left: number;
    let top: number;

    if (p.width <= spaceRight) {
      // Preferred: card to the right of the trigger, top-aligned.
      left = a.right + gap;
      top = a.top;
    } else if (p.width <= spaceLeft) {
      // Flip: card to the left of the trigger, top-aligned.
      left = a.left - p.width - gap;
      top = a.top;
    } else if (p.height <= spaceBelow) {
      // Fall back to below the trigger (narrow viewports).
      top = a.bottom + gap;
      left = a.left + a.width / 2 - p.width / 2;
    } else if (p.height <= spaceAbove) {
      // Or above the trigger.
      top = a.top - p.height - gap;
      left = a.left + a.width / 2 - p.width / 2;
    } else {
      // Last resort: pin to the top of the viewport, horizontally centered.
      left = vw / 2 - p.width / 2;
      top = margin;
    }

    // Clamp horizontally so we never overflow.
    if (left + p.width + margin > vw) left = vw - p.width - margin;
    if (left < margin) left = margin;

    // Clamp vertically — the maxHeight + overflowY on the card body
    // handle over-tall cards, this just keeps the top edge on-screen.
    if (top + p.height + margin > vh) top = Math.max(margin, vh - p.height - margin);
    if (top < margin) top = margin;

    setPlacement({ left, top, flipped: false });
  }, [closing, anchor]);

  // Cards are rendered into ``document.body`` so they're never clipped
  // by an ancestor's overflow. SSR-safe: ``createPortal`` only runs on
  // the client (``document`` is undefined on server).
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      id={id}
      ref={ref}
      role="tooltip"
      data-help-tip={id}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={
        "fixed z-[1000] rounded-[8px] border border-[color:var(--color-border-strong)] " +
        "bg-[color:var(--color-surface-elevated)] shadow-lg"
      }
      style={{
        left: placement.left,
        top: placement.top,
        maxHeight: `calc(100vh - 16px)`,
        overflowY: "auto",
        // Catch pointer events so the user can move the cursor into
        // the card without triggering close.
        pointerEvents: "auto",
        opacity: closing ? 0 : 1,
        transition: closing
          ? `opacity ${FADE_OUT_MS}ms ease-out`
          : "opacity 80ms ease-out",
      }}
    >
      <Body help={help} />
    </div>,
    document.body,
  );
}

/* ─── Public re-exports for tests ──────────────────────────────────────── */

export const __testing__ = {
  OPEN_DELAY_MS,
  LEAVE_DELAY_MS,
  FADE_OUT_MS,
};

// ``ReactNode`` re-exported so call sites that only need the type don't
// have to import from ``react`` directly. Kept for parity with sibling
// primitives.
export type { ReactNode };
