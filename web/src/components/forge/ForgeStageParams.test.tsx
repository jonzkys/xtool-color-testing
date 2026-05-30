import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ForgeStageParams } from "./ForgeStageParams";
import type { ForgeConfig } from "../../lib/forge/types";
import { DEFAULT_CONFIG } from "../../lib/forge/defaults";

function Harness() {
  const [config, setConfig] = useState<ForgeConfig>(DEFAULT_CONFIG);
  const renameFirstDeepen = () =>
    setConfig((c) => ({
      ...c,
      deepen: {
        ...c.deepen,
        groups: c.deepen.groups.map((g, i) => (i === 0 ? { ...g, name: "CUT_03_RENAMED" } : g)),
      },
    }));
  return (
    <>
      <button onClick={renameFirstDeepen}>do-rename</button>
      <ForgeStageParams config={config} onChange={setConfig} />
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
