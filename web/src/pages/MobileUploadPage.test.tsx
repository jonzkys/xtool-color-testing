import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MobileUploadPage } from "./MobileUploadPage";

beforeEach(() => {
  vi.restoreAllMocks();
});

function _mockFetch(map: Record<string, () => Response | Promise<Response>>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
    for (const key of Object.keys(map)) {
      if (url.includes(key)) return map[key]();
    }
    throw new Error("unexpected url " + url);
  }) as typeof fetch);
}

describe("MobileUploadPage", () => {
  it("shows greeting after a successful check", async () => {
    _mockFetch({
      "/api/m/abc/check": () => new Response(
        JSON.stringify({ ok: true, display_name: "Jon" }),
        { status: 200 },
      ),
    });
    render(<MobileUploadPage mid="abc" />);
    await waitFor(() =>
      expect(screen.getByText(/Jon/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Take or choose photo/i)).toBeInTheDocument();
  });

  it("shows invalid-link message for 404", async () => {
    _mockFetch({
      "/api/m/bad/check": () => new Response("nope", { status: 404 }),
    });
    render(<MobileUploadPage mid="bad" />);
    await waitFor(() =>
      expect(screen.getByText(/no longer valid/i)).toBeInTheDocument(),
    );
  });

  it("renders the success state after upload", async () => {
    _mockFetch({
      "/api/m/abc/check": () => new Response(
        JSON.stringify({ ok: true, display_name: "Jon" }),
        { status: 200 },
      ),
      "/api/m/abc/upload": () => new Response(
        JSON.stringify({
          result_id: 99, test_id: 7, test_name: "Speed test #4",
        }),
        { status: 201 },
      ),
    });
    render(<MobileUploadPage mid="abc" />);
    await waitFor(() =>
      expect(screen.getByText(/Take or choose photos/i)).toBeInTheDocument(),
    );

    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const file = new File(["bytes"], "p.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file] });
    // ``URL.createObjectURL`` isn't implemented in jsdom — stub it for
    // the new multi-file row's thumbnail preview.
    if (typeof URL.createObjectURL !== "function") {
      Object.defineProperty(URL, "createObjectURL", {
        value: () => "blob:fake",
      });
      Object.defineProperty(URL, "revokeObjectURL", { value: () => {} });
    }
    fireEvent.change(input);

    await waitFor(() =>
      expect(screen.getByText(/Speed test #4/)).toBeInTheDocument(),
    );
    // After a successful upload the per-file queue is in place, and
    // the primary button flips to "Add more photos" so the user can
    // keep going.
    expect(screen.getByText(/Add more photos/i)).toBeInTheDocument();
    expect(screen.getByText(/Uploaded — Speed test #4/)).toBeInTheDocument();
  });
});
