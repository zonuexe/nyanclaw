/**
 * Pure helpers for GH news pages (parse / prune / render / path discovery).
 * Kept free of `gh` CLI and config for easy unit tests.
 */

import { decodePageName } from "../org/paths.ts";

export const ONE_DAY_MS = 86_400_000;

export interface NewsSection {
  dateLabel: string;
  lines: string[];
}

/** Parse existing news page into sections keyed by date. */
export function parseNewsPage(content: string): Map<string, NewsSection> {
  const sections = new Map<string, NewsSection>();
  let current: NewsSection | null = null;

  for (const line of content.split("\n")) {
    if (line.startsWith("* ")) {
      const dateLabel = line.slice(2).trim();
      current = { dateLabel, lines: [line] };
      sections.set(dateLabel, current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

/** Remove sections older than 7 days. */
export function pruneOldSections(
  sections: Map<string, NewsSection>,
  nowMs: number = Date.now(),
): void {
  const cutoff = nowMs - 7 * ONE_DAY_MS;
  for (const [label] of sections) {
    const d = new Date(label);
    if (!isNaN(d.getTime()) && d.getTime() < cutoff) {
      sections.delete(label);
    }
  }
}

/** Render sections back to Org text (opaque history preserved). */
export function renderSections(sections: Map<string, NewsSection>): string {
  const sorted = [...sections.entries()].sort(([a], [b]) => b.localeCompare(a));
  return (
    sorted
      .map(([_, s]) => s.lines.join("\n"))
      .join("\n")
      .trim() + "\n"
  );
}

/** Issue/PR titles for BlockSpec (reject-safe). */
export function safeTitle(raw: string): string {
  return (
    raw
      .replace(/[\r\n]+/g, " ")
      .replace(/^\*+\s*/, "")
      .replace(/^-\s*/, "")
      .trim()
      .slice(0, 500) || "(untitled)"
  );
}

/**
 * From a pages/ filename, return logical news page ref if it is a GH news page.
 * Handles bare `GH:o/r/news.org` and encoded `GH%3Ao%2Fr%2Fnews.org`.
 */
export function newsRefFromFilename(file: string): string | null {
  if (!/\.(org|md)$/i.test(file)) return null;
  const logical = decodePageName(file);
  const m = logical.match(/^GH:(.+)\/news$/);
  if (!m) return null;
  return `GH:${m[1]}/news`;
}

/** Whether a section date label has content on/after cutoff (YYYY-MM-DD). */
export function sectionHasRecentLabel(
  sections: Map<string, NewsSection>,
  cutoffYmd: string,
): boolean {
  for (const [label] of sections) {
    if (label >= cutoffYmd) return true;
  }
  return false;
}
