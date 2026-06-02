import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StretchControls } from "./StretchControls";
import { DEFAULT_STRETCH_PARAMS } from "./stretch";

describe("StretchControls", () => {
  it("renders the Stretch section and a mode control", () => {
    render(
      <StretchControls params={DEFAULT_STRETCH_PARAMS} onChange={() => {}} />,
    );
    expect(screen.getByText("Stretch")).toBeInTheDocument();
  });

  it("emits a mode change", () => {
    const onChange = vi.fn();
    render(
      <StretchControls params={DEFAULT_STRETCH_PARAMS} onChange={onChange} />,
    );
    const select = screen.getByLabelText(/mode/i);
    fireEvent.change(select, { target: { value: "linear" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "linear" }),
    );
  });

  it("shows mode-specific sliders (gamma)", () => {
    render(
      <StretchControls
        params={{ ...DEFAULT_STRETCH_PARAMS, mode: "gamma" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/gamma/i)).toBeInTheDocument();
  });
});
