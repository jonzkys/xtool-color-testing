import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SpiralTestControls } from "./SpiralTestControls";
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 4 }, pitch: { min: 0.03, max: 0.05, steps: 4 },
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, labels: { show: true, titlePrefix: "" },
  cut: { passes: 250, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20, power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
};

describe("SpiralTestControls", () => {
  it("shows resolved axis values and footprint", () => {
    render(<SpiralTestControls cfg={CFG} onChange={() => {}} footprint={{ w: 120, h: 120 }} overBed={false} />);
    expect(screen.getByText(/0\.60, 0\.73, 0\.87, 1\.00/)).toBeInTheDocument();
    expect(screen.getByText(/120 × 120 mm/)).toBeInTheDocument();
  });
  it("emits a changed diameter", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={CFG} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("diameter"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ diameterMm: 12 }));
  });
  it("edits the title prefix", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={CFG} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("title prefix"), { target: { value: "BRASS" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ labels: expect.objectContaining({ titlePrefix: "BRASS" }) }));
  });
});
