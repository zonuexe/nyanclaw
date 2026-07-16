import { describe, expect, test } from "bun:test";
import { buildGrokPrompt } from "../client.ts";

describe("buildGrokPrompt", () => {
  test("appends url when missing", () => {
    const p = buildGrokPrompt("説明して", "https://x.com/a/status/1");
    expect(p).toContain("説明して");
    expect(p).toContain("https://x.com/a/status/1");
  });
  test("does not duplicate url", () => {
    const u = "https://x.com/a/status/1";
    const p = buildGrokPrompt(`これ ${u}`, u);
    expect(p.split(u).length - 1).toBe(1);
  });
});
