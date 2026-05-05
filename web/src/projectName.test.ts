import { describe, expect, test } from "vitest";
import { sanitiseProjectName } from "./projectName";

describe("sanitiseProjectName", () => {
  test("strips a single file extension suffix", () => {
    expect(sanitiseProjectName("logo.svg")).toBe("logo");
    expect(sanitiseProjectName("photo.JPEG")).toBe("photo");
  });

  test("only strips a trailing extension, not interior dots", () => {
    expect(sanitiseProjectName("v1.2.3.svg")).toBe("v1.2.3");
  });

  test("replaces commas, colons, and other disallowed chars with hyphens", () => {
    // The actual filename the user reported failing.
    expect(
      sanitiseProjectName("ChatGPT Image May 1, 2026, 06:42:33 PM.png"),
    ).toBe("ChatGPT Image May 1- 2026- 06-42-33 PM");
  });

  test("collapses runs of disallowed chars into a single hyphen", () => {
    // "a,,:b" — three disallowed chars in a row → one hyphen.
    expect(sanitiseProjectName("a,,:b")).toBe("a-b");
    // Spaces are legal so they survive between hyphens.
    expect(sanitiseProjectName("a, b, c")).toBe("a- b- c");
  });

  test("trims leading + trailing whitespace and hyphens", () => {
    expect(sanitiseProjectName("  - hello -  ")).toBe("hello");
  });

  test("returns the fallback when input sanitises to empty", () => {
    expect(sanitiseProjectName(".png", "fallback")).toBe("fallback");
    expect(sanitiseProjectName(" :: , ", "loom")).toBe("loom");
  });

  test("caps length at 64 chars", () => {
    const long = "a".repeat(200);
    expect(sanitiseProjectName(long).length).toBe(64);
  });

  test("preserves valid input verbatim", () => {
    expect(sanitiseProjectName("svg-layers")).toBe("svg-layers");
    expect(sanitiseProjectName("My_Project 2026")).toBe("My_Project 2026");
  });
});
