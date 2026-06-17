import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DepthMapsStandalone } from "./DepthMapsStandalone";

// ReliefPage pulls three.js / canvas — mock it; this test covers the shell.
vi.mock("./ReliefPage", () => ({
  ReliefPage: () => <div data-testid="relief-page" />,
}));

describe("DepthMapsStandalone", () => {
  it("renders the wordmark, the tool, the GitHub link and a Main App button", () => {
    render(<DepthMapsStandalone onNavigate={() => {}} />);
    expect(screen.getByText("Depth Maps")).toBeInTheDocument();
    expect(screen.getByTestId("relief-page")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view source on github/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /main app/i }),
    ).toBeInTheDocument();
  });

  it("navigates to the main app (tests) from the Main App button", () => {
    const onNavigate = vi.fn();
    render(<DepthMapsStandalone onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /main app/i }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "tests" });
  });

  it("sets the document title to Depth Maps", () => {
    render(<DepthMapsStandalone onNavigate={() => {}} />);
    expect(document.title).toBe("Depth Maps");
  });
});
