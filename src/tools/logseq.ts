import { Type } from "typebox";
import { parse, NodeType } from "org-mode-ast";
import { readFile, writeFile, appendFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const LOGSEQ_GRAPH = process.env.LOGSEQ_GRAPH || "/Users/megurine/Dropbox/org";
const JOURNALS_DIR = join(LOGSEQ_GRAPH, "journals");
const PAGES_DIR = join(LOGSEQ_GRAPH, "pages");

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
      ? join(JOURNALS_DIR, `${journalDate(new Date(dateStr))}.org`)
      : join(JOURNALS_DIR, `${journalDate(new Date())}.org`);

    try {
      const content = await readFile(journalPath, "utf-8");
      const analysis = analyzeOrg(content);
      const dateLabel = dateStr ?? "today";

      let result = `## Journal: ${dateLabel}\n\n`;

      const todos = analysis.headlines.filter((h) => h.todoKeyword === "TODO");
      const dones = analysis.headlines.filter((h) => h.todoKeyword === "DONE");
      const others = analysis.headlines.filter(
        (h) => h.todoKeyword !== "TODO" && h.todoKeyword !== "DONE",
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

export const logseqWriteBlock = defineTool({
  name: "logseq_write_block",
  label: "Write Logseq Block",
  description:
    "Append an Org-mode block (headline or list item) to a Logseq page or journal entry.",
  parameters: Type.Object({
    content: Type.String({ description: "Block content in Org-mode syntax" }),
    page: Type.Optional(
      Type.String({
        description:
          "Target page name (without extension). Defaults to today's journal date.",
      }),
    ),
    asHeadline: Type.Optional(
      Type.Boolean({
        description:
          "If true, format as a headline (* ). If false, format as a list item (- ).",
        default: false,
      }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const rawContent = params.content as string;
    const page = (params.page as string | undefined) ?? journalDate(new Date());
    const asHeadline = (params.asHeadline as boolean | undefined) ?? false;
    const fileName = `${page}.org`;

    const isJournal = /^\d{4}_\d{2}_\d{2}$/.test(page);
    const filePath = isJournal
      ? join(JOURNALS_DIR, fileName)
      : join(PAGES_DIR, fileName);

    await mkdir(dirname(filePath), { recursive: true });

    const lines = rawContent.split("\n");
    const prefix = asHeadline ? "* " : "- ";
    const block = "\n" + lines.map((l) => `${prefix}${l}`).join("\n") + "\n";

    if (!existsSync(filePath)) {
      await writeFile(filePath, `#+TITLE: ${page}\n${block}`, "utf-8");
    } else {
      await appendFile(filePath, block, "utf-8");
    }

    return {
      content: [{ type: "text", text: `Appended to ${fileName}` }],
      details: { path: filePath, page, isJournal, asHeadline },
    };
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
    if (scope === "all" || scope === "journals") dirs.push({ name: "journals", dir: JOURNALS_DIR });
    if (scope === "all" || scope === "pages") dirs.push({ name: "pages", dir: PAGES_DIR });

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
