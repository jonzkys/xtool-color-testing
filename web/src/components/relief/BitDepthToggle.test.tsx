import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BitDepthToggle } from "./BitDepthToggle";

describe("BitDepthToggle", () => {
  it("highlights the active depth and emits the other on click", () => {
    const onChange = vi.fn();
    render(<BitDepthToggle value={16} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /16-bit/i })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /8-bit/i }));
    expect(onChange).toHaveBeenCalledWith(8);
  });
});
