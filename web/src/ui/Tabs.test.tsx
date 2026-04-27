import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBar } from "./Tabs";

const items = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

describe("TabBar", () => {
  it("renders all items", () => {
    render(<TabBar items={items} value="a" onChange={() => {}} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("marks the active tab via aria-selected", () => {
    render(<TabBar items={items} value="b" onChange={() => {}} />);
    expect(screen.getByText("Beta").closest("button"))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Alpha").closest("button"))
      .toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<TabBar items={items} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByText("Gamma"));
    expect(onChange).toHaveBeenCalledWith("c");
  });
});
