import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeTitle,
  findMatchingBlocks,
  rewriteTodoOnLine,
} from "../match.ts";
import { setTodoState, appendBlock } from "../ops.ts";
import { OrgError } from "../types.ts";

describe("normalizeTitle", () => {
  test("strips markers todo tags", () => {
    expect(normalizeTitle("* TODO Buy milk #Task")).toBe("Buy milk");
    expect(normalizeTitle("- DONE Foo")).toBe("Foo");
  });
});

describe("findMatchingBlocks", () => {
  test("finds level-1 and level-2", () => {
    const text = `* TODO Parent #Task
** TODO Child #Task
* Other
`;
    const hits = findMatchingBlocks(text, { byTitle: "Child" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.level).toBe(2);
  });

  test("ambiguous", () => {
    const text = `* TODO Same
* TODO Same
`;
    expect(findMatchingBlocks(text, { byTitle: "Same" }).length).toBe(2);
  });
});

describe("rewriteTodoOnLine", () => {
  test("cycles states", () => {
    expect(rewriteTodoOnLine("* TODO X #Task", "DONE")).toBe("* DONE X #Task");
    expect(rewriteTodoOnLine("* DONE X", null)).toBe("* X");
    expect(rewriteTodoOnLine("- WAITING Y", "TODO")).toBe("- TODO Y");
  });
});

describe("setPlanning", () => {
  test("sets deadline preserving body", async () => {
    const { setPlanning } = await import("../ops.ts");
    const root = mkdtempSync(join(tmpdir(), "nyanclaw-plan-"));
    try {
      await appendBlock(
        { kind: "journal", date: "2026-07-16" },
        {
          todo: "TODO",
          title: "Ship planning",
          tags: ["Task"],
          body: ["keep me"],
        },
        { graphRoot: root },
      );
      await setPlanning(
        { kind: "journal", date: "2026-07-16" },
        "Ship planning",
        { deadline: { date: "2026-08-01" } },
        { graphRoot: root },
      );
      const path = join(root, "journals", "2026_07_16.org");
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("DEADLINE: <2026-08-01>");
      expect(content).toContain("keep me");
      await setPlanning(
        { kind: "journal", date: "2026-07-16" },
        "Ship planning",
        { deadline: null },
        { graphRoot: root },
      );
      const cleared = readFileSync(path, "utf-8");
      expect(cleared).not.toContain("DEADLINE:");
      expect(cleared).toContain("keep me");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("setTodoState", () => {
  test("marks DONE preserving body", async () => {
    const root = mkdtempSync(join(tmpdir(), "nyanclaw-todo-"));
    try {
      await appendBlock(
        { kind: "journal", date: "2026-07-16" },
        {
          todo: "TODO",
          title: "Ship setTodo",
          tags: ["Task"],
          body: ["note line"],
        },
        { graphRoot: root },
      );
      await setTodoState(
        { kind: "journal", date: "2026-07-16" },
        "Ship setTodo",
        "DONE",
        { graphRoot: root },
      );
      const path = join(root, "journals", "2026_07_16.org");
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("* DONE Ship setTodo #Task");
      expect(content).toContain("note line");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("not found", async () => {
    const root = mkdtempSync(join(tmpdir(), "nyanclaw-todo-"));
    try {
      mkdirSync(join(root, "journals"), { recursive: true });
      writeFileSync(join(root, "journals", "2026_07_16.org"), "#+TITLE: x\n* TODO A\n");
      await expect(
        setTodoState({ kind: "journal", date: "2026-07-16" }, "Missing", "DONE", {
          graphRoot: root,
        }),
      ).rejects.toBeInstanceOf(OrgError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
