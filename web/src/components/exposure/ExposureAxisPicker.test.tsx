import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureAxisPicker } from "./ExposureAxisPicker";

describe("ExposureAxisPicker", () => {
  it("renders all 7 index options in bivariate mode", () => {
    render(
      <ExposureAxisPicker
        axis="x" mode="bivariate"
        currentKey="total_exposure_index" scale="log"
        onKeyChange={() => undefined}
        onScaleChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/Pulse Spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/Line Spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/Pulse Energy/i)).toBeInTheDocument();
    expect(screen.getByText(/Pulse Intensity/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Exposure/i)).toBeInTheDocument();
    expect(screen.getByText(/Ablation Aggression/i)).toBeInTheDocument();
    expect(screen.getByText(/Delivery Smoothness/i)).toBeInTheDocument();
  });

  it("renders 5 channel options when axis=y and mode=univariate", () => {
    render(
      <ExposureAxisPicker
        axis="y" mode="univariate"
        currentKey="L" scale="linear"
        onKeyChange={() => undefined}
        onScaleChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/L\*/)).toBeInTheDocument();
    expect(screen.getByText(/a\*/)).toBeInTheDocument();
    expect(screen.getByText(/b\*/)).toBeInTheDocument();
    expect(screen.getByText(/Hue/i)).toBeInTheDocument();
    expect(screen.getByText(/Chroma/i)).toBeInTheDocument();
  });

  it("calls onKeyChange when a different option is clicked", () => {
    const onKeyChange = vi.fn();
    render(
      <ExposureAxisPicker
        axis="x" mode="bivariate"
        currentKey="total_exposure_index" scale="log"
        onKeyChange={onKeyChange}
        onScaleChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText(/Pulse Energy Index/i));
    expect(onKeyChange).toHaveBeenCalledWith("pulse_energy_index");
  });

  it("calls onScaleChange when log toggle is clicked", () => {
    const onScaleChange = vi.fn();
    render(
      <ExposureAxisPicker
        axis="x" mode="bivariate"
        currentKey="total_exposure_index" scale="log"
        onKeyChange={() => undefined}
        onScaleChange={onScaleChange}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText(/log scale/i));
    expect(onScaleChange).toHaveBeenCalledWith("linear");
  });

  it("hides log toggle when picking a channel (univariate Y)", () => {
    render(
      <ExposureAxisPicker
        axis="y" mode="univariate"
        currentKey="L" scale="linear"
        onKeyChange={() => undefined}
        onScaleChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByLabelText(/log scale/i)).toBeNull();
  });

  it("calls onClose when Esc is pressed", () => {
    const onClose = vi.fn();
    render(
      <ExposureAxisPicker
        axis="x" mode="bivariate"
        currentKey="total_exposure_index" scale="log"
        onKeyChange={() => undefined}
        onScaleChange={() => undefined}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
