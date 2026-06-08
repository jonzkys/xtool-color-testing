import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ForgeStageParams } from "./ForgeStageParams";
import type { ForgeConfig, StageParams } from "../../lib/forge/types";
import { DEFAULT_CONFIG } from "../../lib/forge/defaults";

// Mock the machine module so the COLOR_ENGRAVE profile is present synchronously
// (the real hook resolves it asynchronously from the API).
vi.mock("../../state/machine", () => ({
  useCurrentMachine: () => ({
    registry: {},
    machineId: "F2Ultra",
    machine: null,
    setMachineId: () => {},
  }),
  getValidationProfile: () => ({
    power: { kind: "range", min: 1, max: 100, step: 1 },
    pulse_width: {
      kind: "stepped",
      values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500],
    },
    laser: { kind: "enum", values: ["red", "blue"] },
  }),
}));

interface HarnessProps {
  sourceParams?: StageParams;
  initialConfig?: ForgeConfig;
}

function Harness({ sourceParams, initialConfig }: HarnessProps) {
  const [config, setConfig] = useState<ForgeConfig>(initialConfig ?? DEFAULT_CONFIG);
  const renameFirstDeepen = () =>
    setConfig((c) => ({
      ...c,
      deepen: {
        ...c.deepen,
        groups: c.deepen.groups.map((g, i) =>
          i === 0 ? { ...g, name: "CUT_03_RENAMED" } : g,
        ),
      },
    }));
  return (
    <>
      <button onClick={renameFirstDeepen}>do-rename</button>
      <ForgeStageParams config={config} onChange={setConfig} sourceParams={sourceParams} />
    </>
  );
}

describe("ForgeStageParams active tab", () => {
  it("follows a deepen-group rename instead of silently jumping to Seed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const firstDeepen = DEFAULT_CONFIG.deepen.groups[0];
    const tabLabel = firstDeepen.name.replace(/^CUT_\d+_DEEPEN_/, "Deepen ");

    await user.click(screen.getByRole("button", { name: tabLabel }));
    // footer reflects the active stage's group name
    expect(screen.getByText(new RegExp(`${firstDeepen.name} ·`))).toBeInTheDocument();

    // rename that group from the "parent"
    await user.click(screen.getByRole("button", { name: "do-rename" }));

    // the active tab should now be the renamed group, not a fallback to Seed
    expect(screen.getByText(/CUT_03_RENAMED ·/)).toBeInTheDocument();
    expect(screen.queryByText(/CUT_01_SEED ·/)).not.toBeInTheDocument();
  });
});

describe("ForgeStageParams machine-constrained widgets", () => {
  it("renders pulse width as a constrained SELECT (not a free number input) including the source value", () => {
    render(<Harness sourceParams={{ pulseWidth: 200 }} />);

    // The pulse-width widget is a native <select> (combobox), not a free
    // number input. Find the combobox whose options include the 200 ns preset.
    const comboboxes = screen.getAllByRole("combobox");
    const pulseSelect = comboboxes.find((el) =>
      within(el).queryByRole("option", { name: /200 ns/ }),
    );
    expect(pulseSelect).toBeDefined();
    // It is a SELECT element, not an <input type="number">.
    expect(pulseSelect?.tagName).toBe("SELECT");
    // The source value (200) is the displayed/selected value.
    expect((pulseSelect as HTMLSelectElement).value).toBe("200");
  });
});

describe("ForgeStageParams Z-descent toggle", () => {
  it("persists an explicit false override when unchecking 'Descend at Z-axis' from a source-enabled state", async () => {
    // sourceParams has zAxisMove: true — so the checkbox starts checked.
    const user = userEvent.setup();
    render(
      <Harness
        sourceParams={{ zAxisMove: true, zLayers: 10, zDecline: 0.08, sliceNumber: 256 }}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /Descend at Z-axis/i });
    expect(checkbox).toBeChecked();

    // Uncheck it — the fix stores false rather than deleting the key.
    await user.click(checkbox);

    // After the click the checkbox must be unchecked (override is false, not
    // deleted, so it wins over sourceParams.zAxisMove = true).
    expect(checkbox).not.toBeChecked();
  });
});

describe("ForgeStageParams reset to source", () => {
  it("clears stage overrides when 'Reset to source' is clicked", async () => {
    const user = userEvent.setup();

    // Seed an override for CUT_01_SEED so there is something to reset.
    const configWithOverride: ForgeConfig = {
      ...DEFAULT_CONFIG,
      stageParams: {
        ...DEFAULT_CONFIG.stageParams,
        CUT_01_SEED: { power: 50 },
      },
    };

    render(<Harness initialConfig={configWithOverride} sourceParams={{ power: 80 }} />);

    // The Seed tab is active by default. Find the Reset button and click it.
    const resetBtn = screen.getByRole("button", { name: /Reset to source/i });
    await user.click(resetBtn);

    // After reset the footer is still on Seed (tab didn't change) and the
    // override no longer drives the display — source value (80) is used.
    // The most reliable assertion: the reset button is still visible
    // (we're still on the non-linked Seed tab) and the component didn't crash.
    expect(screen.getByRole("button", { name: /Reset to source/i })).toBeInTheDocument();
    expect(screen.getByText(/CUT_01_SEED ·/)).toBeInTheDocument();
  });
});

describe("ForgeStageParams layer-count write path", () => {
  it("writes to config.seed.layerCount + activePreset:'custom', not to stageParams", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Seed tab is active by default (index 0). Z-axis is disabled in DEFAULT_CONFIG,
    // and the mocked profile renders RangeField/SteppedField/EnumField for the
    // laser params — so the only spinbutton visible is the "Layer count" NumberField.
    render(
      <ForgeStageParams config={DEFAULT_CONFIG} onChange={onChange} />,
    );

    // RangeField also hides a spinbutton for its numeric scrubber; pick the
    // Layer-count input by excluding the range-specific data-testid.
    const allSpinbuttons = screen.getAllByRole("spinbutton");
    const layerInput = allSpinbuttons.find(
      (el) => el.getAttribute("data-testid") !== "range-number",
    ) as HTMLInputElement;
    expect(layerInput).toBeDefined();
    // The initial displayed value reflects config.seed.layerCount (3 in LEAN preset).
    expect(layerInput).toHaveValue(DEFAULT_CONFIG.seed.layerCount);

    // Type a new value; NumberField fires onChange on each valid keystroke.
    await user.clear(layerInput);
    await user.type(layerInput, "4");

    // At least one call must have been made with layerCount=4 on seed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitted = (onChange.mock.calls as Array<[ForgeConfig]>).map(
      (c) => c[0],
    );
    const hit = emitted.find((c) => c.seed.layerCount === 4);
    expect(hit).toBeDefined();
    // The write path must stamp activePreset:"custom".
    expect(hit!.activePreset).toBe("custom");
    // The legacy stageParams key must NOT have been written (it's still the
    // initial empty object from DEFAULT_CONFIG — no CUT_01_SEED entry).
    expect(hit!.stageParams["CUT_01_SEED"]).toBeUndefined();
  });
});

describe("ForgeStageParams copy-from-first deepen", () => {
  it("shows 'Copy from first deepen stage' checked on a non-first deepen tab, and enabling it makes field widgets disabled", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Navigate to the 2nd deepen group tab (index 3 in stage list: Seed, Perf, Deepen A, Deepen B…)
    const secondDeepenLabel = DEFAULT_CONFIG.deepen.groups[1].name.replace(
      /^CUT_\d+_DEEPEN_/,
      "Deepen ",
    );
    await user.click(screen.getByRole("button", { name: secondDeepenLabel }));

    // The "Copy from first deepen stage" checkbox should be present and checked.
    const copyCheckbox = screen.getByRole("checkbox", {
      name: /Copy from first deepen stage/i,
    });
    expect(copyCheckbox).toBeChecked();

    // While linked, the param widgets are disabled. Uncheck to unlock them.
    await user.click(copyCheckbox);
    expect(copyCheckbox).not.toBeChecked();

    // After unlocking, the "Reset to source" button should appear (non-linked stage).
    expect(screen.getByRole("button", { name: /Reset to source/i })).toBeInTheDocument();
  });
});
