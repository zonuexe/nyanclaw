import { describe, expect, test } from "bun:test";
import { encodePageName } from "../../org/paths.ts";
import {
  newsRefFromFilename,
  parseNewsPage,
  pruneOldSections,
  renderSections,
  safeTitle,
  sectionHasRecentLabel,
  ONE_DAY_MS,
} from "../gh-news.ts";
import { serializeBlock } from "../../org/serialize.ts";

describe("safeTitle", () => {
  test("strips markers and newlines", () => {
    expect(safeTitle("* TODO bad\ntitle")).toBe("TODO bad title");
    expect(safeTitle("- list")).toBe("list");
    expect(safeTitle("")).toBe("(untitled)");
  });
});

describe("parseNewsPage / prune / render", () => {
  test("round-trips opaque history and prunes old days", () => {
    const old = "2020-01-01";
    const recent = "2026-07-10";
    const content = [
      `* ${recent}`,
      "** Open PRs",
      "*** [#1] Keep me",
      `* ${old}`,
      "** Old section",
      "*** gone",
      "",
    ].join("\n");

    const sections = parseNewsPage(content);
    expect(sections.size).toBe(2);
    expect(sections.get(recent)?.lines[0]).toBe(`* ${recent}`);

    pruneOldSections(sections, new Date("2026-07-16T12:00:00Z").getTime());
    expect(sections.has(old)).toBe(false);
    expect(sections.has(recent)).toBe(true);

    const out = renderSections(sections);
    expect(out).toContain("* 2026-07-10");
    expect(out).toContain("Keep me");
    expect(out).not.toContain("2020-01-01");
  });

  test("sectionHasRecentLabel", () => {
    const sections = parseNewsPage("* 2026-07-14\n** x\n");
    expect(sectionHasRecentLabel(sections, "2026-07-10")).toBe(true);
    expect(sectionHasRecentLabel(sections, "2026-07-15")).toBe(false);
  });
});

describe("newsRefFromFilename", () => {
  test("matches encoded and bare names", () => {
    const bare = "GH:owner/repo/news.org";
    // bare colon/slash may not be on disk, but decode of encoded form must work
    const encoded = encodePageName("GH:owner/repo/news") + ".org";
    expect(newsRefFromFilename(encoded)).toBe("GH:owner/repo/news");
    expect(newsRefFromFilename("unrelated.org")).toBeNull();
    expect(newsRefFromFilename("GitHub.org")).toBeNull();
    // If bare form is passed as filename, decode still returns same logical path
    expect(newsRefFromFilename(bare)).toBe("GH:owner/repo/news");
  });
});

describe("structured today section shape", () => {
  test("serializeBlock produces valid depth-3 tree for news-like content", () => {
    const text = serializeBlock({
      title: "2026-07-16",
      children: [
        {
          title: "Untriaged Issues",
          children: [
            { title: safeTitle("[#12] Fix the * thing\nplease") },
          ],
        },
      ],
    });
    expect(text).toContain("* 2026-07-16");
    expect(text).toContain("** Untriaged Issues");
    expect(text).toContain("*** [#12] Fix the * thing please");
    // single-star sibling corruption should not appear as its own line
    expect(text.split("\n").some((l) => l === "* [#12] Fix the * thing please")).toBe(false);
  });
});

describe("ONE_DAY_MS", () => {
  test("is one day", () => {
    expect(ONE_DAY_MS).toBe(86_400_000);
  });
});
