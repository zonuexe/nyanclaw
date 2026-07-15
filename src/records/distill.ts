/**
 * Extract Record Proposal candidates from conversation messages.
 * Shared by /distill and /bye yes.
 */

import { createProposal, type RecordType } from "./proposal.ts";
import { getCurrentSessionId } from "../session/index.ts";

export type DistillKind = "decision" | "lesson" | "preference" | "all";

export type DistillResult =
  | { ok: true; lines: string[]; count: number }
  | { ok: false; message: string };

function msgText(m: unknown): string {
  if (!m || typeof m !== "object") return "";
  const content = (m as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === "string"
          ? p
          : p && typeof p === "object" && "text" in p
            ? String((p as { text: unknown }).text)
            : "",
      )
      .join("");
  }
  return "";
}

function resolveTypes(kind: DistillKind): RecordType[] {
  if (kind === "all") return ["decision", "lesson", "preference"];
  return [kind];
}

/**
 * @param messages agent.state.messages
 * @param kind which record types to extract
 * @param fallbackAsDecisions when true and no keyword hits, last 5 user msgs as decision
 *   (used by /bye yes for a simpler end-session path that still creates something)
 */
export async function distillMessages(
  messages: unknown[],
  kind: DistillKind = "all",
  opts?: { fallbackAsDecisions?: boolean },
): Promise<DistillResult> {
  const types = resolveTypes(kind);
  const msgs = messages.filter(
    (m) =>
      m &&
      typeof m === "object" &&
      ((m as { role?: string }).role === "user" ||
        (m as { role?: string }).role === "assistant"),
  );
  if (msgs.length === 0) {
    return { ok: false, message: "Nothing to distill — conversation is empty." };
  }

  const userTexts = msgs
    .filter((m) => (m as { role?: string }).role === "user")
    .map(msgText)
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith("/"));

  type Cand = { type: RecordType; title: string; body: string[]; score: number };
  const cands: Cand[] = [];

  const decisionHints =
    /\b(decide|decided|decision|方針|決定|採用|選ぶ|選んだ|instead of|rather than|will use|にします|に決めた)\b/i;
  const lessonHints =
    /\b(lesson|learned|mistake|avoid|don't|do not|pitfall|学び|教訓|注意|失敗|避ける|壊れた)\b/i;
  const prefHints =
    /\b(prefer|preference|always|never|default|好み|常に|絶対|デフォルト|言語|language)\b/i;

  for (const text of userTexts.slice(-12)) {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const title = (lines[0] ?? text).slice(0, 80);
    const body = lines.slice(0, 40);
    const lower = text.toLowerCase();

    if (types.includes("decision") && decisionHints.test(text)) {
      cands.push({
        type: "decision",
        title,
        body,
        score: 3 + (lower.includes("decide") ? 1 : 0),
      });
    }
    if (types.includes("lesson") && lessonHints.test(text)) {
      cands.push({ type: "lesson", title, body, score: 3 });
    }
    if (types.includes("preference") && prefHints.test(text)) {
      cands.push({ type: "preference", title, body, score: 2 });
    }
  }

  if (cands.length === 0 && types.length === 1) {
    for (const text of userTexts.slice(-3)) {
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      cands.push({
        type: types[0]!,
        title: (lines[0] ?? text).slice(0, 80),
        body: lines.slice(0, 40),
        score: 1,
      });
    }
  }

  if (cands.length === 0 && opts?.fallbackAsDecisions) {
    for (const text of userTexts.slice(-5)) {
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      cands.push({
        type: "decision",
        title: (lines[0] ?? text).slice(0, 80),
        body: lines.slice(0, 40),
        score: 1,
      });
    }
  }

  cands.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const picked: Cand[] = [];
  for (const c of cands) {
    const k = `${c.type}:${c.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(c);
    if (picked.length >= 8) break;
  }

  if (picked.length === 0) {
    return {
      ok: false,
      message:
        "No distill candidates (no keyword hits). " +
        "Try `/distill decision` after discussing a choice, or use `/capture` manually.",
    };
  }

  const created: string[] = [];
  const sessionId = getCurrentSessionId();
  for (const c of picked) {
    try {
      const meta = await createProposal({
        type: c.type,
        title: c.title,
        body: c.body,
        sourceSessionId: sessionId,
      });
      created.push(`${meta.type} \`${meta.id}\` — ${meta.title}`);
    } catch {
      /* skip */
    }
  }

  if (created.length === 0) {
    return { ok: false, message: "Distill failed to create proposals." };
  }
  return { ok: true, lines: created, count: created.length };
}

export function formatDistillResult(r: DistillResult, heading = "Distilled"): string {
  if (!r.ok) return r.message;
  return (
    `## ${heading} ${r.count} proposal(s)\n\n` +
    r.lines.map((l) => `- ${l}`).join("\n") +
    `\n\nReview with \`/inbox\`, then \`/apply\` or \`/reject\`.`
  );
}
