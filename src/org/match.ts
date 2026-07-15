/**
 * Title normalize + line-based block location for mutate ops.
 */

import { OrgError } from "./types.ts";

const TODO_RE = /^(TODO|DONE|WAITING)\s+/;

export function normalizeTitle(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^\*+\s+/, "").replace(/^\s*-\s+/, "");
  s = s.replace(TODO_RE, "");
  s = s.replace(/(\s+#\S+)+$/, "").trim();
  return s;
}

export type LocatedHeadline = {
  lineIndex: number;
  level: number;
  style: "headline" | "list";
  todo: string | null;
  rawLine: string;
  titleNormalized: string;
  /** Inclusive start line, exclusive end line of block (until next same-or-higher marker). */
  start: number;
  end: number;
};

const HEADLINE_RE = /^(\*+)\s+(?:(TODO|DONE|WAITING)\s+)?(.*)$/;
const LIST_RE = /^(\s*)-\s+(?:(TODO|DONE|WAITING)\s+)?(.*)$/;

export function enumerateBlocks(text: string): LocatedHeadline[] {
  const lines = text.split("\n");
  const found: Omit<LocatedHeadline, "end">[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m = line.match(HEADLINE_RE);
    if (m) {
      found.push({
        lineIndex: i,
        level: m[1]!.length,
        style: "headline",
        todo: m[2] ?? null,
        rawLine: line,
        titleNormalized: normalizeTitle(m[3] ?? ""),
        start: i,
      });
      continue;
    }
    m = line.match(LIST_RE);
    if (m) {
      const indent = m[1]!.length;
      const level = Math.floor(indent / 2) + 1;
      found.push({
        lineIndex: i,
        level,
        style: "list",
        todo: m[2] ?? null,
        rawLine: line,
        titleNormalized: normalizeTitle(m[3] ?? ""),
        start: i,
      });
    }
  }

  const out: LocatedHeadline[] = [];
  for (let i = 0; i < found.length; i++) {
    const cur = found[i]!;
    let end = lines.length;
    for (let j = i + 1; j < found.length; j++) {
      if (found[j]!.level <= cur.level) {
        end = found[j]!.start;
        break;
      }
    }
    out.push({ ...cur, end });
  }
  return out;
}

export type MatchQuery = {
  byTitle: string;
  /** Default level1-2 */
  scope?: "level1" | "level1-2";
};

export function findMatchingBlocks(
  text: string,
  query: MatchQuery,
): LocatedHeadline[] {
  const key = normalizeTitle(query.byTitle);
  const maxLevel = query.scope === "level1" ? 1 : 2;
  return enumerateBlocks(text).filter(
    (b) => b.level <= maxLevel && b.titleNormalized === key,
  );
}

export function requireOneMatch(
  text: string,
  query: MatchQuery,
): LocatedHeadline {
  const hits = findMatchingBlocks(text, query);
  if (hits.length === 0) {
    throw new OrgError("not_found", `no block matching title: ${query.byTitle}`, {
      title: query.byTitle,
    });
  }
  if (hits.length > 1) {
    throw new OrgError("ambiguous", `multiple blocks match title: ${query.byTitle}`, {
      title: query.byTitle,
      candidates: hits.map((h) => ({
        title: h.titleNormalized,
        level: h.level,
        line: h.lineIndex + 1,
      })),
    });
  }
  return hits[0]!;
}

const PLANNING_LINE_RE = /^\s*(DEADLINE|SCHEDULED):\s*<([^>]+)>\s*$/i;

export function isPlanningLine(line: string): boolean {
  return PLANNING_LINE_RE.test(line);
}

/** Parse existing DEADLINE/SCHEDULED from block body lines (not including headline). */
export function readPlanningFromBlockLines(lines: string[]): {
  deadline: string | null;
  scheduled: string | null;
} {
  let deadline: string | null = null;
  let scheduled: string | null = null;
  for (const line of lines) {
    const m = line.match(PLANNING_LINE_RE);
    if (!m) continue;
    const kind = m[1]!.toUpperCase();
    const val = m[2]!.trim();
    if (kind === "DEADLINE") deadline = val;
    else scheduled = val;
  }
  return { deadline, scheduled };
}

/**
 * Replace planning lines in a block range. Preserves headline, drawer, body, children.
 * `undefined` field = keep existing; `null` = clear; value = set.
 */
export function splicePlanningLines(
  allLines: string[],
  hit: LocatedHeadline,
  planning: {
    deadline?: { date: string; time?: string } | null;
    scheduled?: { date: string; time?: string } | null;
  },
): string[] {
  const body = allLines.slice(hit.lineIndex + 1, hit.end);
  const existing = readPlanningFromBlockLines(body);
  const withoutPlanning = body.filter((l) => !isPlanningLine(l));

  function formatTs(ts: { date: string; time?: string }): string {
    return ts.time ? `${ts.date} ${ts.time}` : ts.date;
  }

  let deadline: string | null =
    planning.deadline === undefined
      ? existing.deadline
      : planning.deadline === null
        ? null
        : formatTs(planning.deadline);
  let scheduled: string | null =
    planning.scheduled === undefined
      ? existing.scheduled
      : planning.scheduled === null
        ? null
        : formatTs(planning.scheduled);

  const planningIndent = hit.style === "headline" ? "" : "  ".repeat(Math.max(0, hit.level - 1)) + "  ";
  const newPlanning: string[] = [];
  if (deadline) newPlanning.push(`${planningIndent}DEADLINE: <${deadline}>`);
  if (scheduled) newPlanning.push(`${planningIndent}SCHEDULED: <${scheduled}>`);

  // Insert planning immediately after headline, before drawer/body
  const next = [
    ...allLines.slice(0, hit.lineIndex + 1),
    ...newPlanning,
    ...withoutPlanning,
    ...allLines.slice(hit.end),
  ];
  return next;
}

/** Replace TODO keyword on a headline/list line; preserve rest of line. */
export function rewriteTodoOnLine(
  line: string,
  state: "TODO" | "DONE" | "WAITING" | null,
): string {
  const h = line.match(/^(\*+\s+)(?:(TODO|DONE|WAITING)\s+)?(.*)$/);
  if (h) {
    const prefix = h[1]!;
    const rest = h[3]!;
    if (state === null) return `${prefix}${rest}`;
    return `${prefix}${state} ${rest}`;
  }
  const l = line.match(/^(\s*-\s+)(?:(TODO|DONE|WAITING)\s+)?(.*)$/);
  if (l) {
    const prefix = l[1]!;
    const rest = l[3]!;
    if (state === null) return `${prefix}${rest}`;
    return `${prefix}${state} ${rest}`;
  }
  throw new OrgError("not_found", "line is not a headline or list task", { line });
}
