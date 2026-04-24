import { cloneElement, type ReactElement } from "react";
import { useIsDemo } from "../hooks/useIsDemo";
import { cn } from "./cn";

export interface DemoLockProps {
  /**
   * The interactive element to lock. Must accept ``disabled`` and
   * ``title`` props (button-like). Usually a ``<Button>``, but a
   * plain ``<button>`` or a labelled ``<input>`` works too.
   */
  children: ReactElement;
  /** Tooltip shown on hover. Customise per call site to say which
   *  action is blocked. */
  label?: string;
}

/**
 * Disables the wrapped control when the app is in demo mode.
 * Adds ``disabled`` + ``aria-disabled`` + ``title`` to the child and
 * wraps it in a ``<span>`` with ``cursor-not-allowed`` so the mouse
 * affordance still reads as locked even when the inner button itself
 * has ``pointer-events: none`` due to ``disabled``.
 *
 * Outside demo mode this renders the child verbatim with zero DOM
 * overhead — the wrapper span is only emitted on the demo branch.
 */
export function DemoLock({
  children,
  label = "Not available in the demo account",
}: DemoLockProps) {
  const isDemo = useIsDemo();
  if (!isDemo) return children;
  const disabledChild = cloneElement(children, {
    disabled: true,
    "aria-disabled": true,
    title: label,
  } as Record<string, unknown>);
  return (
    <span
      className={cn("inline-flex cursor-not-allowed")}
      title={label}
    >
      {disabledChild}
    </span>
  );
}
