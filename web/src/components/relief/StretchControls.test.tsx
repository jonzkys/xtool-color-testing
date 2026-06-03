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

  it("renders the Trim section toggles", () => {
    render(
      <StretchControls params={DEFAULT_STRETCH_PARAMS} onChange={() => {}} />,
    );
    expect(screen.getByText("Trim")).toBeInTheDocument();
    expect(screen.getByText(/remove empty layers/i)).toBeInTheDocument();
    expect(screen.getByText(/remove background/i)).toBeInTheDocument();
  });

  it("shows the threshold slider only when remove background is on", () => {
    const { rerender } = render(
      <StretchControls params={DEFAULT_STRETCH_PARAMS} onChange={() => {}} />,
    );
    expect(screen.queryByLabelText(/threshold/i)).not.toBeInTheDocument();
    rerender(
      <StretchControls
        params={{ ...DEFAULT_STRETCH_PARAMS, removeBackground: true }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/threshold/i)).toBeInTheDocument();
  });
});
