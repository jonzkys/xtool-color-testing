import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SpiralTestControls } from "./SpiralTestControls";
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import { PARAMS, PARAM_ORDER, type ParamKey } from "../../lib/forge/spiralParams";
import type { ValidationProfile } from "../../types";

const CUT_PROFILE: ValidationProfile = {
  power: { kind: "range", min: 1, max: 100, step: 1 },
  speed: { kind: "range", min: 2, max: 10000, step: 1 },
  frequency: { kind: "range", min: 1, max: 4000, step: 1 },
  passes: { kind: "range", min: 1, max: 300, step: 1 },
  pulse_width: { kind: "stepped", values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500] },
  laser: { kind: "enum", values: ["red", "blue"] },
};

function baseCfg(over: Partial<SpiralTestConfig> = {}): SpiralTestConfig {
  const fixed = Object.fromEntries(PARAM_ORDER.map((k) => [k, PARAMS[k].defaultFixed])) as Record<ParamKey, number>;
  return {
    xParam: "channelWidth", yParam: "pitch",
    xAxis: { min: 0.6, max: 1.0, steps: 4 }, yAxis: { min: 0.03, max: 0.05, steps: 4 },
    fixed, diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
    focusInitialMm: 0.01, laser: "red",
    labels: { show: true, titlePrefix: "" },
    score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
    ...over,
  };
}

describe("SpiralTestControls", () => {
  it("shows resolved axis values and footprint", () => {
    render(<SpiralTestControls cfg={baseCfg()} onChange={() => {}} footprint={{ w: 120, h: 120 }} overBed={false} />);
    expect(screen.getByText(/0\.60, 0\.73, 0\.87, 1\.00/)).toBeInTheDocument(); // X channel width
    expect(screen.getByText(/0\.030, 0\.037, 0\.043, 0\.050/)).toBeInTheDocument(); // Y pitch
    expect(screen.getByText(/120 × 120 mm/)).toBeInTheDocument();
  });
  it("changing the X param emits xParam + a reset xAxis range", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={baseCfg()} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("x param"), { target: { value: "speed" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      xParam: "speed", xAxis: PARAMS.speed.defaultAxis,
    }));
  });
  it("the X param select cannot pick the param already on Y", () => {
    render(<SpiralTestControls cfg={baseCfg()} onChange={() => {}} footprint={{ w: 1, h: 1 }} overBed={false} />);
    const xSelect = screen.getByLabelText("x param");
    // yParam is "pitch" → not offered in the X select
    expect(within(xSelect).queryByRole("option", { name: /Pitch/ })).toBeNull();
  });
  it("emits a changed diameter", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={baseCfg()} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("diameter"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ diameterMm: 12 }));
  });
  it("edits the title prefix", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={baseCfg()} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("title prefix"), { target: { value: "BRASS" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ labels: expect.objectContaining({ titlePrefix: "BRASS" }) }));
  });
  it("renders Min/Max selects (and no Steps) when the axis param is discrete", () => {
    render(<SpiralTestControls cfg={baseCfg({ xParam: "pulseWidth", yParam: "pitch", xAxis: { min: 50, max: 500, steps: 4 } })}
      onChange={() => {}} footprint={{ w: 1, h: 1 }} overBed={false} profile={CUT_PROFILE} />);
    expect(screen.getByLabelText("x min").tagName).toBe("SELECT");
    expect(screen.getByLabelText("x max").tagName).toBe("SELECT");
    expect(screen.queryByLabelText("x steps")).toBeNull();
  });
});
