import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HelpTip } from "./HelpTip";

interface FakeHelp {
  heading: string;
  body: string;
}
const FAKE: FakeHelp = { heading: "FAKE HEAD", body: "fake body sentence" };
function FakeBody({ help }: { help: FakeHelp }) {
  return (
    <div>
      <span>{help.heading}</span>
      <span>{help.body}</span>
    </div>
  );
}

function advance(ms: number): void {
  act(() => { vi.advanceTimersByTime(ms); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe("HelpTip (generic)", () => {
  it("renders its Body prop with the supplied help payload", () => {
    render(
      <HelpTip help={FAKE} Body={FakeBody}>
        <button type="button">TRIGGER</button>
      </HelpTip>,
    );
    fireEvent.pointerEnter(screen.getByText("TRIGGER"));
    advance(500);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("FAKE HEAD");
    expect(tip.textContent).toContain("fake body sentence");
  });

  it("does not render the body before the open delay", () => {
    render(
      <HelpTip help={FAKE} Body={FakeBody}>
        <button type="button">TRIGGER</button>
      </HelpTip>,
    );
    fireEvent.pointerEnter(screen.getByText("TRIGGER"));
    advance(200);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

import { HelpTip as StabilityShim } from "./StabilityHelpTip";
import { TOOLBAR_HELP } from "./stabilityHelpCopy";

describe("StabilityHelpTip shim", () => {
  it("renders the stability body via the shim", () => {
    render(
      <StabilityShim help={TOOLBAR_HELP.mode}>
        <button type="button">SHIM</button>
      </StabilityShim>,
    );
    fireEvent.pointerEnter(screen.getByText("SHIM"));
    advance(500);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.heading);
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.definition);
    expect(tip.textContent).toContain(TOOLBAR_HELP.mode.guide);
  });
});
