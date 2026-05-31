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

function Harness({ sourceParams }: { sourceParams?: StageParams }) {
  const [config, setConfig] = useState<ForgeConfig>(DEFAULT_CONFIG);
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
