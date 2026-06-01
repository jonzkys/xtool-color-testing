import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TextRegParamsBody, ValidationProfile } from "../types";
import { TextRegParamsEditor } from "./TextRegParamsEditor";

const value: TextRegParamsBody = {
  power: 50, speed: 1000, density: 100, repeat: 2,
  pulse_width: 200, mopa_frequency: 60, processing_light_source: "red",
};
const profile: ValidationProfile = {
  power: { kind: "range", min: 1, max: 100, step: 1 },
  pulse_width: { kind: "stepped", values: [2, 6, 60, 200, 500] },
  laser: { kind: "enum", values: ["red", "blue"] },
};

describe("TextRegParamsEditor", () => {
  it("renders the shared form for a profile (power label present)", () => {
    render(<TextRegParamsEditor value={value} onChange={() => {}} profile={profile} />);
    expect(screen.getByText(/power/i)).toBeTruthy();
  });
  it("shows a placeholder when no profile", () => {
    render(<TextRegParamsEditor value={value} onChange={() => {}} profile={null} />);
    expect(screen.getByText(/loading constraints/i)).toBeTruthy();
  });
});
