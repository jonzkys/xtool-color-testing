import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureToolbar } from "./ExposureToolbar";
import type { Material } from "../../library";

const MATERIALS: Material[] = [
  { id: 1, name: "SS Tag", notes: "", created_at: "", owner_id: 0,
    visibility: "private", shape: null, diameter_mm: null,
    width_mm: null, height_mm: null, is_default: false,
    calibration: { wb_supported: false, clean_pass_params: null } } as Material,
  { id: 2, name: "Circular tag" } as Material,
];

const NOOP = () => undefined;
const STD_PROPS = {
  materials: MATERIALS, materialId: 1, onMaterialChange: NOOP,
  mode: "bivariate" as const, onModeChange: NOOP,
  xKey: "total_exposure_index" as const,
  yKey: "pulse_intensity_index" as const,
  xScale: "log" as const, yScale: "log" as const,
  onXKeyChange: NOOP, onYKeyChange: NOOP,
  onXScaleChange: NOOP, onYScaleChange: NOOP,
  proposeOpen: false, onToggleProposeMode: NOOP,
  proposeAvailable: true,
};

describe("ExposureToolbar", () => {
  it("renders the material select with current value selected", () => {
    render(<ExposureToolbar {...STD_PROPS} />);
    const select = screen.getByLabelText(/material/i) as HTMLSelectElement;
    expect(select.value).toBe("1");
  });

  it("calls onMaterialChange when a different material is picked", () => {
    const onMaterialChange = vi.fn();
    render(<ExposureToolbar {...STD_PROPS} onMaterialChange={onMaterialChange} />);
    const select = screen.getByLabelText(/material/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2" } });
    expect(onMaterialChange).toHaveBeenCalledWith(2);
  });

  it("renders univariate / bivariate toggle reflecting current mode", () => {
    render(<ExposureToolbar {...STD_PROPS} mode="univariate" />);
    expect(screen.getByText(/univariate/i)).toBeInTheDocument();
    expect(screen.getByText(/bivariate/i)).toBeInTheDocument();
  });

  it("renders the X axis pill with the current label", () => {
    render(<ExposureToolbar {...STD_PROPS} />);
    expect(screen.getByText(/^TEx/)).toBeInTheDocument();
  });

  it("clicking the X pill opens the picker (visible role=dialog)", () => {
    render(<ExposureToolbar {...STD_PROPS} />);
    const xPill = screen.getByText(/^TEx/).closest("button")!;
    fireEvent.click(xPill);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // Filters + overlays moved out of the toolbar in 2026-05 — they're
  // now tabs in the right rail (ExposureRailTabs).
});
