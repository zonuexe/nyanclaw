/**
 * Deterministic Logseq-subset Org serializer.
 *
 * Frozen rules:
 * - No blank lines between blocks; document ends with exactly one \n (ops compose).
 * - Tags: caller order, first-wins dedupe, strip leading #.
 * - Property keys: ASCII ascending.
 * - Planning: DEADLINE then SCHEDULED.
 * - No Unicode NFC.
 * - list indent: "  ".repeat(level-1) + "- "
 * - headline: "*".repeat(level) + " "
 * - headline planning: column 0; list planning: content indent.
 * - quote markers: column-0 #+BEGIN_QUOTE / #+END_QUOTE only.
 */

import type {
  BlockSpec,
  BlockStyle,
  DocumentSpec,
  NoteSpec,
  OrgTimestamp,
  QuoteSpec,
} from "./types.ts";
import { OrgError } from "./types.ts";

const MAX_TITLE = 500;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_CHILDREN = 50;
const MAX_DEPTH = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const TAG_RE = /^\S+$/;
const PROP_KEY_RE = /^[A-Za-z0-9_/-]+$/;

export function assertSafeTitle(title: string): string {
  if (typeof title !== "string" || title.trim() === "") {
    throw new OrgError("invalid_title", "title must be non-empty");
  }
  if (title.includes("\n") || title.includes("\r")) {
    throw new OrgError("invalid_title", "title must not contain newlines");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(title)) {
    throw new OrgError("invalid_title", "title must not contain control characters");
  }
  if (/^\*+\s/.test(title) || /^-\s/.test(title)) {
    throw new OrgError(
      "invalid_title",
      "title must not start with headline or list markers",
      { title },
    );
  }
  if (title.length > MAX_TITLE) {
    throw new OrgError("invalid_title", `title length must be <= ${MAX_TITLE}`);
  }
  return title;
}

export function normalizeTags(tags?: string[]): string[] {
  if (!tags?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.replace(/^#+/, "");
    if (!TAG_RE.test(t)) {
      throw new OrgError("invalid_tags", `invalid tag: ${raw}`);
    }
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Strip trailing #tags from title text for dedupe against tags[]. */
function stripTrailingHashTags(title: string): { bare: string; titleTags: string[] } {
  const titleTags: string[] = [];
  let bare = title;
  const re = /\s+#(\S+)$/;
  while (true) {
    const m = bare.match(re);
    if (!m) break;
    titleTags.unshift(m[1]!);
    bare = bare.slice(0, m.index).trimEnd();
  }
  return { bare, titleTags };
}

export function formatTs(ts: OrgTimestamp): string {
  if (!DATE_RE.test(ts.date)) {
    throw new OrgError("invalid_timestamp", `bad date: ${ts.date}`);
  }
  if (ts.time !== undefined && !TIME_RE.test(ts.time)) {
    throw new OrgError("invalid_timestamp", `bad time: ${ts.time}`);
  }
  return ts.time ? `${ts.date} ${ts.time}` : ts.date;
}

function assertSafeBodyLine(line: string): string {
  if (line.includes("\n") || line.includes("\r")) {
    throw new OrgError("invalid_body", "body line must not contain newlines");
  }
  if (
    /^\*+\s/.test(line) ||
    /^(DEADLINE|SCHEDULED)\s*:/i.test(line) ||
    line === ":PROPERTIES:" ||
    line === ":END:" ||
    /^#\+/.test(line)
  ) {
    throw new OrgError("invalid_body", "body line contains forbidden structure", { line });
  }
  return line;
}

function assertSafeQuoteLine(line: string): string {
  if (line.includes("\n") || line.includes("\r")) {
    throw new OrgError("invalid_quote", "quote line must not contain newlines");
  }
  if (line === "") return line;
  if (
    /^\*+\s/.test(line) ||
    /^-\s/.test(line) ||
    /^#\+/i.test(line) ||
    /^(DEADLINE|SCHEDULED)\s*:/i.test(line) ||
    line === ":PROPERTIES:" ||
    line === ":END:"
  ) {
    throw new OrgError("invalid_quote", "quote line contains forbidden structure", { line });
  }
  return line;
}

function countBlocks(block: BlockSpec): number {
  let n = 1;
  for (const c of block.children ?? []) n += countBlocks(c);
  return n;
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function serializeBlockAt(
  block: BlockSpec,
  level: number,
  inheritedStyle: BlockStyle,
  isRoot: boolean,
  depthFromRoot: number,
): string {
  if (depthFromRoot > MAX_DEPTH) {
    throw new OrgError("invalid_depth", `max depth is ${MAX_DEPTH}`);
  }
  if (!isRoot && block.level !== undefined) {
    throw new OrgError(
      "invalid_level",
      "children must not set level (inherited as parent+1)",
    );
  }
  if (isRoot && block.level !== undefined) {
    if (!Number.isInteger(block.level) || block.level < 1) {
      throw new OrgError("invalid_level", "root level must be integer >= 1");
    }
  }

  const style: BlockStyle = block.style ?? inheritedStyle;
  if (!isRoot && block.style !== undefined && block.style !== inheritedStyle) {
    throw new OrgError(
      "invalid_style",
      "v1 forbids mixed style between parent and child",
      { parent: inheritedStyle, child: block.style },
    );
  }

  const marker =
    style === "headline"
      ? `${"*".repeat(level)} `
      : `${"  ".repeat(level - 1)}- `;

  const { bare, titleTags } = stripTrailingHashTags(assertSafeTitle(block.title));
  const tagsMerged = normalizeTags([...(block.tags ?? []), ...titleTags]);

  const todo = block.todo ?? null;
  if (todo && todo !== "TODO" && todo !== "DONE" && todo !== "WAITING") {
    throw new OrgError("invalid_title", `invalid todo keyword: ${String(todo)}`);
  }

  let line = marker;
  if (todo) line += `${todo} `;
  line += bare;
  if (tagsMerged.length) line += ` ${tagsMerged.map((t) => `#${t}`).join(" ")}`;

  const out: string[] = [line];

  const planningIndent = style === "headline" ? "" : `${"  ".repeat(level - 1)}  `;
  if (block.deadline) {
    out.push(`${planningIndent}DEADLINE: <${formatTs(block.deadline)}>`);
  }
  if (block.scheduled) {
    out.push(`${planningIndent}SCHEDULED: <${formatTs(block.scheduled)}>`);
  }

  if (block.properties && Object.keys(block.properties).length > 0) {
    const keys = Object.keys(block.properties).sort();
    out.push(`${planningIndent}:PROPERTIES:`);
    for (const k of keys) {
      if (!PROP_KEY_RE.test(k)) {
        throw new OrgError("invalid_properties", `bad property key: ${k}`);
      }
      const v = block.properties[k]!;
      if (v.includes("\n")) {
        throw new OrgError("invalid_properties", `property value has newline: ${k}`);
      }
      out.push(`${planningIndent}:${k}: ${v}`);
    }
    out.push(`${planningIndent}:END:`);
  }

  const bodyIndent = style === "headline" ? "  " : `${"  ".repeat(level - 1)}  `;
  for (const bl of block.body ?? []) {
    out.push(`${bodyIndent}${assertSafeBodyLine(bl)}`);
  }

  const children = block.children ?? [];
  if (children.length > MAX_CHILDREN) {
    throw new OrgError("invalid_size", `max children is ${MAX_CHILDREN}`);
  }
  for (const child of children) {
    out.push(serializeBlockAt(child, level + 1, style, false, depthFromRoot + 1));
  }

  return out.join("\n");
}

export function serializeBlock(block: BlockSpec): string {
  const level = block.level ?? 1;
  const total = countBlocks(block);
  if (total > MAX_CHILDREN) {
    throw new OrgError("invalid_size", `max blocks per tree is ${MAX_CHILDREN}`);
  }
  const text = serializeBlockAt(block, level, block.style ?? "headline", true, 1);
  if (byteLen(text) > MAX_BODY_BYTES) {
    throw new OrgError("invalid_size", `serialized block exceeds ${MAX_BODY_BYTES} bytes`);
  }
  return text;
}

export function serializeNote(note: NoteSpec): string {
  if (!note.lines?.length) {
    throw new OrgError("invalid_body", "note.lines must be non-empty");
  }
  const style = note.style ?? "list";
  const out: string[] = [];
  let total = 0;
  for (const line of note.lines) {
    const safe = assertSafeBodyLine(line);
    total += byteLen(safe) + 1;
    if (total > MAX_BODY_BYTES) {
      throw new OrgError("invalid_size", `note exceeds ${MAX_BODY_BYTES} bytes`);
    }
    if (style === "list") {
      out.push(`- ${safe}`);
    } else {
      out.push(safe);
    }
  }
  return out.join("\n");
}

export function serializeQuote(quote: QuoteSpec): string {
  if (!quote.lines?.length) {
    throw new OrgError("invalid_quote", "quote.lines must be non-empty");
  }
  const trimmedAllEmpty = quote.lines.every((l) => l.trim() === "");
  if (trimmedAllEmpty) {
    throw new OrgError("invalid_quote", "quote.lines must not be all empty");
  }

  const out: string[] = [];
  if (quote.heading !== undefined) {
    const level = quote.level ?? 1;
    if (!Number.isInteger(level) || level < 1) {
      throw new OrgError("invalid_level", "quote heading level must be integer >= 1");
    }
    const tags = normalizeTags(quote.tags);
    let head = `${"*".repeat(level)} ${assertSafeTitle(quote.heading)}`;
    if (tags.length) head += ` ${tags.map((t) => `#${t}`).join(" ")}`;
    out.push(head);
  }

  out.push("#+BEGIN_QUOTE");
  let total = 0;
  for (const line of quote.lines) {
    const safe = assertSafeQuoteLine(line);
    total += byteLen(safe) + 1;
    if (total > MAX_BODY_BYTES) {
      throw new OrgError("invalid_size", `quote exceeds ${MAX_BODY_BYTES} bytes`);
    }
    out.push(safe);
  }
  out.push("#+END_QUOTE");
  return out.join("\n");
}

export function serializeDocument(doc: DocumentSpec): string {
  const parts: string[] = [];
  if (doc.title !== undefined) {
    // title keyword value: no newlines
    if (doc.title.includes("\n") || doc.title.includes("\r")) {
      throw new OrgError("invalid_title", "document title must not contain newlines");
    }
    parts.push(`#+TITLE: ${doc.title}`);
  }
  for (const b of doc.blocks) {
    parts.push(serializeBlock(b));
  }
  return parts.join("\n") + "\n";
}

export function renderBlock(block: BlockSpec): string {
  return serializeBlock(block);
}

export function renderNote(note: NoteSpec): string {
  return serializeNote(note);
}

export function renderQuote(quote: QuoteSpec): string {
  return serializeQuote(quote);
}

export function renderDocument(doc: DocumentSpec): string {
  return serializeDocument(doc);
}
