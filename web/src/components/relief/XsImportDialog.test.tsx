import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { XsImportDialog } from "./XsImportDialog";
import type { XsDepthJob } from "../../lib/relief/xsImport";

const jobs: XsDepthJob[] = [
  { name: "Logo", processingType: "RELIEF", widthMm: 50, heightMm: 40, pngBytes: new Uint8Array([1]) },
  { name: "Crest", processingType: "INTAGLIO", widthMm: 30, heightMm: 30, pngBytes: new Uint8Array([2]) },
];

describe("XsImportDialog", () => {
  it("shows the error state when there are no jobs", () => {
    render(<XsImportDialog open jobs={[]} onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/no depth maps found/i)).toBeInTheDocument();
  });

  it("lists the jobs with their type labels and fires onPick", () => {
    const onPick = vi.fn();
    render(<XsImportDialog open jobs={jobs} onPick={onPick} onCancel={() => {}} />);
    expect(screen.getByText("Logo")).toBeInTheDocument();
    expect(screen.getByText("Crest")).toBeInTheDocument();
    expect(screen.getByText(/RELIEF/)).toBeInTheDocument();
    expect(screen.getByText(/INTAGLIO/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Logo"));
    expect(onPick).toHaveBeenCalledWith(jobs[0]);
  });
});
