import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HelpTip } from "./StabilityHelpTip";
import { TOOLBAR_HELP } from "./stabilityHelpCopy";

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/* Smoke tests for the tooltip state machine. The exact pixel layout
 * lives in the browser; here we only verify the timer-driven hidden
 * → tier1 → tier2 transition + the "Esc closes" + "click closes"
 * branches. */

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
  it("stays hidden under the tier-1 delay", () => {
    const { trigger } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(200);
    // No tooltip role should be in the DOM yet.
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows tier-1 short copy after 250ms", () => {
    const { trigger } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(260);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.short);
    // Heading shouldn't render until tier-2.
    expect(tip.textContent).not.toContain(TOOLBAR_HELP.mode.heading);
  });

  it("expands to tier-2 after 1500ms with heading + long copy", () => {
    const { trigger } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(1600);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.heading);
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.long);
  });

  it("Esc closes an open tooltip", () => {
    const { trigger } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(260);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("click on the trigger fires onClick AND closes the tooltip", () => {
    const { trigger, onClick } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(260);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("pointer leave starts a 200ms close countdown that hides the tip", () => {
    const { trigger } = renderProbe();
    fireEvent.pointerEnter(trigger);
    advance(260);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    fireEvent.pointerLeave(trigger);
    // Still visible during the leave grace + fade.
    advance(150);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    // 200ms grace + 120ms fade-out = 320ms total.
    advance(400);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
