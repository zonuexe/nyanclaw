import { describe, expect, test } from "bun:test";
import {
  serializeBlock,
  serializeDocument,
  serializeNote,
  serializeQuote,
} from "../serialize.ts";
import { OrgError } from "../types.ts";
import { assertStructuralOk } from "../validate.ts";
import { encodePageName, decodePageName } from "../paths.ts";
import { appendBlock, appendQuote } from "../ops.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("serializeBlock", () => {
  test("G1 nested TODO with deadline", () => {
    const text = serializeBlock({
      todo: "TODO",
      title: "Prepare: My Talk",
      tags: ["Task"],
      children: [
        {
          todo: "TODO",
          title: 'Submit CfP for "My Talk" @ Conf',
          tags: ["Task"],
          deadline: { date: "2026-08-01" },
        },
      ],
    });
    expect(text).toBe(
      [
        "* TODO Prepare: My Talk #Task",
        '** TODO Submit CfP for "My Talk" @ Conf #Task',
        "DEADLINE: <2026-08-01>",
      ].join("\n"),
    );
  });

  test("rejects title with leading star", () => {
    expect(() => serializeBlock({ title: "* TODO x" })).toThrow(OrgError);
  });

  test("rejects child with explicit level", () => {
    expect(() =>
      serializeBlock({
        title: "Parent",
        children: [{ title: "Child", level: 2 }],
      }),
    ).toThrow(OrgError);
  });

  test("rejects body planning line", () => {
    expect(() =>
      serializeBlock({ title: "X", body: ["DEADLINE: <2026-01-01>"] }),
    ).toThrow(OrgError);
  });
});

describe("serializeQuote", () => {
  test("GQ1 heading + multi-paragraph", () => {
    const text = serializeQuote({
      heading: "概要（全文）",
      lines: ["para one", "", "para two"],
    });
    expect(text).toBe(
      ["* 概要（全文）", "#+BEGIN_QUOTE", "para one", "", "para two", "#+END_QUOTE"].join(
        "\n",
      ),
    );
  });

  test("R4 rejects quote line with BEGIN marker", () => {
    expect(() => serializeQuote({ lines: ["#+BEGIN_QUOTE"] })).toThrow(OrgError);
  });
});

describe("serializeNote", () => {
  test("list style", () => {
    expect(serializeNote({ lines: ["a", "b"] })).toBe("- a\n- b");
  });
});

describe("serializeDocument", () => {
  test("title and blocks", () => {
    const text = serializeDocument({
      title: "page",
      blocks: [{ title: "H" }],
    });
    expect(text).toBe("#+TITLE: page\n* H\n");
  });
});

describe("L2 validate", () => {
  test("R5 rejects * #+BEGIN_QUOTE fragment", () => {
    const bad = "* #+BEGIN_QUOTE\nhello\n#+END_QUOTE";
    expect(() =>
      assertStructuralOk("", bad + "\n", { kind: "append_quote", fragment: bad }),
    ).toThrow(OrgError);
  });

  test("accepts good quote", () => {
    const frag = serializeQuote({ heading: "H", lines: ["body"] });
    expect(() =>
      assertStructuralOk("", frag + "\n", { kind: "append_quote", fragment: frag }),
    ).not.toThrow();
  });
});

describe("paths", () => {
  test("encode/decode roundtrip", () => {
    const name = "GH:o/r/news";
    const enc = encodePageName(name);
    expect(enc).toBe("GH%3Ao%2Fr%2Fnews");
    expect(decodePageName(enc + ".org")).toBe(name);
  });
});

describe("ops temp graph", () => {
  test("appendBlock creates journal", async () => {
    const root = mkdtempSync(join(tmpdir(), "nyanclaw-org-"));
    try {
      const r = await appendBlock(
        { kind: "journal", date: "2026-07-16" },
        { todo: "TODO", title: "Buy milk", tags: ["Task"] },
        { graphRoot: root },
      );
      const content = readFileSync(r.path, "utf-8");
      expect(content).toContain("#+TITLE: 2026_07_16");
      expect(content).toContain("* TODO Buy milk #Task");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("appendQuote to page", async () => {
    const root = mkdtempSync(join(tmpdir(), "nyanclaw-org-"));
    try {
      const r = await appendQuote(
        { kind: "page", name: "イベント/Kaigi on Rails 2026" },
        { heading: "概要（全文）", lines: ["hello", "", "world"] },
        { graphRoot: root },
      );
      const content = readFileSync(r.path, "utf-8");
      expect(content).toContain("#+BEGIN_QUOTE");
      expect(content).toContain("hello");
      expect(content).not.toContain("* #+BEGIN_QUOTE");
      expect(r.path).toContain("%2F"); // slash encoded
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
