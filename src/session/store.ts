/**
 * Persist Session evidence under nyanclaw/sessions/<id> (draft learning track source).
 * Failures are logged; they must not crash the chat loop.
 */

import { randomBytes } from "node:crypto";
import type { Agent } from "@earendil-works/pi-agent-core";
import {
  appendBlock,
  ensureMachinePage,
  sessionPage,
  type OrgWriteOpts,
} from "../org/index.ts";

export function newSessionId(): string {
  const d = new Date();
  const stamp = d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${stamp}_${randomBytes(3).toString("hex")}`;
}

/** Make a line safe for note/body: avoid Org structural markers at column 0. */
export function asEvidenceLine(line: string): string {
  const noCtrl = line.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  if (
    /^\*+\s/.test(noCtrl) ||
    /^-\s/.test(noCtrl) ||
    /^#\+/i.test(noCtrl) ||
    /^(DEADLINE|SCHEDULED)\s*:/i.test(noCtrl) ||
    noCtrl === ":PROPERTIES:" ||
    noCtrl === ":END:"
  ) {
    return ` ${noCtrl}`;
  }
  return noCtrl;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && "text" in p) return String((p as { text: unknown }).text);
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object" && "text" in content) {
    return String((content as { text: unknown }).text);
  }
  return "";
}

export class SessionRecorder {
  readonly id: string;
  private ensured = false;
  private lastFlushedCount = 0;
  private opts?: OrgWriteOpts;

  constructor(id: string = newSessionId(), opts?: OrgWriteOpts) {
    this.id = id;
    this.opts = opts;
  }

  get pageRef() {
    return sessionPage(this.id);
  }

  private async ensure(): Promise<void> {
    if (this.ensured) return;
    try {
      await ensureMachinePage(this.pageRef, {
        ...this.opts,
        seedLines: [
          `session_id: ${this.id}`,
          `started: ${new Date().toISOString()}`,
          "status: open",
        ],
      });
      this.ensured = true;
    } catch (err) {
      console.error("[nyanclaw session] ensure failed:", err);
    }
  }

  /**
   * Snapshot new user/assistant messages from agent state since last flush.
   * Safe to call on agent_end; errors are swallowed.
   */
  async flushFromAgent(agent: Agent): Promise<void> {
    try {
      await this.ensure();
      if (!this.ensured) return;

      const messages = agent.state.messages ?? [];
      const slice = messages.slice(this.lastFlushedCount);
      if (slice.length === 0) return;

      for (const msg of slice) {
        const role = (msg as { role?: string }).role;
        if (role !== "user" && role !== "assistant") continue;
        const raw = extractText((msg as { content?: unknown }).content);
        if (!raw.trim()) continue;
        const lines = raw.split("\n").map(asEvidenceLine);
        await appendBlock(
          this.pageRef,
          {
            title: role === "user" ? "user" : "assistant",
            body: lines.slice(0, 200),
          },
          this.opts,
        );
      }
      this.lastFlushedCount = messages.length;
    } catch (err) {
      console.error("[nyanclaw session] flush failed:", err);
    }
  }
}
