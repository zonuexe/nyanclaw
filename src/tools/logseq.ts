import { Type } from "typebox";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const LOGSEQ_GRAPH = process.env.LOGSEQ_GRAPH || "/Users/megurine/Dropbox/org";

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

function todayJournalPath(): string {
  return join(LOGSEQ_GRAPH, "journals", `${journalDate(new Date())}.org`);
}

export const logseqReadJournal = defineTool({
  name: "logseq_read_journal",
  label: "Read Logseq Journal",
  description: "Read today's Logseq journal page content.",
  parameters: Type.Object({
    date: Type.Optional(
      Type.String({ description: "Date in YYYY-MM-DD format. Defaults to today." }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const dateStr = params.date as string | undefined;
    let journalPath: string;
    if (dateStr) {
      const d = new Date(dateStr);
      journalPath = join(LOGSEQ_GRAPH, "journals", `${journalDate(d)}.org`);
    } else {
      journalPath = todayJournalPath();
    }

    try {
      const content = await readFile(journalPath, "utf-8");
      return {
        content: [{ type: "text", text: content }],
        details: { path: journalPath },
      };
    } catch {
      return {
        content: [{ type: "text", text: `Journal not found: ${journalPath}` }],
        details: { path: journalPath, exists: false },
      };
    }
  },
});

export const logseqWriteBlock = defineTool({
  name: "logseq_write_block",
  label: "Write Logseq Block",
  description: "Append a block to a Logseq page (journal by default). Uses Org-mode format.",
  parameters: Type.Object({
    content: Type.String({ description: "Block content (Org-mode syntax)" }),
    page: Type.Optional(
      Type.String({ description: "Page name (without .org). Defaults to today's journal." }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const content = params.content as string;
    const page = (params.page as string | undefined) ?? journalDate(new Date());
    const filePath = join(LOGSEQ_GRAPH, "pages", `${page}.org`);

    await mkdir(dirname(filePath), { recursive: true });

    const lines = content.split("\n").map((l: string) => `- ${l}`);
    const block = `\n${lines.join("\n")}\n`;

    if (!existsSync(filePath)) {
      const header = `#+TITLE: ${page}\n`;
      await writeFile(filePath, header + block, "utf-8");
    } else {
      await appendFile(filePath, block, "utf-8");
    }

    return {
      content: [{ type: "text", text: `Appended to ${page}.org` }],
      details: { path: filePath, page },
    };
  },
});

export const logseqSearch = defineTool({
  name: "logseq_search",
  label: "Search Logseq",
  description: "Search Logseq pages by keyword. Searches both pages/ and journals/.",
  parameters: Type.Object({
    query: Type.String({ description: "Search keyword" }),
    maxResults: Type.Optional(Type.Number({ description: "Max results", default: 10 })),
  }),
  execute: async (_toolCallId, params) => {
    const query = params.query as string;
    const maxResults = (params.maxResults as number | undefined) ?? 10;
    const result = `[stub] logseq_search(query="${query}", max=${maxResults})`;
    return {
      content: [{ type: "text", text: result }],
      details: { query, maxResults },
    };
  },
});
