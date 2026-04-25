import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DynamicParamForm } from "./DynamicParamForm";
import type { ValidationProfile } from "../../types";

// ---------------------------------------------------------------------------
// Profile fixtures
// ---------------------------------------------------------------------------

const RANGE_ONLY_PROFILE: ValidationProfile = {
  power:       { kind: "range", min: 1, max: 100, step: 1 },
  density:     { kind: "not_applicable" },
  frequency:   { kind: "not_applicable" },
  speed:       { kind: "not_applicable" },
  passes:      { kind: "not_applicable" },
  pulse_width: { kind: "not_applicable" },
  laser:       { kind: "not_applicable" },
};

const STEPPED_PROFILE: ValidationProfile = {
  power:       { kind: "not_applicable" },
  density:     { kind: "stepped", values: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] },
  frequency:   { kind: "not_applicable" },
  speed:       { kind: "not_applicable" },
  passes:      { kind: "not_applicable" },
  pulse_width: { kind: "not_applicable" },
  laser:       { kind: "not_applicable" },
};

const STANDARD_PROFILE: ValidationProfile = {
  power:       { kind: "range",   min: 1, max: 100, step: 1 },
  density:     { kind: "stepped", values: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200] },
  frequency:   { kind: "range",   min: 30_000, max: 60_000 },
  speed:       { kind: "range",   min: 2, max: 10000 },
  passes:      { kind: "range",   min: 1, max: 99 },
  pulse_width: { kind: "not_applicable" },
  laser:       { kind: "enum",    values: ["red", "blue"] },
};

const COLOR_ENGRAVE_PROFILE: ValidationProfile = {
  power:       { kind: "range",   min: 1, max: 100, step: 1 },
  density:     { kind: "range",   min: 1, max: 5000 },
  frequency:   { kind: "range",   min: 60_000, max: 500_000 },
  speed:       { kind: "range",   min: 2, max: 15000 },
  passes:      { kind: "range",   min: 1, max: 99 },
  pulse_width: { kind: "stepped", values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500] },
  laser:       { kind: "enum",    values: ["red", "blue"] },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_VALUE = {
  power: 50,
  density: 60,
  frequency: 30000,
  speed: 500,
  passes: 1,
  pulse_width: 30,
  laser: "red",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DynamicParamForm", () => {
  it("hides not_applicable fields", () => {
    render(
      <DynamicParamForm
        profile={STANDARD_PROFILE}
        value={DEFAULT_VALUE}
        onChange={() => {}}
      />,
    );
    // pulse_width is not_applicable in STANDARD_PROFILE — its label must be absent.
    expect(screen.queryByText(/pulse width/i)).toBeNull();
  });

  it("shows pulse_width when profile is COLOR_ENGRAVE", () => {
    render(
      <DynamicParamForm
        profile={COLOR_ENGRAVE_PROFILE}
        value={DEFAULT_VALUE}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/pulse width/i)).toBeTruthy();
  });

  it("renders a slider and number input for a range field", () => {
    render(
      <DynamicParamForm
        profile={RANGE_ONLY_PROFILE}
        value={{ ...DEFAULT_VALUE, power: 75 }}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByTestId("range-slider");
    const numberInput = screen.getByTestId("range-number");
    expect(slider).toBeTruthy();
    expect(numberInput).toBeTruthy();
    expect((slider as HTMLInputElement).value).toBe("75");
    expect((numberInput as HTMLInputElement).value).toBe("75");
  });

  it("renders a select for a stepped field with <= 16 values", () => {
    render(
      <DynamicParamForm
        profile={STEPPED_PROFILE}
        value={{ ...DEFAULT_VALUE, density: 40 }}
        onChange={() => {}}
      />,
    );
    // A <select> element should be present for density.
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThan(0);
  });

  it("calls onChange with the full value dict when a range field changes", () => {
    const handleChange = vi.fn();
    render(
      <DynamicParamForm
        profile={RANGE_ONLY_PROFILE}
        value={{ ...DEFAULT_VALUE, power: 50 }}
        onChange={handleChange}
      />,
    );
    const slider = screen.getByTestId("range-slider");
    fireEvent.change(slider, { target: { value: "80" } });
    expect(handleChange).toHaveBeenCalled();
    const called = handleChange.mock.calls[0][0] as Record<string, number | string>;
    // power is updated
    expect(called.power).toBe(80);
    // All other fields preserved
    expect(called.density).toBe(DEFAULT_VALUE.density);
    expect(called.speed).toBe(DEFAULT_VALUE.speed);
  });

  it("propagates changed field while preserving others on stepped select change", () => {
    const handleChange = vi.fn();
    render(
      <DynamicParamForm
        profile={STEPPED_PROFILE}
        value={{ ...DEFAULT_VALUE, density: 40 }}
        onChange={handleChange}
      />,
    );
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "80" } });
    expect(handleChange).toHaveBeenCalled();
    const called = handleChange.mock.calls[0][0] as Record<string, number | string>;
    expect(called.density).toBe(80);
    // Other fields from the original value dict should still be there.
    expect(called.power).toBe(DEFAULT_VALUE.power);
  });

  it("re-renders to show pulse_width when profile changes from STANDARD to COLOR_ENGRAVE", () => {
    const { rerender } = render(
      <DynamicParamForm
        profile={STANDARD_PROFILE}
        value={DEFAULT_VALUE}
        onChange={() => {}}
      />,
    );
    // pulse_width is not_applicable in STANDARD — must be absent.
    expect(screen.queryByText(/pulse width/i)).toBeNull();

    // Re-render with COLOR_ENGRAVE — pulse_width becomes a stepped field.
    rerender(
      <DynamicParamForm
        profile={COLOR_ENGRAVE_PROFILE}
        value={DEFAULT_VALUE}
        onChange={() => {}}
      />,
    );
    // Now pulse_width must be visible.
    expect(screen.getByText(/pulse width/i)).toBeTruthy();
  });

  it("re-renders to hide pulse_width when profile changes from COLOR_ENGRAVE to STANDARD", () => {
    const { rerender } = render(
      <DynamicParamForm
        profile={COLOR_ENGRAVE_PROFILE}
        value={DEFAULT_VALUE}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/pulse width/i)).toBeTruthy();

    rerender(
      <DynamicParamForm
        profile={STANDARD_PROFILE}
        value={DEFAULT_VALUE}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText(/pulse width/i)).toBeNull();
  });

  it("renders nothing for a fully not_applicable profile", () => {
    const profile: ValidationProfile = {
      power:       { kind: "not_applicable" },
      density:     { kind: "not_applicable" },
      frequency:   { kind: "not_applicable" },
      speed:       { kind: "not_applicable" },
      passes:      { kind: "not_applicable" },
      pulse_width: { kind: "not_applicable" },
      laser:       { kind: "not_applicable" },
    };
    const { container } = render(
      <DynamicParamForm
        profile={profile}
        value={DEFAULT_VALUE}
        onChange={() => {}}
      />,
    );
    // The wrapper div is present but no interactive controls.
    expect(container.querySelectorAll("input, select")).toHaveLength(0);
  });
});
