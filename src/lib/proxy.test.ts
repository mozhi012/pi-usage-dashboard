import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProxyFile, resolveProxyOptions } from "./proxy";

describe("readProxyFile", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the first non-empty, non-comment line", () => {
    dir = mkdtempSync(join(tmpdir(), "pi-proxy-"));
    writeFileSync(join(dir, ".pi-proxy"), "# comment\n\nhttp://127.0.0.1:9901\nhttp://other:1\n");
    expect(readProxyFile(dir)).toBe("http://127.0.0.1:9901");
  });

  it("trims surrounding whitespace on the chosen line", () => {
    dir = mkdtempSync(join(tmpdir(), "pi-proxy-"));
    writeFileSync(join(dir, ".pi-proxy"), "   http://a:1   \nhttp://b:2\n");
    expect(readProxyFile(dir)).toBe("http://a:1");
  });

  it("returns null for a missing, empty, or all-comment file", () => {
    dir = mkdtempSync(join(tmpdir(), "pi-proxy-"));
    expect(readProxyFile(join(dir, "does-not-exist"))).toBeNull();
    writeFileSync(join(dir, ".pi-proxy"), "");
    expect(readProxyFile(dir)).toBeNull();
    writeFileSync(join(dir, ".pi-proxy"), "# only\n  # more comments\n\n");
    expect(readProxyFile(dir)).toBeNull();
  });
});

describe("resolveProxyOptions", () => {
  it("prefers an explicit PROXY_URL over env and file", () => {
    const r = resolveProxyOptions({ PROXY_URL: " http://x:1 ", HTTPS_PROXY: "http://y:2" }, "http://file:3");
    expect(r).toEqual({ httpProxy: "http://x:1", httpsProxy: "http://x:1" });
  });

  it("yields to standard proxy env vars (null => let undici read them)", () => {
    for (const env of [{ HTTPS_PROXY: "http://y:2" }, { http_proxy: "http://z:3" }, { ALL_PROXY: "socks5://a:1080" }]) {
      expect(resolveProxyOptions(env, "http://file:3")).toBeNull();
    }
  });

  it("falls back to the local file when no proxy env var is set", () => {
    expect(resolveProxyOptions({}, "http://127.0.0.1:9901"))
      .toEqual({ httpProxy: "http://127.0.0.1:9901", httpsProxy: "http://127.0.0.1:9901" });
  });

  it("treats whitespace-only values as unset", () => {
    expect(resolveProxyOptions({ PROXY_URL: "  " }, null)).toBeNull();
    // whitespace-only standard env var does not count, so the file fallback still applies
    expect(resolveProxyOptions({ HTTPS_PROXY: "   " }, "http://file:3"))
      .toEqual({ httpProxy: "http://file:3", httpsProxy: "http://file:3" });
  });

  it("returns null when neither env nor file provides a proxy", () => {
    expect(resolveProxyOptions({}, null)).toBeNull();
  });
});
