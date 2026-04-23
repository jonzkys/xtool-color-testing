import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MobileQrTab } from "./MobileQrTab";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("MobileQrTab", () => {
  it("fetches the mobile-id and exposes the encoded URL", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
      if (url.endsWith("/api/me/mobile-id")) {
        return Promise.resolve(new Response(
          JSON.stringify({ mobile_id: "abc123" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (url.includes("/api/me/mobile-uploads/recent")) {
        return Promise.resolve(new Response("[]", { status: 200 }));
      }
      return Promise.reject(new Error("unexpected " + url));
    }) as typeof fetch);

    render(<MobileQrTab />);
    await waitFor(() => {
      expect(screen.getByTestId("qr-link")).toHaveAttribute(
        "data-mobile-url",
        expect.stringContaining("/#/m/abc123"),
      );
    });
  });
});
