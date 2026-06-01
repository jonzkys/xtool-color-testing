// web/src/lib/forge/sha256.test.ts
import { describe, it, expect } from "vitest";
import { sha256Hex } from "./sha256";

describe("sha256Hex (matches hashlib.sha256 / node crypto)", () => {
  it("hashes known vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("M0,0 L5,0 L5,5 Z")).toBe(
      "27b2b6a060e8e7511baa9c93208ac4cfaac67251ef6a4a310b95e0dc437c00ec",
    );
    expect(sha256Hex("a".repeat(100))).toBe(
      "2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e",
    );
  });
});
