import { describe, expect, it } from "vitest";
import { isPathInside, hasJsonlExtension, expandHome } from "./path-security";

describe("path-security", () => {
  it("rejects sibling paths that merely share a prefix", () => {
    expect(isPathInside("/home/me/.pi/agent/extensions", "/home/me/.pi/agent/extensions-malicious/file")).toBe(false);
  });

  it("allows paths inside the parent directory", () => {
    expect(isPathInside("/home/me/.pi/agent/extensions", "/home/me/.pi/agent/extensions/pkg/file")).toBe(true);
  });

  it("accepts only jsonl session files", () => {
    expect(hasJsonlExtension("/tmp/session.jsonl")).toBe(true);
    expect(hasJsonlExtension("/tmp/session.jsonl.html")).toBe(false);
  });

  it("expands a leading home marker only", () => {
    expect(expandHome("~/sessions", "/home/me")).toBe("/home/me/sessions");
    expect(expandHome("/tmp/~not-home", "/home/me")).toBe("/tmp/~not-home");
  });
});
