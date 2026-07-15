import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionRecorder, asEvidenceLine, newSessionId } from "../store.ts";

describe("asEvidenceLine", () => {
  test("prefixes structural markers", () => {
    expect(asEvidenceLine("* TODO x")).toBe(" * TODO x");
    expect(asEvidenceLine("- list")).toBe(" - list");
    expect(asEvidenceLine("plain")).toBe("plain");
  });
});

describe("SessionRecorder", () => {
  test("writes session page under nyanclaw/sessions", async () => {
    const root = mkdtempSync(join(tmpdir(), "nyanclaw-sess-"));
    try {
      const id = newSessionId();
      const rec = new SessionRecorder(id, { graphRoot: root });
      const fakeAgent = {
        state: {
          messages: [
            { role: "user", content: "hello * star" },
            { role: "assistant", content: [{ type: "text", text: "hi\n- not a list" }] },
          ],
        },
      };
      await rec.flushFromAgent(fakeAgent as any);
      const path = join(root, "pages", `nyanclaw%2Fsessions%2F${id}.org`);
      const content = readFileSync(path, "utf-8");
      expect(content).toContain(`session_id: ${id}`);
      expect(content).toContain("* user");
      expect(content).toContain("* assistant");
      expect(content).toContain("hello");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flush failure does not throw when graph missing", async () => {
    const rec = new SessionRecorder("x", { graphRoot: "/nonexistent/path/zzzz" });
    // ensure may create under nonexistent parent - might throw into catch
    await rec.flushFromAgent({ state: { messages: [] } } as any);
  });
});
