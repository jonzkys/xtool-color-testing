import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ForgeControls } from "./ForgeControls";
import type { ForgeConfig, GeneratedClass } from "../../lib/forge/types";
import { DEFAULT_CONFIG } from "../../lib/forge/defaults";

function Harness() {
  const [config, setConfig] = useState<ForgeConfig>(DEFAULT_CONFIG);
  const [visible, setVisible] = useState<Record<GeneratedClass, boolean>>({
    seed: true,
    perforate: true,
    deepen: true,
    clean: true,
    spiral: true,
  });
  return (
    <>
      <div data-testid="name0">{config.deepen.groups[0].name}</div>
      <ForgeControls
        config={config}
        onChange={setConfig}
        visible={visible}
        onToggleVisible={(c) => setVisible((v) => ({ ...v, [c]: !v[c] }))}
      />
    </>
  );
}

describe("ForgeControls deepen name field", () => {
  it("accepts continuous typing without remounting the row (stable key)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const firstName = DEFAULT_CONFIG.deepen.groups[0].name;

    const input = screen.getByDisplayValue(firstName);
    await user.click(input);
    await user.type(input, "_Z9");

    // If the <tr> is keyed by the mutable name, every keystroke remounts the row
    // and the input loses focus, so the parent state never receives the full
    // suffix. A stable key keeps the whole "_Z9" landing in state.
    expect(screen.getByTestId("name0").textContent).toBe(`${firstName}_Z9`);
  });
});
