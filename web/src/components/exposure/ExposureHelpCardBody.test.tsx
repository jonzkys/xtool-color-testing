import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  IndexCardBody,
  ChannelCardBody,
  RawParamCardBody,
} from "./ExposureHelpCardBody";
import {
  EXPOSURE_INDEX_HELP,
  EXPOSURE_CHANNEL_HELP,
  EXPOSURE_RAW_PARAM_HELP,
} from "./exposureHelpCopy";

describe("IndexCardBody", () => {
  it("shows heading, unit, definition, guide, formula, and inputs", () => {
    const help = EXPOSURE_INDEX_HELP.total_exposure_index;
    const { container } = render(<IndexCardBody help={help} />);
    expect(screen.getByText(help.heading)).toBeTruthy();
    expect(screen.getByText(help.unit)).toBeTruthy();
    expect(screen.getByText(help.definition)).toBeTruthy();
    expect(screen.getByText(help.guide)).toBeTruthy();
    expect(screen.getByText(help.formula)).toBeTruthy();
    for (const input of help.inputs) {
      // input rows render `name · unit` so query by the name.
      expect(screen.getAllByText(new RegExp(input.name)).length).toBeGreaterThan(0);
    }
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("ChannelCardBody", () => {
  it("shows heading + definition + guide and omits formula/inputs", () => {
    const help = EXPOSURE_CHANNEL_HELP.L;
    const { container } = render(<ChannelCardBody help={help} />);
    expect(screen.getByText(help.heading)).toBeTruthy();
    expect(screen.getByText(help.definition)).toBeTruthy();
    expect(screen.getByText(help.guide)).toBeTruthy();
    expect(container.textContent).not.toMatch(/INPUTS/i);
    expect(container.textContent).not.toMatch(/FORMULA/i);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("RawParamCardBody", () => {
  it("shows heading, unit, and definition only", () => {
    const help = EXPOSURE_RAW_PARAM_HELP.power;
    const { container } = render(<RawParamCardBody help={help} />);
    expect(screen.getByText(help.heading)).toBeTruthy();
    expect(screen.getByText(help.unit)).toBeTruthy();
    expect(screen.getByText(help.definition)).toBeTruthy();
    // No schematic SVG in this variant.
    expect(container.querySelector("svg")).toBeNull();
  });
});
