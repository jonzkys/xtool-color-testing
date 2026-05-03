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
 * Two-tier hover help for the Stability page's pills + row labels.
 *
 *   ``hidden``  → quiet
 *   ``tier1``   → after 250 ms hover; small mono tooltip with the
 *                 ``short`` copy
 *   ``tier2``   → after 1500 ms total hover; richer info card with the
 *                 ``long`` copy + an inline schematic
 *
 * Cursor leaves close after a 200 ms grace so the user can move into
 * the card without it vanishing. Esc dismisses any open card.
 *
 * The trigger child stays fully interactive; we wrap it in a span and
 * attach pointer / focus listeners on the wrapper so the existing
 * onClick / onKeyDown on the child still run unchanged.
 */

const TIER1_DELAY_MS = 250;
const TIER2_DELAY_MS = 1500;
const LEAVE_DELAY_MS = 200;
const FADE_OUT_MS = 120;

type Stage = "hidden" | "tier1" | "tier2";

export interface HelpTipProps {
  help: AxisHelp;
  children: ReactElement;
  /** Whether the trigger is logically pressed/active. Forwarded to
   *  ``aria-describedby`` so screen readers pick up the help text. */
  describedBy?: boolean;
  /** Optional className appended to the wrapping span. */
  className?: string;
}

export function HelpTip({ help, children, className }: HelpTipProps) {
  const [stage, setStage] = useState<Stage>("hidden");
  const [closing, setClosing] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const tier1TimerRef = useRef<number | null>(null);
  const tier2TimerRef = useRef<number | null>(null);
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
    clearTimer(tier1TimerRef);
    clearTimer(tier2TimerRef);
    clearTimer(leaveTimerRef);
    clearTimer(fadeTimerRef);
  };

  useEffect(() => () => cancelAllTimers(), []);

  // Esc closes any visible card.
  useEffect(() => {
    if (stage === "hidden") return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        cancelAllTimers();
        setClosing(false);
        setStage("hidden");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage]);

  const open = (): void => {
    cancelAllTimers();
    setClosing(false);
    if (stage !== "hidden") return;
    tier1TimerRef.current = window.setTimeout(() => {
      setStage("tier1");
      tier2TimerRef.current = window.setTimeout(() => {
        setStage("tier2");
      }, TIER2_DELAY_MS - TIER1_DELAY_MS);
    }, TIER1_DELAY_MS);
  };

  const scheduleClose = (): void => {
    clearTimer(tier1TimerRef);
    clearTimer(tier2TimerRef);
    clearTimer(leaveTimerRef);
    if (stage === "hidden") return;
    leaveTimerRef.current = window.setTimeout(() => {
      setClosing(true);
      fadeTimerRef.current = window.setTimeout(() => {
        setStage("hidden");
        setClosing(false);
      }, FADE_OUT_MS);
    }, LEAVE_DELAY_MS);
  };

  const cancelClose = (): void => {
    clearTimer(leaveTimerRef);
    clearTimer(fadeTimerRef);
    setClosing(false);
  };

  // When the trigger is clicked we close the card so the action (which
  // typically toggles the pill) doesn't fight a stale tooltip. The
  // child's own onClick still runs because we don't intercept it.
  const onClick = (): void => {
    cancelAllTimers();
    setClosing(false);
    setStage("hidden");
  };

  // Wrap the child so we can attach listeners without rewriting the
  // pill button. Children must be a valid React element; if not, we
  // render them as-is and bail (no help). React fragments aren't
  // supported as the trigger.
  if (!isValidElement(children)) return <>{children}</>;

  // Pass aria-describedby down to the actual trigger element so the
  // tooltip text is announced — but only when the tip is visible, so
  // the announcement doesn't fire ambiently.
  const childProps =
    stage !== "hidden"
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
      onPointerEnter={open}
      onPointerLeave={scheduleClose}
      onFocus={open}
      onBlur={scheduleClose}
      onClickCapture={onClick}
      style={{ display: "inline-flex" }}
    >
      {childWithA11y}
      {stage !== "hidden" && wrapperRef.current && (
        <HelpTipPortal
          id={tipId}
          stage={stage}
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

/* ─── Portal'd tooltip body ────────────────────────────────────────────── */

interface PortalProps {
  id: string;
  stage: Stage;
  closing: boolean;
  help: AxisHelp;
  anchor: HTMLElement;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

function HelpTipPortal({
  id,
  stage,
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

  // Re-measure on mount + when stage transitions tier1 → tier2 (the
  // card grows). Ignored on closing so the fade-out doesn't reflow.
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
  }, [stage, closing, anchor]);

  const showCard = stage === "tier2";

  // Cards are rendered into ``document.body`` so they're never clipped
  // by an ancestor's overflow. SSR-safe: ``createPortal`` only runs on
  // the client (``document`` is undefined on server).
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      id={id}
      ref={ref}
      role="tooltip"
      data-help-tip
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={
        "fixed z-[1000] " +
        (showCard
          ? "rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] shadow-md"
          : "rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] shadow-md")
      }
      style={{
        left: placement.left,
        top: placement.top,
        maxWidth: showCard ? 320 : 280,
        // Tier-1 ignores pointer events so it never accidentally
        // captures a hover. Tier-2 catches them so the user can move
        // the cursor into the card without triggering close.
        pointerEvents: showCard ? "auto" : "none",
        opacity: closing ? 0 : 1,
        transition: closing
          ? `opacity ${FADE_OUT_MS}ms ease-out`
          : "opacity 80ms ease-out",
      }}
    >
      {showCard ? (
        <HelpCardBody help={help} />
      ) : (
        <Tier1Body short={help.short} />
      )}
    </div>,
    document.body,
  );
}

/* ─── Bodies ───────────────────────────────────────────────────────────── */

function Tier1Body({ short }: { short: string }) {
  return (
    <div className="font-mono text-[11px] leading-snug text-[color:var(--color-ink)] py-1.5 px-2.5">
      {short}
    </div>
  );
}

function HelpCardBody({ help }: { help: AxisHelp }) {
  return (
    <div className="px-3 py-2.5 flex flex-col gap-2" style={{ width: 300 }}>
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
        {help.heading}
      </div>
      <div className="flex items-start gap-2.5">
        <div className="shrink-0">
          <StabilityHelpSchematic schematic={help.schematic} />
        </div>
        <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink-muted)] m-0 flex-1 min-w-0">
          {help.long}
        </p>
      </div>
    </div>
  );
}

/* ─── Public re-exports for tests ──────────────────────────────────────── */

export const __testing__ = {
  TIER1_DELAY_MS,
  TIER2_DELAY_MS,
  LEAVE_DELAY_MS,
  FADE_OUT_MS,
};

// ``ReactNode`` re-exported so call sites that only need the type don't
// have to import from ``react`` directly. Kept for parity with sibling
// primitives.
export type { ReactNode };
