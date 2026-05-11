import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureRangeSlider } from "./ExposureRangeSlider";

describe("ExposureRangeSlider", () => {
  it("renders the param name and the data range (via label tooltip)", () => {
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: null, max: null }}
        onChange={() => undefined}
      />,
    );
    const label = screen.getByText(/POWER/);
    expect(label).toBeInTheDocument();
    // The data range is in the label's `title` tooltip rather than a
    // standalone caption (filter-panel rework, 2026-05).
    expect(label.getAttribute("title")).toMatch(/10.*80/);
    expect(screen.getAllByText(/80/).length).toBeGreaterThan(0);
  });

  it("renders current bound values when set", () => {
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
  });

  it("clicking a bound value swaps it for an editable input", () => {
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText("20"));
    const input = screen.getByDisplayValue("20") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("number");
  });

  it("Enter on the editable input commits the new value via onChange", () => {
    const onChange = vi.fn();
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("20"));
    const input = screen.getByDisplayValue("20") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ min: 30, max: 60 });
  });

  it("Escape on the editable input reverts (no onChange)", () => {
    const onChange = vi.fn();
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("20"));
    const input = screen.getByDisplayValue("20") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clicking the reset button clears both bounds", () => {
    const onChange = vi.fn();
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/reset power/i));
    expect(onChange).toHaveBeenCalledWith({ min: null, max: null });
  });

  it("auto-detects log scale when domain ratio > 100", () => {
    // density 5..5000 (1000x range) → log scale on
    const { container } = render(
      <ExposureRangeSlider
        param="density"
        domain={{ min: 5, max: 5000 }}
        value={{ min: null, max: null }}
        onChange={() => undefined}
      />,
    );
    const root = container.querySelector('[data-log-scale="true"]');
    expect(root).not.toBeNull();
  });

  it("uses linear scale when domain ratio <= 100", () => {
    const { container } = render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 1, max: 100 }}
        value={{ min: null, max: null }}
        onChange={() => undefined}
      />,
    );
    const root = container.querySelector('[data-log-scale="false"]');
    expect(root).not.toBeNull();
  });
});
