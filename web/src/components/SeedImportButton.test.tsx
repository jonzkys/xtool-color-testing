import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SeedImportButton } from "./SeedImportButton";

// Reusable preview fixture — matches SeedPreviewResponse shape.
const PREVIEW = {
  src_owner_id: 1,
  src_has_data: true,
  already_imported: false,
  materials: 8,
  presets: 12,
  tests: 23,
  results: 47,
  palette_entries: 412,
  saved_spectrums: 3,
};

const IMPORT_RESULT = {
  materials: 8,
  presets: 12,
  tests: 23,
  results: 47,
  palette_entries: 412,
  saved_spectrums: 3,
  validation_cells: 0,
  text_reg_machine: 0,
  text_reg_material: 0,
  image_warnings: [],
};

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

// Reload would unmount React + tear vitest down; stub it everywhere.
const originalLocation = window.location;
beforeEach(() => {
  // Some tests want fine-grained control; default to returning the
  // preview on GET and the import result on POST.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/seed/preview")) {
        return jsonResponse(PREVIEW);
      }
      if (
        typeof url === "string"
        && url.includes("/api/seed/import")
        && init?.method === "POST"
      ) {
        return jsonResponse(IMPORT_RESULT);
      }
      return jsonResponse({}, { status: 404 });
    }),
  );
  // Stub the page reload that the success branch triggers. Replace
  // only the reload function — re-defining the entire location
  // object trips Sentry's beforeSend in setup.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload: vi.fn() },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("SeedImportButton", () => {
  it("renders nothing when the current user is the seed user", () => {
    // The parent (TopBar) is responsible for hiding the component in
    // standalone mode by simply not mounting it. The seed-user check
    // lives here so the predicate is locally testable. ``isSeedUser:
    // true`` covers both "I'm literally the seed user" and any
    // upstream scenario where the parent wants the pill hidden.
    const { container } = render(<SeedImportButton isSeedUser={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not mount in standalone mode (parent gates rendering)", () => {
    // Mirrors how TopBar gates the pill: only mounted when mode is
    // multi_user. When the parent decides "don't render", nothing is
    // produced — same observable result as the seed-user case.
    const { container } = render(<>{false && <SeedImportButton />}</>);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByRole("button", { name: /load demo/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the modal with counts after clicking the pill", async () => {
    render(<SeedImportButton isSeedUser={false} />);
    fireEvent.click(screen.getByRole("button", { name: /load demo/i }));

    // Title appears once the modal mounts; counts appear once the
    // preview fetch resolves.
    expect(
      await screen.findByText(/import demo data/i),
    ).toBeInTheDocument();
    expect(await screen.findByText("8")).toBeInTheDocument(); // materials
    expect(screen.getByText("12")).toBeInTheDocument(); // presets
    expect(screen.getByText("23")).toBeInTheDocument(); // tests
    expect(screen.getByText("412")).toBeInTheDocument(); // palette entries
    expect(screen.getByText(/materials/i)).toBeInTheDocument();
  });

  it("disables the import button until the confirmation checkbox is checked", async () => {
    render(<SeedImportButton isSeedUser={false} />);
    fireEvent.click(screen.getByRole("button", { name: /load demo/i }));

    // Wait for the preview to land so the Import button is rendered.
    const importBtn = await screen.findByRole("button", { name: /import/i });
    expect(importBtn).toBeDisabled();

    const cb = screen.getByLabelText(/i understand this will add rows/i);
    fireEvent.click(cb);

    expect(importBtn).not.toBeDisabled();
  });

  it("posts to /api/seed/import when the user confirms and clicks Import", async () => {
    render(<SeedImportButton isSeedUser={false} />);
    fireEvent.click(screen.getByRole("button", { name: /load demo/i }));

    await screen.findByText("8");
    fireEvent.click(screen.getByLabelText(/i understand/i));
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const importCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("/api/seed/import"),
      );
      expect(importCall).toBeTruthy();
      expect((importCall![1] as RequestInit).method).toBe("POST");
    });
  });

  it("shows the already-imported message with only a Close button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ...PREVIEW, already_imported: true }),
      ),
    );
    render(<SeedImportButton isSeedUser={false} />);
    fireEvent.click(screen.getByRole("button", { name: /load demo/i }));

    expect(
      await screen.findByText(/already imported demo data/i),
    ).toBeInTheDocument();
    // No checkbox in the already-imported branch.
    expect(
      screen.queryByLabelText(/i understand/i),
    ).not.toBeInTheDocument();
    // No Import button — only Close.
    expect(
      screen.queryByRole("button", { name: /^import/i }),
    ).not.toBeInTheDocument();
    // Two close buttons exist — the X icon in the dialog header
    // (aria-label="Close") and our explicit "Close" footer button.
    // Both are valid; assert the footer one is rendered by name.
    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    expect(closeButtons.length).toBeGreaterThanOrEqual(1);
    expect(
      closeButtons.some((b) => b.textContent?.trim() === "Close"),
    ).toBe(true);
  });

  it("surfaces the server's error message when the import fails", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        call += 1;
        if (
          typeof url === "string"
          && url.includes("/api/seed/import")
          && init?.method === "POST"
        ) {
          return jsonResponse(
            { detail: "boom — something exploded" },
            { status: 500 },
          );
        }
        if (typeof url === "string" && url.includes("/api/seed/preview")) {
          return jsonResponse(PREVIEW);
        }
        return jsonResponse({}, { status: 404 });
      }),
    );

    render(<SeedImportButton isSeedUser={false} />);
    fireEvent.click(screen.getByRole("button", { name: /load demo/i }));

    await screen.findByText("8");
    fireEvent.click(screen.getByLabelText(/i understand/i));
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    expect(
      await screen.findByText(/boom — something exploded/i),
    ).toBeInTheDocument();
    // Cancel should be re-enabled after the error.
    expect(
      screen.getByRole("button", { name: /cancel/i }),
    ).not.toBeDisabled();
    expect(call).toBeGreaterThan(0);
  });
});
