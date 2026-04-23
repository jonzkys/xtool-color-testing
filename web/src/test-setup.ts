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
