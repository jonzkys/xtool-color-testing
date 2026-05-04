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
 * Hover-to-open help card for the Stability page's pills, row labels,
 * and toolbar buttons. A single rich card — no tooltip-then-modal
 * two-stage flicker — appears after a deliberate hover delay and
 * stays put while the cursor is on the trigger or the card.
 *
 * Behaviours:
 *   - Pointer enter / focus → ``OPEN_DELAY_MS`` then card opens
 *   - Pointer leave (trigger or card) → ``LEAVE_DELAY_MS`` grace then
 *     fades out — so the user can move the cursor into the card
 *   - Click on the trigger → close instantly (the pill's own onClick
 *     selects the axis; we just dismiss the help so it doesn't fight
 *     the new selection state)
 *   - Esc → close
 *
 * The trigger child stays fully interactive: we wrap it in a span and
 * attach pointer / focus listeners on the wrapper so the existing
 * onClick / onKeyDown on the child still run unchanged.
 */

const OPEN_DELAY_MS = 450;
const LEAVE_DELAY_MS = 220;
const FADE_OUT_MS = 100;

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
          anchor={wrapperRef.current}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
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
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

function HelpTipPortal({
  id,
  closing,
  help,
  anchor,
  onPointerEnter,
  onPointerLeave,
}: PortalProps) {
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
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = a.left + a.width / 2 - p.width / 2;
    if (left + p.width + margin > vw) left = vw - p.width - margin;
    if (left < margin) left = margin;
    // Prefer below; flip above if it'd clip.
    let top = a.bottom + 6;
    let flipped = false;
    if (top + p.height + margin > vh) {
      top = a.top - p.height - 6;
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
        // Catch pointer events so the user can move the cursor into
        // the card without triggering close.
        pointerEvents: "auto",
        opacity: closing ? 0 : 1,
        transition: closing
          ? `opacity ${FADE_OUT_MS}ms ease-out`
          : "opacity 80ms ease-out",
      }}
    >
      <HelpCardBody help={help} />
    </div>,
    document.body,
  );
}

/* ─── Card body ────────────────────────────────────────────────────────── */

function HelpCardBody({ help }: { help: AxisHelp }) {
  return (
    <div className="px-3.5 py-3 flex flex-col gap-3" style={{ width: 340 }}>
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
        {help.heading}
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
  OPEN_DELAY_MS,
  LEAVE_DELAY_MS,
  FADE_OUT_MS,
};

// ``ReactNode`` re-exported so call sites that only need the type don't
// have to import from ``react`` directly. Kept for parity with sibling
// primitives.
export type { ReactNode };
