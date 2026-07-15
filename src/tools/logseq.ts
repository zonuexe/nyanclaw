import { Type } from "typebox";
import { parse, NodeType } from "org-mode-ast";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logseqGraph } from "../config.ts";
import {
  appendBlock,
  appendNote,
  appendQuote,
  setTodoState,
  OrgError,
  type BlockSpec,
  type PageRef,
  type TodoKeyword,
} from "../org/index.ts";

// Lazy directory path accessors — env var is resolved on first tool use, not at module init
function journalsDir() {
  return join(logseqGraph(), "journals");
}
function pagesDir() {
  return join(logseqGraph(), "pages");
}

function defineTool(def: {
  name: string;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: { type: "text"; text: string }[]; details: unknown }>;
}) {
  return def as any;
}

function journalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}_${m}_${d}`;
}

interface OrgHeadline {
  level: number;
  title: string;
  todoKeyword?: string;
  tags?: string[];
  scheduled?: string;
  deadline?: string;
}

function analyzeOrg(content: string): {
  title: string;
  headlines: OrgHeadline[];
  bodyParts: string[];
} {
  const ast = parse(content);

  let title = "";
  for (const child of ast.childrenList) {
    if (child.type === NodeType.Keyword && child.rawValue?.startsWith("#+TITLE:")) {
      title = child.rawValue.replace("#+TITLE:", "").trim();
    }
  }

  const headlines: OrgHeadline[] = [];
  function walk(node: typeof ast): void {
    if (node.is(NodeType.Headline)) {
      const h: OrgHeadline = {
        level: node.level,
        title: "",
      };

      const title = node.title;
      if (title) {
        for (const tc of title.childrenList) {
          if (tc.is(NodeType.TodoKeyword)) {
            h.todoKeyword = tc.value || tc.rawValue;
          } else if (tc.is(NodeType.Text)) {
            h.title = (tc.value || tc.rawValue || "").trim();
          }
        }
      }

      // Extract planning info (SCHEDULED:, DEADLINE:)
      const section = node.section;
      if (section) {
        for (const sc of section.childrenList) {
          if (sc.is(NodeType.Planning)) {
            const raw = sc.rawValue || "";
            const sched = raw.match(/SCHEDULED:\s*<([^>]+)>/);
            if (sched) h.scheduled = sched[1];
            const deadline = raw.match(/DEADLINE:\s*<([^>]+)>/);
            if (deadline) h.deadline = deadline[1];
          }
        }
      }

      headlines.push(h);
    }
    for (const c of node.childrenList ?? []) walk(c);
  }
  walk(ast);

  const bodyParts: string[] = [];
  for (const child of ast.childrenList) {
    const raw = child.rawValue?.trim();
    if (
      raw &&
      child.type !== NodeType.Keyword &&
      child.type !== NodeType.NewLine &&
      child.type !== NodeType.Headline
    ) {
      bodyParts.push(raw.slice(0, 300));
    }
  }

  return { title, headlines, bodyParts };
}

export const logseqReadJournal = defineTool({
  name: "logseq_read_journal",
  label: "Read Logseq Journal",
  description:
    "Read a Logseq journal page and return structured content (TODOs, headlines, notes).",
  parameters: Type.Object({
    date: Type.Optional(
      Type.String({ description: "Date in YYYY-MM-DD format. Defaults to today." }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const dateStr = params.date as string | undefined;
    const journalPath = dateStr
      ? join(journalsDir(), `${journalDate(new Date(dateStr))}.org`)
      : join(journalsDir(), `${journalDate(new Date())}.org`);

    try {
      const content = await readFile(journalPath, "utf-8");
      const analysis = analyzeOrg(content);
      const dateLabel = dateStr ?? "today";

      let result = `## Journal: ${dateLabel}\n\n`;

      const todos = analysis.headlines.filter((h) => h.todoKeyword === "TODO");
      const dones = analysis.headlines.filter((h) => h.todoKeyword === "DONE");
      const waitings = analysis.headlines.filter((h) => h.todoKeyword === "WAITING");
      const others = analysis.headlines.filter(
        (h) =>
          h.todoKeyword !== "TODO" &&
          h.todoKeyword !== "DONE" &&
          h.todoKeyword !== "WAITING",
      );

      if (todos.length > 0) {
        result += `### TODO\n`;
        for (const t of todos) {
          result += `- ${"  ".repeat(t.level - 1)}* ${t.title}`;
          if (t.scheduled) result += ` (scheduled: ${t.scheduled})`;
          if (t.deadline) result += ` (deadline: ${t.deadline})`;
          result += "\n";
        }
        result += "\n";
      }

      if (waitings.length > 0) {
        result += `### WAITING\n`;
        for (const w of waitings) {
          result += `- ${w.title}`;
          if (w.scheduled) result += ` (scheduled: ${w.scheduled})`;
          if (w.deadline) result += ` (deadline: ${w.deadline})`;
          result += "\n";
        }
        result += "\n";
      }

      if (dones.length > 0) {
        result += `### DONE\n`;
        for (const d of dones) {
          result += `- ~~${d.title}~~\n`;
        }
        result += "\n";
      }

      if (others.length > 0) {
        result += `### Other headings\n`;
        for (const h of others) {
          result += `- ${h.todoKeyword ? `${h.todoKeyword} ` : ""}${h.title}\n`;
        }
        result += "\n";
      }

      if (analysis.bodyParts.length > 0) {
        result += `### Notes\n${analysis.bodyParts.join("\n").slice(0, 2000)}\n`;
      }

      return {
        content: [{ type: "text", text: result }],
        details: { path: journalPath, headlines: analysis.headlines.length },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Could not read journal: ${msg}` }],
        details: { path: journalPath, error: msg },
      };
    }
  },
});

function resolvePageRef(params: {
  page?: string;
  journalDate?: string;
}): PageRef {
  const page = params.page;
  const journalDateIso = params.journalDate;
  if (page && journalDateIso) {
    throw new OrgError(
      "invalid_title",
      "Specify either page or journalDate, not both",
    );
  }
  if (page) {
    // Legacy underscore journal filenames passed as page=
    if (/^\d{4}_\d{2}_\d{2}$/.test(page)) {
      const iso = page.replace(/_/g, "-");
      return { kind: "journal", date: iso };
    }
    return { kind: "page", name: page };
  }
  return { kind: "journal", date: journalDateIso };
}

function parseTodo(v: unknown): TodoKeyword | undefined {
  if (v === "TODO" || v === "DONE" || v === "WAITING") return v;
  return undefined;
}

function parseTs(s: string | undefined): { date: string; time?: string } | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/);
  if (!m) {
    throw new OrgError("invalid_timestamp", `expected YYYY-MM-DD or YYYY-MM-DD HH:MM, got ${s}`);
  }
  return m[2] ? { date: m[1]!, time: m[2] } : { date: m[1]! };
}

function childBlockFromParams(c: Record<string, unknown>): BlockSpec {
  return {
    title: String(c.title ?? ""),
    todo: parseTodo(c.todo),
    tags: Array.isArray(c.tags) ? (c.tags as string[]) : undefined,
    deadline: parseTs(c.deadline as string | undefined),
    scheduled: parseTs(c.scheduled as string | undefined),
    body: Array.isArray(c.body) ? (c.body as string[]) : undefined,
    children: Array.isArray(c.children)
      ? (c.children as Record<string, unknown>[]).map(childBlockFromParams)
      : undefined,
  };
}

function toolError(err: unknown): {
  content: { type: "text"; text: string }[];
  details: unknown;
} {
  if (err instanceof OrgError) {
    return {
      content: [{ type: "text", text: `Org write failed (${err.code}): ${err.message}` }],
      details: { error: err.code, message: err.message, ...err.details },
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `Org write failed: ${msg}` }],
    details: { error: msg },
  };
}

const pageParams = {
  journalDate: Type.Optional(
    Type.String({ description: "YYYY-MM-DD; default today → journals/YYYY_MM_DD.org" }),
  ),
  page: Type.Optional(
    Type.String({
      description: "Logical page name (not file path). Encoded on write. XOR with journalDate.",
    }),
  ),
};

export const logseqAppendBlock = defineTool({
  name: "logseq_append_block",
  label: "Append Logseq Block",
  description:
    "Append a structured headline/list block to a Logseq page or journal. Pass title text only — do not include Org markers (* or -) or raw Org syntax.",
  parameters: Type.Object({
    title: Type.String({
      description: "Title text only; no leading * or -; no newlines",
    }),
    todo: Type.Optional(
      Type.Union([
        Type.Literal("TODO"),
        Type.Literal("DONE"),
        Type.Literal("WAITING"),
      ]),
    ),
    tags: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
    deadline: Type.Optional(
      Type.String({ description: "YYYY-MM-DD or YYYY-MM-DD HH:MM" }),
    ),
    scheduled: Type.Optional(
      Type.String({ description: "YYYY-MM-DD or YYYY-MM-DD HH:MM" }),
    ),
    body: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
    style: Type.Optional(
      Type.Union([Type.Literal("headline"), Type.Literal("list")]),
    ),
    children: Type.Optional(
      Type.Array(
        Type.Object({
          title: Type.String(),
          todo: Type.Optional(
            Type.Union([
              Type.Literal("TODO"),
              Type.Literal("DONE"),
              Type.Literal("WAITING"),
            ]),
          ),
          tags: Type.Optional(Type.Array(Type.String())),
          deadline: Type.Optional(Type.String()),
          scheduled: Type.Optional(Type.String()),
          body: Type.Optional(Type.Array(Type.String())),
          children: Type.Optional(
            Type.Array(
              Type.Object({
                title: Type.String(),
                todo: Type.Optional(
                  Type.Union([
                    Type.Literal("TODO"),
                    Type.Literal("DONE"),
                    Type.Literal("WAITING"),
                  ]),
                ),
                tags: Type.Optional(Type.Array(Type.String())),
                deadline: Type.Optional(Type.String()),
                scheduled: Type.Optional(Type.String()),
                body: Type.Optional(Type.Array(Type.String())),
              }),
            ),
          ),
        }),
      ),
    ),
    ...pageParams,
  }),
  execute: async (_toolCallId, params) => {
    try {
      const ref = resolvePageRef({
        page: params.page as string | undefined,
        journalDate: params.journalDate as string | undefined,
      });
      const block: BlockSpec = {
        title: String(params.title),
        todo: parseTodo(params.todo),
        tags: Array.isArray(params.tags) ? (params.tags as string[]) : undefined,
        deadline: parseTs(params.deadline as string | undefined),
        scheduled: parseTs(params.scheduled as string | undefined),
        body: Array.isArray(params.body) ? (params.body as string[]) : undefined,
        style: params.style === "list" ? "list" : "headline",
        children: Array.isArray(params.children)
          ? (params.children as Record<string, unknown>[]).map(childBlockFromParams)
          : undefined,
      };
      const result = await appendBlock(ref, block);
      return {
        content: [{ type: "text", text: `Appended block to ${result.path}` }],
        details: result,
      };
    } catch (err) {
      return toolError(err);
    }
  },
});

export const logseqAppendNote = defineTool({
  name: "logseq_append_note",
  label: "Append Logseq Note",
  description:
    "Append plain-text note lines (list or paragraph). No Org markers. For multi-paragraph quotes use logseq_append_quote.",
  parameters: Type.Object({
    lines: Type.Array(Type.String({ description: "Plain text line; no Org markers" }), {
      minItems: 1,
      maxItems: 100,
    }),
    style: Type.Optional(
      Type.Union([Type.Literal("list"), Type.Literal("paragraph")]),
    ),
    ...pageParams,
  }),
  execute: async (_toolCallId, params) => {
    try {
      const ref = resolvePageRef({
        page: params.page as string | undefined,
        journalDate: params.journalDate as string | undefined,
      });
      const result = await appendNote(ref, {
        lines: params.lines as string[],
        style: (params.style as "list" | "paragraph" | undefined) ?? "list",
      });
      return {
        content: [{ type: "text", text: `Appended note to ${result.path}` }],
        details: result,
      };
    } catch (err) {
      return toolError(err);
    }
  },
});

export const logseqAppendQuote = defineTool({
  name: "logseq_append_quote",
  label: "Append Logseq Quote",
  description:
    "Append a quote/record block. Pass plain text lines only — do NOT write #+BEGIN_QUOTE yourself. Optional heading above the quote.",
  parameters: Type.Object({
    lines: Type.Array(
      Type.String({
        description:
          "One plain text line; empty string = blank line inside quote. No #+BEGIN/END, no leading * or -.",
      }),
      { minItems: 1, maxItems: 500 },
    ),
    heading: Type.Optional(
      Type.String({ description: "Optional headline above the quote (title only)" }),
    ),
    tags: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
    ...pageParams,
  }),
  execute: async (_toolCallId, params) => {
    try {
      const ref = resolvePageRef({
        page: params.page as string | undefined,
        journalDate: params.journalDate as string | undefined,
      });
      const result = await appendQuote(ref, {
        lines: params.lines as string[],
        heading: params.heading as string | undefined,
        tags: Array.isArray(params.tags) ? (params.tags as string[]) : undefined,
      });
      return {
        content: [{ type: "text", text: `Appended quote to ${result.path}` }],
        details: result,
      };
    } catch (err) {
      return toolError(err);
    }
  },
});

export const logseqSetTodo = defineTool({
  name: "logseq_set_todo",
  label: "Set Logseq TODO state",
  description:
    "Change TODO/DONE/WAITING on an existing headline or list task by title match (exact, normalized). Fails if zero or multiple matches.",
  parameters: Type.Object({
    title: Type.String({
      description: "Task title only (no * / - / TODO keyword / tags required for match)",
    }),
    state: Type.Union([
      Type.Literal("TODO"),
      Type.Literal("DONE"),
      Type.Literal("WAITING"),
      Type.Literal("none"),
    ], { description: "New state; 'none' removes the keyword" }),
    ...pageParams,
  }),
  execute: async (_toolCallId, params) => {
    try {
      const ref = resolvePageRef({
        page: params.page as string | undefined,
        journalDate: params.journalDate as string | undefined,
      });
      const stateRaw = params.state as string;
      const state =
        stateRaw === "none" ? null : (stateRaw as "TODO" | "DONE" | "WAITING");
      const result = await setTodoState(ref, String(params.title), state);
      return {
        content: [
          {
            type: "text",
            text: `Set TODO state to ${stateRaw} for “${params.title}” in ${result.path}`,
          },
        ],
        details: result,
      };
    } catch (err) {
      return toolError(err);
    }
  },
});

/** @deprecated Use logseq_append_block / note / quote. Only when NYANCLAW_ORG_LEGACY_WRITE=1. */
export const logseqWriteBlock = defineTool({
  name: "logseq_write_block",
  label: "Write Logseq Block (legacy)",
  description:
    "LEGACY free-form Org append. Disabled unless NYANCLAW_ORG_LEGACY_WRITE=1. Prefer logseq_append_block / logseq_append_note / logseq_append_quote.",
  parameters: Type.Object({
    content: Type.String({ description: "Block content (legacy raw Org)" }),
    page: Type.Optional(Type.String()),
    asHeadline: Type.Optional(Type.Boolean({ default: false })),
  }),
  execute: async (_toolCallId, params) => {
    if (process.env.NYANCLAW_ORG_LEGACY_WRITE !== "1") {
      return {
        content: [
          {
            type: "text",
            text:
              "logseq_write_block is disabled. Use logseq_append_block, logseq_append_note, or logseq_append_quote. Set NYANCLAW_ORG_LEGACY_WRITE=1 only as emergency fallback.",
          },
        ],
        details: { error: "legacy_disabled" },
      };
    }
    // Minimal emergency path: single-line title as block only (still structured)
    try {
      const raw = String(params.content ?? "").trim();
      const first = raw.split("\n")[0] ?? "";
      const title = first.replace(/^\*+\s+/, "").replace(/^-\s+/, "");
      const ref = resolvePageRef({ page: params.page as string | undefined });
      const result = await appendBlock(ref, {
        title,
        style: params.asHeadline === false ? "list" : "headline",
      });
      return {
        content: [
          {
            type: "text",
            text: `Legacy write coerced to structured append at ${result.path}`,
          },
        ],
        details: { ...result, legacy: true },
      };
    } catch (err) {
      return toolError(err);
    }
  },
});

export const logseqSearch = defineTool({
  name: "logseq_search",
  label: "Search Logseq",
  description:
    "Search Org-mode files in the Logseq graph (pages/ and journals/) for matching text.",
  parameters: Type.Object({
    query: Type.String({ description: "Search keyword or phrase" }),
    scope: Type.Optional(
      Type.Union(
        [Type.Literal("pages"), Type.Literal("journals"), Type.Literal("all")],
        { description: "Search scope", default: "all" },
      ),
    ),
    maxResults: Type.Optional(Type.Number({ description: "Max results", default: 20 })),
  }),
  execute: async (_toolCallId, params) => {
    const query = (params.query as string).toLowerCase();
    const scope = (params.scope as string | undefined) ?? "all";
    const maxResults = (params.maxResults as number | undefined) ?? 20;

    const dirs: { name: string; dir: string }[] = [];
    if (scope === "all" || scope === "journals") dirs.push({ name: "journals", dir: journalsDir() });
    if (scope === "all" || scope === "pages") dirs.push({ name: "pages", dir: pagesDir() });

    const results: { file: string; match: string }[] = [];

    for (const { name: scopeName, dir } of dirs) {
      if (!existsSync(dir)) continue;
      const files = (await readdir(dir)).filter((f) => f.endsWith(".org")).slice(0, 200);

      for (const file of files) {
        if (results.length >= maxResults) break;
        let content: string;
        try {
          content = await readFile(join(dir, file), "utf-8");
        } catch {
          continue;
        }

        try {
          const ast = parse(content);
          const matches: string[] = [];

          function search(node: typeof ast): void {
            if (node.rawValue && node.rawValue.toLowerCase().includes(query)) {
              if (node.type === NodeType.Headline && node.title?.cleanValue) {
                matches.push(node.title.cleanValue.slice(0, 120));
              } else if (node.cleanValue && node.cleanValue.trim().length > 5) {
                matches.push(node.cleanValue.trim().slice(0, 120));
              }
            }
            for (const c of node.childrenList ?? []) search(c);
          }
          search(ast);

          if (matches.length > 0) {
            results.push({ file: `${scopeName}/${file}`, match: matches.slice(0, 3).join(" | ") });
          }
        } catch {
          const lines = content.split("\n").filter((l) => l.toLowerCase().includes(query));
          for (const line of lines.slice(0, 3)) {
            if (results.length >= maxResults) break;
            results.push({ file: `${scopeName}/${file}`, match: line.trim().slice(0, 120) });
          }
        }
      }
    }

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No matches found for "${query}".` }],
        details: { query, hits: 0 },
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `## Search: "${query}"\n\n${results.map((r) => `- **${r.file}**: ${r.match}`).join("\n")}`,
        },
      ],
      details: { query, hits: results.length },
    };
  },
});
