import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CutoutControls } from "./CutoutControls";
import { SurfaceControls } from "./SurfaceControls";
import { DEFAULT_STRETCH_PARAMS, defaultSubtraction } from "./stretch";
import { DEFAULT_RELIEF_PARAMS } from "../../pages/reliefHelpers";

describe("CutoutControls", () => {
  it("renders the remove-background toggle", () => {
    render(
      <CutoutControls
        params={DEFAULT_STRETCH_PARAMS}
        onChange={() => {}}
        onPickColor={() => {}}
      />,
    );
    expect(screen.getByText(/remove background/i)).toBeInTheDocument();
  });

  it("reveals the threshold slider only when background removal is on", () => {
    const { rerender } = render(
      <CutoutControls
        params={DEFAULT_STRETCH_PARAMS}
        onChange={() => {}}
        onPickColor={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/threshold/i)).not.toBeInTheDocument();
    rerender(
      <CutoutControls
        params={{ ...DEFAULT_STRETCH_PARAMS, removeBackground: true }}
        onChange={() => {}}
        onPickColor={() => {}}
      />,
    );
    expect(screen.getByLabelText(/threshold/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/subtraction 1 method/i)).toBeInTheDocument();
  });

  it("fires onPickColor(index) from a colour row's eyedropper", () => {
    const onPickColor = vi.fn();
    render(
      <CutoutControls
        params={{
          ...DEFAULT_STRETCH_PARAMS,
          removeBackground: true,
          subtractions: [{ method: "colour", threshold: 8, color: null, tolerance: 40, seedX: null, seedY: null }],
        }}
        onChange={() => {}}
        onPickColor={onPickColor}
      />,
    );
    fireEvent.click(screen.getByText(/pick from image/i));
    expect(onPickColor).toHaveBeenCalledWith(0);
  });

  it("appends a row via 'Subtract another'", () => {
    const onChange = vi.fn();
    render(
      <CutoutControls
        params={{ ...DEFAULT_STRETCH_PARAMS, removeBackground: true }}
        onChange={onChange}
        onPickColor={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/subtract another/i));
    const arg = onChange.mock.calls[0][0];
    expect(arg.subtractions).toHaveLength(2);
    expect(arg.subtractions[0]).toEqual(DEFAULT_STRETCH_PARAMS.subtractions[0]); // original kept
    expect(arg.subtractions[1].method).toBe("dark"); // new row from defaultSubtraction()
  });

  it("removes a row via × when more than one row exists", () => {
    const onChange = vi.fn();
    render(
      <CutoutControls
        params={{
          ...DEFAULT_STRETCH_PARAMS,
          removeBackground: true,
          subtractions: [defaultSubtraction("dark"), defaultSubtraction("bright")],
        }}
        onChange={onChange}
        onPickColor={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/remove subtraction 1/i));
    expect(onChange.mock.calls[0][0].subtractions).toHaveLength(1);
  });
});

describe("SurfaceControls", () => {
  const base = {
    reliefParams: DEFAULT_RELIEF_PARAMS,
    onReliefChange: () => {},
    stretchParams: DEFAULT_STRETCH_PARAMS,
    onStretchChange: () => {},
  };

  it("renders the Smoothing and Stretch sections", () => {
    render(<SurfaceControls {...base} />);
    expect(screen.getByText("Smoothing")).toBeInTheDocument();
    expect(screen.getByText("Stretch")).toBeInTheDocument();
  });

  it("emits a stretch mode change", () => {
    const onStretchChange = vi.fn();
    render(<SurfaceControls {...base} onStretchChange={onStretchChange} />);
    fireEvent.change(screen.getByLabelText(/^mode$/i), {
      target: { value: "linear" },
    });
    expect(onStretchChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "linear" }),
    );
  });

  it("shows mode-specific sliders (gamma)", () => {
    render(
      <SurfaceControls
        {...base}
        stretchParams={{ ...DEFAULT_STRETCH_PARAMS, mode: "gamma" }}
      />,
    );
    expect(screen.getByLabelText(/gamma/i)).toBeInTheDocument();
  });
});
