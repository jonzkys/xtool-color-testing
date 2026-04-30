import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveSpectrumDialog } from "./SaveSpectrumDialog";

const FIXTURE_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  onSaved: vi.fn(),
  testName: "Speed sweep",
  testId: 5,
  axisParam: "speed",
  axisMin: 1000,
  axisMax: 3000,
  swatches: [
    { swatch_row: 0, swatch_col: 1, x_value: 1000, hex: "#404060",
      lab: [28, 5, -22] as [number, number, number] },
    { swatch_row: 0, swatch_col: 2, x_value: 2000, hex: "#7080a0",
      lab: [50, 3, -22] as [number, number, number] },
    { swatch_row: 0, swatch_col: 3, x_value: 3000, hex: "#b0c0e0",
      lab: [75, 1, -10] as [number, number, number] },
  ],
  fitDegree: 2 as const,
  fitCoefficients: {
    l: [10, 0.022, 0],
    a: [6, -0.0017, 0],
    b: [-25, 0.005, 0],
  },
  fitR2: { l: 0.999, a: 0.95, b: 0.92 },
  displayedProjection: "lightness",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ id: 42, ...FIXTURE_PROPS }),
    { status: 201, headers: { "content-type": "application/json" } },
  )));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("SaveSpectrumDialog", () => {
  it("defaults the name to '<test> · <axis> <min>-<max>'", () => {
    render(<SaveSpectrumDialog {...FIXTURE_PROPS} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(input.value).toBe("Speed sweep · speed 1000-3000");
  });

  it("shows the source test, axis range, and fit summary in the preview", () => {
    render(<SaveSpectrumDialog {...FIXTURE_PROPS} />);
    expect(screen.getByText(/Speed sweep/i)).toBeInTheDocument();
    expect(screen.getByText(/1000.*3000/)).toBeInTheDocument();
    expect(screen.getByText(/degree 2/i)).toBeInTheDocument();
    // R² values are rendered with two decimals
    expect(screen.getByText(/0\.99/)).toBeInTheDocument();
  });

  it("submits a payload with the supplied data + the user-edited name", async () => {
    const onSaved = vi.fn();
    render(<SaveSpectrumDialog {...FIXTURE_PROPS} onSaved={onSaved} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.name).toBe("Renamed");
    expect(body.source_test_id).toBe(5);
    expect(body.axis_min).toBe(1000);
    expect(body.swatches).toHaveLength(3);
    expect(body.fit_coefficients.l).toEqual([10, 0.022, 0]);
  });
});
