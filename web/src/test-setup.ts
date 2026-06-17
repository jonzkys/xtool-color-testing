import "@testing-library/jest-dom";

// jsdom doesn't implement URL.createObjectURL / URL.revokeObjectURL.
// Stub them so components that use them can be tested.
if (typeof URL.createObjectURL === "undefined") {
  Object.defineProperty(URL, "createObjectURL", {
    writable: true,
    value: (_obj: Blob) => "blob:mock-url",
  });
}
if (typeof URL.revokeObjectURL === "undefined") {
  Object.defineProperty(URL, "revokeObjectURL", {
    writable: true,
    value: (_url: string) => undefined,
  });
}

// jsdom doesn't implement window.matchMedia — ThemeToggle reads the
// prefers-color-scheme media query. Provide a never-matches stub so any
// component that probes a media query renders in tests.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

// jsdom doesn't implement ResizeObserver — Radix UI primitives
// (Slider, Popover, Dropdown, …) depend on it via @radix-ui/react-use-size.
// Provide a noop polyfill so the components render in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  class MockResizeObserver {
    // Real ResizeObserver requires a callback argument; mirror that
    // signature here so callers (e.g. `new ResizeObserver(cb)`) don't
    // look like they're passing a superfluous argument.
    constructor(_callback?: ResizeObserverCallback) { /* no-op */ }
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  }
  (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver = MockResizeObserver;
}

// jsdom doesn't implement Element.hasPointerCapture / setPointerCapture —
// Radix Slider's thumb refs call them on focus/drag. Stub to no-ops.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = function (): boolean { return false; };
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
  }
}
