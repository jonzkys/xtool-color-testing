import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HelpTip } from "./StabilityHelpTip";
import { TOOLBAR_HELP } from "./stabilityHelpCopy";

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/* Smoke tests for the hover-to-open help card. We collapsed the older
 * tier-1 / tier-2 split into a single rich card; the timer here is
 * just the OPEN_DELAY_MS gate. The exact pixel layout lives in the
 * browser; here we only verify the open / close / Esc / click paths. */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function renderProbe() {
  const onClick = vi.fn();
  render(
    <HelpTip help={TOOLBAR_HELP.mode}>
      <button type="button" onClick={onClick}>
        TRIGGER
      </button>
    </HelpTip>,
  );
  const trigger = screen.getByText("TRIGGER");
  return { trigger, onClick };
}

describe("HelpTip", () => {
  it("stays hidden under the open delay", () => {
    const { trigger } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(200);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens with definition + guide after the open delay", () => {
    const { trigger } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(500);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.heading);
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.definition);
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.guide);
  });

  it("Esc closes an open card", () => {
    const { trigger } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(500);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("click on the trigger fires onClick AND closes the card", () => {
    const { trigger, onClick } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(500);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("pointer leave starts a grace countdown that hides the card", () => {
    const { trigger } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(500);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    fireEvent.pointerLeave(trigger);
    // Still visible during the leave grace + fade.
    advance(150);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    // Grace + fade-out total comfortably under 500 ms.
    advance(500);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
