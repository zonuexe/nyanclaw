import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyProposal,
  createProposal,
  listPendingProposals,
  rejectProposal,
} from "../proposal.ts";

describe("createProposal", () => {
  test("writes proposal page and inbox entry without human record page", async () => {
    const root = mkdtempSync(join(tmpdir(), "nyanclaw-prop-"));
    try {
      const meta = await createProposal(
        {
          type: "decision",
          title: "Use Logseq as SoT",
          body: ["We keep one graph.", "No dual vault."],
          sourceSessionId: "sess-1",
        },
        { graphRoot: root },
      );
      expect(meta.state).toBe("pending");
      expect(meta.type).toBe("decision");
      const content = readFileSync(meta.path, "utf-8");
      expect(content).toContain(":state: pending");
      expect(content).toContain("Use Logseq as SoT");
      expect(content).toContain("We keep one graph.");
      const pending = await listPendingProposals({ graphRoot: root });
      expect(pending.some((p) => p.id === meta.id)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("apply promotes to Records/ page and clears inbox", async () => {
    const root = mkdtempSync(join(tmpdir(), "nyanclaw-prop-"));
    try {
      const meta = await createProposal(
        { type: "decision", title: "Ship dual-track writes", body: ["tasks immediate"] },
        { graphRoot: root },
      );
      const r = await applyProposal(meta.id, { graphRoot: root });
      const rec = readFileSync(r.recordPath, "utf-8");
      expect(rec).toContain("Ship dual-track writes");
      expect(rec).toContain(":nyanclaw_proposal: " + meta.id);
      const prop = readFileSync(r.proposalPath, "utf-8");
      expect(prop).toContain(":state: applied");
      const pending = await listPendingProposals({ graphRoot: root });
      expect(pending.some((p) => p.id === meta.id)).toBe(false);
      await expect(applyProposal(meta.id, { graphRoot: root })).rejects.toThrow(/already applied/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reject marks state and removes from inbox", async () => {
    const root = mkdtempSync(join(tmpdir(), "nyanclaw-prop-"));
    try {
      const meta = await createProposal(
        { type: "lesson", title: "Do not free-form Org", body: [] },
        { graphRoot: root },
      );
      await rejectProposal(meta.id, { graphRoot: root });
      const prop = readFileSync(meta.path, "utf-8");
      expect(prop).toContain(":state: rejected");
      const pending = await listPendingProposals({ graphRoot: root });
      expect(pending.length).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
