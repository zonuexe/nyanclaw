import { createHash } from "node:crypto";
import type {
  BlockSpec,
  DocumentSpec,
  NoteSpec,
  PageRef,
  QuoteSpec,
  WriteResult,
} from "./types.ts";
import { OrgError } from "./types.ts";
import {
  serializeBlock,
  serializeDocument,
  serializeNote,
  serializeQuote,
} from "./serialize.ts";
import { assertStructuralOk, maybeRoundTrip } from "./validate.ts";
import { resolvePath, titleForPageRef } from "./paths.ts";
import { mtimeMs, readOrgFile, writeOrgFileAtomic } from "./fs.ts";
import { logseqGraph } from "../config.ts";

export type OrgWriteOpts = {
  /** Override graph root (tests / CLI). Defaults to config logseq_graph. */
  graphRoot?: string;
};

function resolveGraphRoot(opts?: OrgWriteOpts): string {
  if (opts?.graphRoot) return opts.graphRoot;
  return logseqGraph();
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function ensureTrailingNewline(s: string): string {
  if (s === "") return "\n";
  return s.endsWith("\n") ? s : s + "\n";
}

function composeAppend(existing: string | null, fragment: string, title: string): string {
  if (existing === null || existing === "") {
    return `#+TITLE: ${title}\n${fragment}\n`;
  }
  const base = ensureTrailingNewline(existing);
  // If file already ends with newline, append fragment + newline
  return base + fragment + "\n";
}

function debugL1(after: string): void {
  if (process.env.NYANCLAW_ORG_DEBUG === "1") {
    const r = maybeRoundTrip(after);
    if (!r.ok) {
      console.error("[nyanclaw org L1 debug] parse failed:", r.error);
    }
  }
}

export async function appendBlock(
  page: PageRef,
  block: BlockSpec,
  opts?: OrgWriteOpts,
): Promise<WriteResult> {
  return appendBlocks(page, [block], opts);
}

export async function appendBlocks(
  page: PageRef,
  blocks: BlockSpec[],
  opts?: OrgWriteOpts,
): Promise<WriteResult> {
  const root = resolveGraphRoot(opts);
  const path = resolvePath(page, root);
  const fragment = blocks.map((b) => serializeBlock(b)).join("\n");
  const before = readOrgFile(path);
  const mtimeBeforeMs = before !== null ? mtimeMs(path) : undefined;
  const contentHashBefore = before !== null ? sha256(before) : undefined;
  const after = composeAppend(before, fragment, titleForPageRef(page));
  assertStructuralOk(before ?? "", after, { kind: "append_fragment", fragment });
  debugL1(after);
  writeOrgFileAtomic(path, after);
  return {
    path,
    op: before === null ? "create" : "append",
    bytes: new TextEncoder().encode(after).length,
    validated: true,
    mtimeBeforeMs,
    contentHashBefore,
  };
}

export async function appendNote(
  page: PageRef,
  note: NoteSpec,
  opts?: OrgWriteOpts,
): Promise<WriteResult> {
  const root = resolveGraphRoot(opts);
  const path = resolvePath(page, root);
  const fragment = serializeNote(note);
  const before = readOrgFile(path);
  const mtimeBeforeMs = before !== null ? mtimeMs(path) : undefined;
  const contentHashBefore = before !== null ? sha256(before) : undefined;
  const after = composeAppend(before, fragment, titleForPageRef(page));
  assertStructuralOk(before ?? "", after, { kind: "append_note", fragment });
  debugL1(after);
  writeOrgFileAtomic(path, after);
  return {
    path,
    op: before === null ? "create" : "append",
    bytes: new TextEncoder().encode(after).length,
    validated: true,
    mtimeBeforeMs,
    contentHashBefore,
  };
}

export async function appendQuote(
  page: PageRef,
  quote: QuoteSpec,
  opts?: OrgWriteOpts,
): Promise<WriteResult> {
  const root = resolveGraphRoot(opts);
  const path = resolvePath(page, root);
  const fragment = serializeQuote(quote);
  const before = readOrgFile(path);
  const mtimeBeforeMs = before !== null ? mtimeMs(path) : undefined;
  const contentHashBefore = before !== null ? sha256(before) : undefined;
  const after = composeAppend(before, fragment, titleForPageRef(page));
  assertStructuralOk(before ?? "", after, { kind: "append_quote", fragment });
  debugL1(after);
  writeOrgFileAtomic(path, after);
  return {
    path,
    op: before === null ? "create" : "append",
    bytes: new TextEncoder().encode(after).length,
    validated: true,
    mtimeBeforeMs,
    contentHashBefore,
  };
}

export async function writeDocument(
  page: PageRef,
  doc: DocumentSpec,
  opts?: OrgWriteOpts,
): Promise<WriteResult> {
  const root = resolveGraphRoot(opts);
  const path = resolvePath(page, root);
  const before = readOrgFile(path);
  const mtimeBeforeMs = before !== null ? mtimeMs(path) : undefined;
  const contentHashBefore = before !== null ? sha256(before) : undefined;
  const after = serializeDocument(doc);
  assertStructuralOk(before ?? "", after, { kind: "write_document" });
  debugL1(after);
  writeOrgFileAtomic(path, after);
  return {
    path,
    op: "replace",
    bytes: new TextEncoder().encode(after).length,
    validated: true,
    mtimeBeforeMs,
    contentHashBefore,
  };
}

export async function setTodoState(
  page: PageRef,
  byTitle: string,
  state: "TODO" | "DONE" | "WAITING" | null,
  opts?: OrgWriteOpts & { scope?: "level1" | "level1-2" },
): Promise<WriteResult> {
  const { requireOneMatch, rewriteTodoOnLine } = await import("./match.ts");
  const root = resolveGraphRoot(opts);
  const path = resolvePath(page, root);
  const before = readOrgFile(path);
  if (before === null) {
    throw new OrgError("not_found", `file not found: ${path}`);
  }
  const mtimeBeforeMs = mtimeMs(path);
  const contentHashBefore = sha256(before);
  const hit = requireOneMatch(before, { byTitle, scope: opts?.scope });
  const lines = before.split("\n");
  lines[hit.lineIndex] = rewriteTodoOnLine(lines[hit.lineIndex]!, state);
  let after = lines.join("\n");
  if (!after.endsWith("\n") && before.endsWith("\n")) after += "\n";
  assertStructuralOk(before, after, { kind: "write_document" });
  debugL1(after);
  writeOrgFileAtomic(path, after);
  return {
    path,
    op: "splice",
    bytes: new TextEncoder().encode(after).length,
    validated: true,
    mtimeBeforeMs,
    contentHashBefore,
  };
}

export async function setPlanning(
  page: PageRef,
  byTitle: string,
  planning: {
    deadline?: import("./types.ts").OrgTimestamp | null;
    scheduled?: import("./types.ts").OrgTimestamp | null;
  },
  opts?: OrgWriteOpts & { scope?: "level1" | "level1-2" },
): Promise<WriteResult> {
  const { requireOneMatch, splicePlanningLines } = await import("./match.ts");
  const root = resolveGraphRoot(opts);
  const path = resolvePath(page, root);
  const before = readOrgFile(path);
  if (before === null) {
    throw new OrgError("not_found", `file not found: ${path}`);
  }
  const mtimeBeforeMs = mtimeMs(path);
  const contentHashBefore = sha256(before);
  const hit = requireOneMatch(before, { byTitle, scope: opts?.scope });
  const lines = before.split("\n");
  const next = splicePlanningLines(lines, hit, planning);
  let after = next.join("\n");
  if (!after.endsWith("\n")) after += "\n";
  assertStructuralOk(before, after, { kind: "write_document" });
  debugL1(after);
  writeOrgFileAtomic(path, after);
  return {
    path,
    op: "splice",
    bytes: new TextEncoder().encode(after).length,
    validated: true,
    mtimeBeforeMs,
    contentHashBefore,
  };
}

/**
 * Idempotent task write: match by normalizeTitle(title) on page.
 * - 0 matches → appendBlock
 * - 1 match → merge passed fields (todo/deadline/scheduled/tags); full block replace if body or children given
 * - 2+ → ambiguous error
 */
export async function upsertTask(
  page: PageRef,
  block: BlockSpec,
  opts?: OrgWriteOpts & { scope?: "level1" | "level1-2" },
): Promise<WriteResult> {
  const { findMatchingBlocks, rewriteTodoOnLine, splicePlanningLines, normalizeTitle } =
    await import("./match.ts");
  const root = resolveGraphRoot(opts);
  const path = resolvePath(page, root);
  const before = readOrgFile(path);
  const hits = findMatchingBlocks(before ?? "", {
    byTitle: block.title,
    scope: opts?.scope,
  });

  if (hits.length === 0) {
    return appendBlock(page, block, opts);
  }
  if (hits.length > 1) {
    throw new OrgError("ambiguous", `multiple tasks match: ${normalizeTitle(block.title)}`, {
      title: block.title,
      count: hits.length,
    });
  }

  if (before === null) {
    return appendBlock(page, block, opts);
  }

  const hit = hits[0]!;
  const mtimeBeforeMs = mtimeMs(path);
  const contentHashBefore = sha256(before);
  const lines = before.split("\n");

  // Full replace when body or children provided
  if (block.body !== undefined || block.children !== undefined) {
    const fragment = serializeBlock({
      ...block,
      level: hit.level,
      style: block.style ?? hit.style,
    });
    const fragLines = fragment.split("\n");
    const next = [
      ...lines.slice(0, hit.start),
      ...fragLines,
      ...lines.slice(hit.end),
    ];
    let after = next.join("\n");
    if (!after.endsWith("\n")) after += "\n";
    assertStructuralOk(before, after, { kind: "write_document" });
    debugL1(after);
    writeOrgFileAtomic(path, after);
    return {
      path,
      op: "upsert",
      bytes: new TextEncoder().encode(after).length,
      validated: true,
      mtimeBeforeMs,
      contentHashBefore,
    };
  }

  // Field merge: todo keyword + planning + optional tags on headline
  let next = [...lines];
  if (block.todo !== undefined) {
    next[hit.lineIndex] = rewriteTodoOnLine(
      next[hit.lineIndex]!,
      block.todo === null ? null : block.todo,
    );
  }
  if (block.tags !== undefined) {
    // Rewrite tags on headline: strip existing trailing #tags, append new
    const line = next[hit.lineIndex]!;
    const stripped = line.replace(/(\s+#\S+)+$/, "");
    const { normalizeTags } = await import("./serialize.ts");
    const tags = normalizeTags(block.tags);
    next[hit.lineIndex] =
      tags.length > 0
        ? `${stripped} ${tags.map((t) => `#${t}`).join(" ")}`
        : stripped;
  }
  if (block.deadline !== undefined || block.scheduled !== undefined) {
    // Re-locate after possible todo/tag line edits (line index stable)
    const hit2 = {
      ...hit,
      rawLine: next[hit.lineIndex]!,
    };
    next = splicePlanningLines(next, hit2, {
      deadline: block.deadline,
      scheduled: block.scheduled,
    });
  }

  let after = next.join("\n");
  if (!after.endsWith("\n")) after += "\n";
  assertStructuralOk(before, after, { kind: "write_document" });
  debugL1(after);
  writeOrgFileAtomic(path, after);
  return {
    path,
    op: "upsert",
    bytes: new TextEncoder().encode(after).length,
    validated: true,
    mtimeBeforeMs,
    contentHashBefore,
  };
}

export { OrgError };
