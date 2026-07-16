import { describe, expect, test } from "bun:test";
import {
  parseRepoSlug,
  parseSinceArg,
  windowToSinceIso,
  excerptSummary,
  type SkimCommit,
} from "../fetch.ts";
import { readClonePathFromOrg } from "../resolve.ts";
import { skimPageName } from "../write.ts";

describe("parseRepoSlug", () => {
  test("normalizes URL and slug", () => {
    expect(parseRepoSlug("phpstan/phpstan-src")).toBe("phpstan/phpstan-src");
    expect(parseRepoSlug("https://github.com/phpstan/phpstan-src")).toBe(
      "phpstan/phpstan-src",
    );
  });
  test("rejects garbage", () => {
    expect(() => parseRepoSlug("not-a-repo")).toThrow();
  });
});

describe("parseSinceArg / window", () => {
  test("defaults and durations", () => {
    expect(parseSinceArg(undefined)).toEqual({ kind: "rolling", hours: 24 });
    expect(parseSinceArg("1d")).toEqual({ kind: "rolling", hours: 24 });
    expect(parseSinceArg("3d")).toEqual({ kind: "rolling", hours: 72 });
    expect(parseSinceArg("12h")).toEqual({ kind: "rolling", hours: 12 });
    expect(parseSinceArg("2026-07-01").kind).toBe("since");
  });
  test("windowToSinceIso rolling", () => {
    const now = new Date("2026-07-16T12:00:00Z");
    const iso = windowToSinceIso({ kind: "rolling", hours: 24 }, now);
    expect(iso).toBe("2026-07-15T12:00:00.000Z");
  });
});

describe("skimPageName", () => {
  test("local calendar date", () => {
    const d = new Date(2026, 6, 16); // month 0-based → July
    expect(skimPageName("phpstan/phpstan-src", d)).toBe(
      "GH:phpstan/phpstan-src/skim/2026-07-16",
    );
  });
});

describe("readClonePathFromOrg", () => {
  test("reads property", () => {
    const org = `* GH:x/y\n:PROPERTIES:\n:clone_path: ~/src/foo\n:END:\n`;
    expect(readClonePathFromOrg(org)).toContain("foo");
  });
});

describe("excerptSummary", () => {
  test("lists files", () => {
    const c: SkimCommit = {
      sha: "abc",
      shortSha: "abc1234",
      message: "msg",
      authorDate: "2026-07-16",
      htmlUrl: "https://example.com",
      stats: { additions: 1, deletions: 2, total: 3 },
      files: [
        {
          filename: "a.php",
          status: "modified",
          additions: 1,
          deletions: 2,
          hasPatch: true,
          patch: "@@\n+hello\n-world\n",
        },
      ],
    };
    const lines = excerptSummary(c);
    expect(lines[0]).toContain("+1 -2");
    expect(lines.some((l) => l.includes("a.php"))).toBe(true);
  });
});
