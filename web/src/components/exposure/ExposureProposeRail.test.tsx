import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExposureProposeRail, type ParamRow, type BurnSettings } from "./ExposureProposeRail";
import type { ParamLimitOverrides } from "./ExposureProposeRail";
import type { ExposureRow } from "./exposureCorrelations";

describe("ParamLimitOverrides type", () => {
  it("accepts pulse_width and passes overrides", () => {
    const o: ParamLimitOverrides = {
      power: { min: 5, max: 30 },
      pulse_width: { min: 60, max: 200 },
      passes: { min: 1, max: 4 },
    };
    expect(o.power?.min).toBe(5);
    expect(o.pulse_width?.max).toBe(200);
    expect(o.passes?.min).toBe(1);
  });
});

const ANCHOR: ExposureRow = {
  id: 1,
  hex: "#cb7983",
  lab: [50, 20, 5],
  indices: {
    pulse_spacing_mm: 0.01, line_spacing_mm: 0.002,
    pulse_energy_index: 0.15, pulse_intensity_index: 0.0008,
    total_exposure_index: 65, ablation_aggression_index: 0.05,
    delivery_smoothness_index: 81000,
    duty_cycle_index: 22.2,
    formula_version: 3,
    density_model: "lpc",
    power_model: "controller_percent",
  },
  params: {
    power: 14.6, speed: 1152, frequency: 100, density: 5000, passes: 1, pulse_width: 200,
  },
};

const DEFAULT_PARAM_ROWS: ParamRow[] = [
  { key: "power", kind: "locked", resolved: { min: 12.4, max: 17.6 }, anchorValue: 14.6, unit: "%" },
  { key: "speed", kind: "editable", value: 1152, min: 2, max: 15000, step: 1, unit: "mm/s" },
  { key: "frequency", kind: "editable", value: 100, min: 60, max: 500, step: 1, unit: "kHz" },
  { key: "density", kind: "editable", value: 5000, min: 1, max: 5000, step: 1, unit: "lpc" },
  { key: "passes", kind: "editable", value: 1, min: 1, max: 99, step: 1, unit: "" },
  { key: "pulse_width", kind: "editable", value: 200, min: 2, max: 200, step: 1, unit: "ns",
    presets: [2, 4, 8, 30, 60, 80, 100, 200] },
];

const DEFAULT_BURN_SETTINGS: BurnSettings = {
  scan_angle: 90,
  crosshatch: false,
  angle_mode: "fixed",
  unidirectional: false,
};

function defaultProps() {
  return {
    anchor: ANCHOR,
    entriesInsidePolygon: 3,
    mode: { mode: "curve" as const, varyParam: "power" as const },
    onModeChange: vi.fn(),
    cellCount: 16,
    onCellCountChange: vi.fn(),
    paramRows: DEFAULT_PARAM_ROWS,
    onParamOverrideChange: vi.fn(),
    hasParamOverrides: false,
    onResetParams: vi.fn(),
    burnSettings: DEFAULT_BURN_SETTINGS,
    onBurnSettingChange: vi.fn(),
    rangeReadout: [],
    canCreate: true,
    helperText: null,
    onCreate: vi.fn(),
    onCancel: vi.fn(),
    useFilters: false,
    onUseFiltersChange: vi.fn(),
    ignoreExistingCells: false,
    onIgnoreExistingCellsChange: vi.fn(),
    paramLimitOverrides: {},
    onParamLimitOverrideChange: vi.fn(),
    laserLimits: {
      power:       { min: 1,  max: 100,   step: 1 },
      speed:       { min: 2,  max: 15000, step: 1 },
      frequency:   { min: 60, max: 500,   step: 1 },
      density:     { min: 1,  max: 5000,  step: 1 },
      pulse_width: { min: 2,  max: 500,   step: 1 },
      passes:      { min: 1,  max: 99,    step: 1 },
    },
    crosshatchPolicy: "varies" as "varies" | "on" | "off",
    onCrosshatchPolicyChange: vi.fn(),
    passesRange: { min: 1, max: 4 },
    onPassesRangeChange: vi.fn(),
    survivorCount: 16,
    varyEnabled: {
      power: true,
      speed: true,
      frequency: true,
      density: true,
      pulse_width: true,
      passes: true,
    },
    onVaryChange: vi.fn(),
    anchorParamValues: {
      power: 14.6,
      speed: 1152,
      frequency: 100,
      density: 5000,
      pulse_width: 200,
      passes: 1,
    },
  };
}

describe("ExposureProposeRail editor", () => {
  it("renders a row per param", () => {
    const { container } = render(<ExposureProposeRail {...defaultProps()} />);
    const editor = container.querySelector('[data-role="propose-params-editor"]');
    expect(editor).toBeTruthy();
    const labels = Array.from(editor!.querySelectorAll("[data-row]"))
      .map((el) => (el as HTMLElement).getAttribute("data-row"));
    expect(labels).toEqual([
      "power", "speed", "frequency", "density", "passes", "pulse_width",
    ]);
  });

  it("renders the locked row with resolved min → max readout (no slider thumb)", () => {
    const { container } = render(<ExposureProposeRail {...defaultProps()} />);
    const lockedRow = container.querySelector('[data-row="power"]');
    expect(lockedRow).toBeTruthy();
    expect(lockedRow!.textContent).toMatch(/12\.4 %.*→.*17\.6 %/);
    // Locked rows have no slider input — only an aria-disabled track band.
    expect(lockedRow!.querySelector('input[type="range"]')).toBeNull();
    expect(lockedRow!.querySelector('[aria-disabled="true"]')).toBeTruthy();
  });

  it("calls onParamOverrideChange when an editable slider moves", () => {
    const onParamOverrideChange = vi.fn();
    render(<ExposureProposeRail {...defaultProps()} onParamOverrideChange={onParamOverrideChange} />);
    const slider = screen.getByLabelText(/SPEED value/);
    fireEvent.change(slider, { target: { value: "2000" } });
    expect(onParamOverrideChange).toHaveBeenCalledWith("speed", 2000);
  });

  it("snaps pulse_width to the nearest preset value", () => {
    const onParamOverrideChange = vi.fn();
    render(<ExposureProposeRail {...defaultProps()} onParamOverrideChange={onParamOverrideChange} />);
    const slider = screen.getByLabelText(/PULSE W value/);
    fireEvent.change(slider, { target: { value: "90" } });
    expect(onParamOverrideChange).toHaveBeenCalledWith("pulse_width", 80);
  });

  it("displays the entries-inside-polygon count in the Anchor section", () => {
    render(<ExposureProposeRail {...defaultProps()} entriesInsidePolygon={5} />);
    expect(screen.getByText(/5 entries inside polygon/i)).toBeTruthy();
  });

  it("disables CREATE and shows helper text when canCreate is false", () => {
    const props = { ...defaultProps(), canCreate: false, helperText: "Polygon contains no entries" };
    render(<ExposureProposeRail {...props} />);
    const btn = screen.getByRole("button", { name: /create test/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Polygon contains no entries/i)).toBeTruthy();
  });

  it("disables the reset button when no overrides exist", () => {
    const { container } = render(<ExposureProposeRail {...defaultProps()} />);
    const reset = container.querySelector('[data-role="propose-params-reset"]') as HTMLButtonElement;
    expect(reset).toBeTruthy();
    expect(reset.disabled).toBe(true);
  });

  it("enables reset and calls onResetParams on click when overrides exist", () => {
    const onResetParams = vi.fn();
    const { container } = render(
      <ExposureProposeRail
        {...defaultProps()}
        hasParamOverrides={true}
        onResetParams={onResetParams}
      />,
    );
    const reset = container.querySelector('[data-role="propose-params-reset"]') as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(onResetParams).toHaveBeenCalledTimes(1);
  });
});

describe("ExposureProposeRail burn settings", () => {
  it("renders all four burn-setting controls", () => {
    const { container } = render(<ExposureProposeRail {...defaultProps()} />);
    const section = container.querySelector('[data-role="propose-burn-settings"]');
    expect(section).toBeTruthy();
    expect(section!.querySelector('[data-row="scan_angle"]')).toBeTruthy();
    expect(section!.querySelector('[data-row="crosshatch"]')).toBeTruthy();
    expect(section!.querySelector('[data-row="angle_mode"]')).toBeTruthy();
    expect(section!.querySelector('[data-row="unidirectional"]')).toBeTruthy();
  });

  it("calls onBurnSettingChange when crosshatch toggles", () => {
    const onBurnSettingChange = vi.fn();
    render(<ExposureProposeRail {...defaultProps()} onBurnSettingChange={onBurnSettingChange} />);
    const cb = screen.getByLabelText(/^Crosshatch$/) as HTMLInputElement;
    fireEvent.click(cb);
    expect(onBurnSettingChange).toHaveBeenCalledWith("crosshatch", true);
  });

  it("calls onBurnSettingChange when scan_angle slider moves", () => {
    const onBurnSettingChange = vi.fn();
    render(<ExposureProposeRail {...defaultProps()} onBurnSettingChange={onBurnSettingChange} />);
    const slider = screen.getByLabelText(/Scan angle/);
    fireEvent.change(slider, { target: { value: "135" } });
    expect(onBurnSettingChange).toHaveBeenCalledWith("scan_angle", 135);
  });

  it("calls onBurnSettingChange when angle_mode segmented toggles", () => {
    const onBurnSettingChange = vi.fn();
    const { container } = render(<ExposureProposeRail {...defaultProps()} onBurnSettingChange={onBurnSettingChange} />);
    const incremental = container.querySelector('[data-row="angle_mode"] button[aria-pressed="false"]') as HTMLButtonElement;
    fireEvent.click(incremental);
    expect(onBurnSettingChange).toHaveBeenCalledWith("angle_mode", "incremental");
  });

  it("calls onBurnSettingChange when unidirectional toggles", () => {
    const onBurnSettingChange = vi.fn();
    render(<ExposureProposeRail {...defaultProps()} onBurnSettingChange={onBurnSettingChange} />);
    const cb = screen.getByLabelText(/Unidirectional/) as HTMLInputElement;
    fireEvent.click(cb);
    expect(onBurnSettingChange).toHaveBeenCalledWith("unidirectional", true);
  });

  it("shows the current angle_mode as aria-pressed", () => {
    const { container } = render(
      <ExposureProposeRail {...defaultProps()} burnSettings={{ ...DEFAULT_BURN_SETTINGS, angle_mode: "incremental" }} />,
    );
    const fixed = container.querySelector('[data-row="angle_mode"] button:nth-of-type(1)');
    const inc = container.querySelector('[data-row="angle_mode"] button:nth-of-type(2)');
    expect(fixed?.getAttribute("aria-pressed")).toBe("false");
    expect(inc?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ExposureProposeRail CONSTRAINTS — crosshatch / passes", () => {
  it("renders the crosshatch tri-state", () => {
    render(<ExposureProposeRail {...defaultProps()} crosshatchPolicy="varies" />);
    expect(screen.getByLabelText(/crosshatch varies/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/crosshatch on/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/crosshatch off/i)).toBeInTheDocument();
  });

  it("calls onCrosshatchPolicyChange when a state is clicked", () => {
    const onCrosshatchPolicyChange = vi.fn();
    render(<ExposureProposeRail
      {...defaultProps()}
      crosshatchPolicy="varies"
      onCrosshatchPolicyChange={onCrosshatchPolicyChange}
    />);
    fireEvent.click(screen.getByLabelText(/crosshatch on/i));
    expect(onCrosshatchPolicyChange).toHaveBeenCalledWith("on");
  });

  it("renders the passes min/max inputs in curve mode", () => {
    // In curve mode, the legacy CONSTRAINTS section still has dedicated
    // passes min/max boxes (PASSES isn't varied so a ParamRangeRow
    // doesn't apply — the curve-mode PARAMS section sliders show the
    // anchor's current passes value, not a range).
    render(<ExposureProposeRail
      {...defaultProps()}
      passesRange={{ min: 1, max: 4 }}
    />);
    expect(screen.getByLabelText(/passes minimum/i)).toHaveValue(1);
    expect(screen.getByLabelText(/passes maximum/i)).toHaveValue(4);
  });

  it("in curve mode, keeps the legacy behaviour (only varied param has min/max)", () => {
    render(<ExposureProposeRail
      {...defaultProps()}
      mode={{ mode: "curve", varyParam: "power" }}
    />);
    expect(screen.getByLabelText(/power minimum/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/speed minimum/i)).toBeNull();
  });

  it("cross-clamps passes min/max in curve mode (typing min > max bumps max)", () => {
    const onPassesRangeChange = vi.fn();
    render(<ExposureProposeRail
      {...defaultProps()}
      passesRange={{ min: 1, max: 4 }}
      onPassesRangeChange={onPassesRangeChange}
    />);
    fireEvent.change(screen.getByLabelText(/passes minimum/i), { target: { value: "8" } });
    expect(onPassesRangeChange).toHaveBeenCalledWith({ min: 8, max: 8 });
  });

  it("renders 'Found N/M cells' hint when canCreate is true but cells fall short", () => {
    render(<ExposureProposeRail
      {...defaultProps()}
      cellCount={50}
      survivorCount={31}
    />);
    expect(screen.getByText(/found 31 of 50 cells/i)).toBeInTheDocument();
  });

  it("renders 'No cells reachable' hint when survivors is 0", () => {
    render(<ExposureProposeRail
      {...defaultProps()}
      cellCount={50}
      survivorCount={0}
      canCreate={false}
    />);
    expect(screen.getByText(/no cells reachable/i)).toBeInTheDocument();
  });
});

describe("ExposureProposeRail unified PARAMS — fill mode", () => {
  it("renders a ParamRangeRow for each of the 6 sampleable params", () => {
    const { container } = render(<ExposureProposeRail
      {...defaultProps()}
      mode={{ mode: "fill", varyParams: ["power", "speed"] }}
    />);
    const editor = container.querySelector('[data-role="propose-params-editor"]');
    expect(editor).toBeTruthy();
    const rows = Array.from(editor!.querySelectorAll("[data-row]"))
      .map((el) => (el as HTMLElement).getAttribute("data-row"));
    // Crosshatch is rendered as the last row inside the PARAMS section.
    expect(rows).toEqual([
      "power", "speed", "frequency", "density", "pulse_width", "passes",
      "crosshatch-policy",
    ]);
  });

  it("vary ON renders Radix slider thumbs + min + max text inputs", () => {
    render(<ExposureProposeRail
      {...defaultProps()}
      mode={{ mode: "fill", varyParams: ["power", "speed"] }}
    />);
    // Radix Slider renders thumbs as buttons with role="slider".
    const thumbs = screen.getAllByRole("slider", { name: /power range/i });
    expect(thumbs.length).toBe(2);
    expect(screen.getByLabelText(/power minimum/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/power maximum/i)).toBeInTheDocument();
  });

  it("vary OFF collapses the row to a pinned value (no slider / boxes)", () => {
    const { container } = render(<ExposureProposeRail
      {...defaultProps()}
      mode={{ mode: "fill", varyParams: ["power", "speed"] }}
      varyEnabled={{
        power: false,
        speed: true,
        frequency: true,
        density: true,
        pulse_width: true,
        passes: true,
      }}
    />);
    const row = container.querySelector('[data-row="power"]');
    expect(row).toBeTruthy();
    // Pinned value renders (anchor power = 14.6 → "14.6 %").
    expect(row!.textContent).toMatch(/14\.6 %/);
    // No Radix slider thumb for power.
    expect(row!.querySelector('[role="slider"]')).toBeNull();
    // No min/max number inputs for power.
    expect(row!.querySelector('input[type="number"]')).toBeNull();
    // Vary toggle pill still present.
    expect(row!.querySelector('button[role="switch"]')).toBeTruthy();
  });

  it("clicking the vary toggle flips state", () => {
    const onVaryChange = vi.fn();
    render(<ExposureProposeRail
      {...defaultProps()}
      mode={{ mode: "fill", varyParams: ["power", "speed"] }}
      onVaryChange={onVaryChange}
    />);
    fireEvent.click(screen.getByLabelText(/power vary/i));
    expect(onVaryChange).toHaveBeenCalledWith("power", false);
  });

  it("typing a min greater than the current max bumps max", () => {
    const onParamLimitOverrideChange = vi.fn();
    render(<ExposureProposeRail
      {...defaultProps()}
      mode={{ mode: "fill", varyParams: ["power", "speed"] }}
      paramLimitOverrides={{ power: { min: 10, max: 30 } }}
      onParamLimitOverrideChange={onParamLimitOverrideChange}
    />);
    fireEvent.change(screen.getByLabelText(/power minimum/i), { target: { value: "50" } });
    // The component fires two override callbacks per range update
    // (one for "min", one for "max"). With user min=50 > current
    // max=30, max must be bumped up to 50 to keep the range valid.
    const maxCall = onParamLimitOverrideChange.mock.calls.find(
      (c) => c[0] === "power" && c[1] === "max",
    );
    expect(maxCall).toBeTruthy();
    expect(maxCall![2]).toBe(50);
  });

  it("does NOT render the legacy CONSTRAINTS per-param min/max in fill mode", () => {
    const { container } = render(<ExposureProposeRail
      {...defaultProps()}
      mode={{ mode: "fill", varyParams: ["power", "speed"] }}
    />);
    // The old CONSTRAINTS section's per-param rows were keyed
    // ``limits-${param}`` — none of those should be present anymore.
    expect(container.querySelector('[data-row="limits-power"]')).toBeNull();
    expect(container.querySelector('[data-row="passes-range"]')).toBeNull();
  });
});
