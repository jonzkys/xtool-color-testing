import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FixedParams } from "./FixedParams";
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

describe("FixedParams", () => {
  it("renders an input for every sweepable param", () => {
    render(<FixedParams cfg={baseCfg()} onChange={() => {}} />);
    for (const k of PARAM_ORDER) expect(screen.getByLabelText(`fixed ${k}`)).toBeInTheDocument();
  });
  it("disables the inputs for the params currently on an axis", () => {
    render(<FixedParams cfg={baseCfg()} onChange={() => {}} />);
    expect(screen.getByLabelText("fixed channelWidth")).toBeDisabled(); // on X
    expect(screen.getByLabelText("fixed pitch")).toBeDisabled();        // on Y
    expect(screen.getByLabelText("fixed speed")).not.toBeDisabled();
  });
  it("editing an off-axis fixed value emits the clamped change", () => {
    const onChange = vi.fn();
    render(<FixedParams cfg={baseCfg()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("fixed speed"), { target: { value: "1800" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fixed: expect.objectContaining({ speed: 1800 }) }));
  });
  it("shows the descent depth, and 'varies' when a focus input is on an axis", () => {
    const { rerender } = render(<FixedParams cfg={baseCfg()} onChange={() => {}} />);
    expect(screen.getByText(/Descent @ 250p: 0\.750 mm/)).toBeInTheDocument();
    rerender(<FixedParams cfg={baseCfg({ xParam: "focusStep", xAxis: PARAMS.focusStep.defaultAxis })} onChange={() => {}} />);
    expect(screen.getByText(/Descent @ varies: —/)).toBeInTheDocument();
  });
  it("renders pulse width as a select of the machine's allowed values", () => {
    render(<FixedParams cfg={baseCfg()} onChange={() => {}} profile={CUT_PROFILE} />);
    const sel = screen.getByLabelText("fixed pulseWidth");
    expect(sel.tagName).toBe("SELECT");
    expect([...sel.querySelectorAll("option")].map((o) => o.textContent)).toContain("500");
  });
  it("emits a chosen pulse-width value", () => {
    const onChange = vi.fn();
    render(<FixedParams cfg={baseCfg()} onChange={onChange} profile={CUT_PROFILE} />);
    fireEvent.change(screen.getByLabelText("fixed pulseWidth"), { target: { value: "150" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fixed: expect.objectContaining({ pulseWidth: 150 }) }));
  });
  it("a range param input carries machine min/max", () => {
    render(<FixedParams cfg={baseCfg()} onChange={() => {}} profile={CUT_PROFILE} />);
    const speed = screen.getByLabelText("fixed speed");
    expect(speed).toHaveAttribute("min", "2");
    expect(speed).toHaveAttribute("max", "10000");
  });
});
