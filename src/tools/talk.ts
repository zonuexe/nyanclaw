import { Type } from "typebox";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { logseqGraph, slidesDir } from "../config.ts";

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

/** Fields stored in a talk slide YAML. */
interface TalkSlide {
  title: string;
  date: string;
  stem?: string;
  download?: string;
  hashtags?: string[];
  events?: {
    name: string;
    url?: string;
    location?: string;
    place?: string;
    presented_at?: string;
    type?: string;
    talk_duration?: number;
  }[];
  tags?: string[];
}

/** Internal running state for outline drafts (saved alongside the YAML as an .outline.md). */
interface TalkOutline {
  slug: string;
  title: string;
  conference?: string;
  conferenceUrl?: string;
  talkType?: string;
  talkDuration?: number;
  date?: string;
  location?: string;
  hashtags?: string[];
  abstract?: string;
  outline?: string;
  keyPoints?: string[];
  status: "idea" | "cfp-draft" | "cfp-submitted" | "accepted" | "preparing" | "ready";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Read all existing slide YAML files to infer the next date-based prefix. */
async function nextDatePrefix(): Promise<string> {
  try {
    const files = await readdir(slidesDir());
    const today = new Date();
    const prefix = today.toISOString().slice(0, 10).replace(/-/g, "");
    // If a file with today's prefix already exists, append a letter
    let candidate = prefix;
    const existing = new Set(files.filter((f) => f.endsWith(".yaml")));
    for (const suffix of ["", "a", "b", "c", "d"]) {
      const test = `${prefix}${suffix}`;
      if (![...existing].some((f) => f.startsWith(test))) {
        candidate = test;
        break;
      }
    }
    return candidate;
  } catch {
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  }
}

/** Load an existing slide YAML + optional .outline.md. */
async function loadSlide(slug: string): Promise<{ slide?: TalkSlide; outline?: TalkOutline }> {
  const yamlPath = join(slidesDir(), `${slug}.yaml`);
  const outlinePath = join(slidesDir(), `${slug}.outline.md`);

  let slide: TalkSlide | undefined;
  if (existsSync(yamlPath)) {
    const raw = await readFile(yamlPath, "utf-8");
    slide = YAML.parse(raw) as TalkSlide;
  }

  let outline: TalkOutline | undefined;
  if (existsSync(outlinePath)) {
    const raw = await readFile(outlinePath, "utf-8");
    try {
      const parsed = YAML.parse(raw) as TalkOutline;
      if (parsed && parsed.slug) outline = parsed;
    } catch {
      // Not a valid outline format — ignore
    }
  }

  return { slide, outline };
}

/** List all existing talk slugs. */
async function listSlides(): Promise<{ slug: string; slide: TalkSlide }[]> {
  const files = await readdir(slidesDir());
  const yamls = files.filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));
  const result: { slug: string; slide: TalkSlide }[] = [];
  for (const f of yamls) {
    try {
      const raw = await readFile(join(slidesDir(), f), "utf-8");
      const slide = YAML.parse(raw) as TalkSlide;
      if (slide?.title) result.push({ slug: f.replace(/\.yaml$/, ""), slide });
    } catch {
      // skip unparseable
    }
  }
  // Sort by date descending
  result.sort((a, b) => (b.slide.date || "").localeCompare(a.slide.date || ""));
  return result;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const talkCreateOutline = defineTool({
  name: "talk_create_outline",
  label: "Create Talk Outline",
  description:
    "Create a new talk outline. Saves a draft YAML + outline.md in the slides repo and creates a Logseq page for managing tasks.",
  parameters: Type.Object({
    title: Type.String({ description: "Talk title" }),
    conference: Type.Optional(Type.String({ description: "Conference name" })),
    conferenceUrl: Type.Optional(Type.String({ description: "Conference URL" })),
    talkType: Type.Optional(
      Type.String({
        description:
          "Talk type: キーノート / セッション / ライトニングトーク / パネル / Language Update / チュートリアル / その他",
      }),
    ),
    talkDuration: Type.Optional(Type.Number({ description: "Talk duration in minutes" })),
    date: Type.Optional(
      Type.String({
        description: "Talk date in YYYY-MM-DD format. Estimated is fine.",
      }),
    ),
    location: Type.Optional(Type.String({ description: "Conference location (city)" })),
    hashtags: Type.Optional(
      Type.Array(Type.String(), { description: "Conference hashtags" }),
    ),
    abstract: Type.Optional(Type.String({ description: "Talk abstract / summary" })),
    keyPoints: Type.Optional(
      Type.Array(Type.String(), { description: "Key points to cover in the talk" }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const title = params.title as string;
    const dateStr = params.date as string | undefined;
    const datePrefix = dateStr
      ? dateStr.replace(/-/g, "")
      : await nextDatePrefix();
    const slug = `${datePrefix}_${slugify(title)}`;

    const outline: TalkOutline = {
      slug,
      title,
      conference: params.conference as string | undefined,
      conferenceUrl: params.conferenceUrl as string | undefined,
      talkType: params.talkType as string | undefined,
      talkDuration: params.talkDuration as number | undefined,
      date: dateStr,
      location: params.location as string | undefined,
      hashtags: params.hashtags as string[] | undefined,
      abstract: params.abstract as string | undefined,
      keyPoints: params.keyPoints as string[] | undefined,
      status: "idea",
    };

    // Write outline.md (YAML frontmatter + markdown body)
    const outlinePath = join(slidesDir(), `${slug}.outline.md`);
    const outlineYaml = YAML.stringify(outline);
    const outlineBody = outline.abstract
      ? `\n## Abstract\n\n${outline.abstract}\n`
      : "\n## Notes\n\n";
    await writeFile(outlinePath, `---\n${outlineYaml}---\n${outlineBody}`, "utf-8");

    // If the user provided enough info, also write a skeleton slide YAML
    const slideYamlPath = join(slidesDir(), `${slug}.yaml`);
    if (!existsSync(slideYamlPath)) {
      const slide: TalkSlide = {
        title,
        date: dateStr ?? "",
        hashtags: params.hashtags as string[] | undefined,
        events: [
          {
            name: (params.conference as string) ?? "",
            url: params.conferenceUrl as string | undefined,
            location: params.location as string | undefined,
            presented_at: dateStr ?? "",
            type: params.talkType as string | undefined,
            talk_duration: params.talkDuration as number | undefined,
          },
        ],
      };
      await writeFile(
        slideYamlPath,
        YAML.stringify(slide, { lineWidth: 120 }),
        "utf-8",
      );
    }

    return {
      content: [
        {
          type: "text",
          text:
            `## Talk Outline Created\n\n- **Slug:** \`${slug}\`\n- **Title:** ${title}\n` +
            (params.conference ? `- **Conference:** ${params.conference}\n` : "") +
            `- **Status:** idea\n` +
            `- **Outline:** \`${outlinePath}\`\n` +
            `- **Slide YAML:** \`${slideYamlPath}\`\n\n` +
            `Use \`talk_update_outline\` to revise, \`talk_create_tasks\` to generate prep tasks.`,
        },
      ],
      details: { slug, status: "idea" },
    };
  },
});

export const talkUpdateOutline = defineTool({
  name: "talk_update_outline",
  label: "Update Talk Outline",
  description:
    "Update an existing talk outline. Fields not provided are left unchanged.",
  parameters: Type.Object({
    slug: Type.String({ description: "Talk slug (e.g., 20260707_some-talk)" }),
    title: Type.Optional(Type.String({ description: "New title" })),
    abstract: Type.Optional(Type.String({ description: "Updated abstract" })),
    keyPoints: Type.Optional(
      Type.Array(Type.String(), { description: "New key points" }),
    ),
    outline: Type.Optional(
      Type.String({ description: "Talk structure outline (slide-by-slide)" }),
    ),
    status: Type.Optional(
      Type.Union(
        [
          Type.Literal("idea"),
          Type.Literal("cfp-draft"),
          Type.Literal("cfp-submitted"),
          Type.Literal("accepted"),
          Type.Literal("preparing"),
          Type.Literal("ready"),
        ],
        { description: "Preparation status" },
      ),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const slug = params.slug as string;
    const outlinePath = join(slidesDir(), `${slug}.outline.md`);
    const slideYamlPath = join(slidesDir(), `${slug}.yaml`);

    let outline: TalkOutline;
    let existingBody = "";

    if (existsSync(outlinePath)) {
      const raw = await readFile(outlinePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (match) {
        outline = YAML.parse(match[1]) as TalkOutline;
        existingBody = match[2];
      } else {
        return {
          content: [{ type: "text", text: `Invalid outline format for "${slug}".` }],
          details: { slug, error: "parse error" },
        };
      }
    } else {
      return {
        content: [
          {
            type: "text",
            text: `No outline found for "${slug}". Create one with \`talk_create_outline\` first.`,
          },
        ],
        details: { slug, error: "not found" },
      };
    }

    // Apply updates
    if (params.title) outline.title = params.title as string;
    if (params.abstract) outline.abstract = params.abstract as string;
    if (params.keyPoints) outline.keyPoints = params.keyPoints as string[];
    if (params.outline) outline.outline = params.outline as string;
    if (params.status) outline.status = params.status as TalkOutline["status"];

    const body = existingBody || (outline.abstract
      ? `\n## Abstract\n\n${outline.abstract}\n`
      : "\n## Notes\n\n");
    await writeFile(
      outlinePath,
      `---\n${YAML.stringify(outline)}---\n${body}`,
      "utf-8",
    );

    // Also update slide YAML title if changed
    if (params.title && existsSync(slideYamlPath)) {
      const raw = await readFile(slideYamlPath, "utf-8");
      const slide = YAML.parse(raw) as TalkSlide;
      slide.title = params.title as string;
      await writeFile(slideYamlPath, YAML.stringify(slide, { lineWidth: 120 }), "utf-8");
    }

    const changes: string[] = [];
    if (params.title) changes.push("title");
    if (params.abstract) changes.push("abstract");
    if (params.keyPoints) changes.push("keyPoints");
    if (params.outline) changes.push("outline");
    if (params.status) changes.push(`status → ${params.status}`);

    return {
      content: [
        {
          type: "text",
          text:
            `## Outline Updated\n\n- **Slug:** \`${slug}\`\n` +
            `- **Updated:** ${changes.join(", ") || "none"}\n` +
            `- **Status:** ${outline.status}\n`,
        },
      ],
      details: { slug, changes, status: outline.status },
    };
  },
});

export const talkListOutlines = defineTool({
  name: "talk_list_outlines",
  label: "List Talk Outlines",
  description:
    "List existing talk outlines. Can filter by status or limit results.",
  parameters: Type.Object({
    status: Type.Optional(
      Type.Union(
        [
          Type.Literal("idea"),
          Type.Literal("cfp-draft"),
          Type.Literal("cfp-submitted"),
          Type.Literal("accepted"),
          Type.Literal("preparing"),
          Type.Literal("ready"),
        ],
        { description: "Filter by preparation status" },
      ),
    ),
    limit: Type.Optional(Type.Number({ description: "Max results", default: 20 })),
  }),
  execute: async (_toolCallId, params) => {
    const statusFilter = params.status as string | undefined;
    const limit = (params.limit as number) ?? 20;

    const slides = await listSlides();

    // Also load .outline.md for status info
    const result: { slug: string; title: string; status: string; date: string; conference?: string }[] = [];

    for (const { slug, slide } of slides) {
      if (result.length >= limit) break;
      const outlinePath = join(slidesDir(), `${slug}.outline.md`);
      let status = "finished";

      if (existsSync(outlinePath)) {
        const raw = await readFile(outlinePath, "utf-8");
        const match = raw.match(/^---\n([\s\S]*?)\n---/);
        if (match) {
          const parsed = YAML.parse(match[1]) as TalkOutline;
          status = parsed.status || "preparing";
        }
      }

      if (statusFilter && status !== statusFilter) continue;

      result.push({
        slug,
        title: slide.title,
        status,
        date: slide.date || "",
        conference: slide.events?.[0]?.name,
      });
    }

    // Also list outlines that don't have slide YAML yet (pure ideas)
    try {
      const files = await readdir(slidesDir());
      const outlineFiles = files.filter((f) => f.endsWith(".outline.md"));
      for (const f of outlineFiles) {
        if (result.length >= limit) break;
        const raw = await readFile(join(slidesDir(), f), "utf-8");
        const match = raw.match(/^---\n([\s\S]*?)\n---/);
        if (match) {
          const parsed = YAML.parse(match[1]) as TalkOutline;
          if (!result.some((r) => r.slug === parsed.slug)) {
            if (statusFilter && parsed.status !== statusFilter) continue;
            result.push({
              slug: parsed.slug,
              title: parsed.title,
              status: parsed.status,
              date: parsed.date ?? "",
              conference: parsed.conference,
            });
          }
        }
      }
    } catch {
      // skip
    }

    const formatted = result
      .map(
        (r) =>
          `- **${r.title}** (\`${r.slug}\`) [${r.status}]` +
          (r.conference ? ` @ ${r.conference}` : "") +
          (r.date ? ` — ${r.date}` : ""),
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `## Talk Outlines${statusFilter ? ` (${statusFilter})` : ""}\n\n${formatted || "No talks found."}`,
        },
      ],
      details: { count: result.length, statusFilter },
    };
  },
});

export const talkCreateTasks = defineTool({
  name: "talk_create_tasks",
  label: "Create Talk Prep Tasks",
  description:
    "Generate preparation tasks for a talk and write them to the Logseq journal.",
  parameters: Type.Object({
    slug: Type.String({ description: "Talk slug" }),
    cfpDeadline: Type.Optional(
      Type.String({ description: "CfP deadline in YYYY-MM-DD" }),
    ),
    talkDate: Type.Optional(
      Type.String({ description: "Talk date in YYYY-MM-DD (if not in outline)" }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const slug = params.slug as string;
    const outlinePath = join(slidesDir(), `${slug}.outline.md`);

    let outline: TalkOutline | null = null;
    if (existsSync(outlinePath)) {
      const raw = await readFile(outlinePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---/);
      if (match) outline = YAML.parse(match[1]) as TalkOutline;
    }

    const title = outline?.title ?? slug;
    const conference = outline?.conference ?? "TBD";
    const talkDate = (params.talkDate as string | undefined) ?? outline?.date ?? "";

    const now = new Date();
    const tasks: { task: string; deadline?: string }[] = [];

    const cfpDeadlineParam = params.cfpDeadline as string | undefined;
    if (cfpDeadlineParam || outline?.status === "idea" || outline?.status === "cfp-draft") {
      const cfpDeadline = cfpDeadlineParam ?? "";
      tasks.push({
        task: `Submit CfP for "${title}" @ ${conference}`,
        deadline: cfpDeadline,
      });
      tasks.push({ task: `Write abstract for "${title}"` });
    }

    if (talkDate) {
      // Calculate deadlines relative to talk date
      const d = new Date(talkDate);
      const slideDue = new Date(d);
      slideDue.setDate(slideDue.getDate() - 14);
      const rehearsalDue = new Date(d);
      rehearsalDue.setDate(rehearsalDue.getDate() - 3);

      tasks.push({
        task: `Complete slides for "${title}"`,
        deadline: slideDue.toISOString().slice(0, 10),
      });
      tasks.push({
        task: `Rehearsal for "${title}" @ ${conference}`,
        deadline: rehearsalDue.toISOString().slice(0, 10),
      });
      tasks.push({
        task: `Present "${title}" @ ${conference}`,
        deadline: talkDate,
      });
    } else {
      tasks.push({ task: `Create slides for "${title}"` });
      tasks.push({ task: `Rehearsal for "${title}"` });
    }

    // Write to today's Logseq journal as Org-mode entries
    const todayJournal = join(
      logseqGraph(),
      "journals",
      `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}_${String(now.getDate()).padStart(2, "0")}.org`,
    );

    let journalEntry = `\n* TODO Prepare: ${title}\n`;
    for (const t of tasks) {
      if (t.deadline) {
        journalEntry += `  - TODO ${t.task}\n  DEADLINE: <${t.deadline}>\n`;
      } else {
        journalEntry += `  - TODO ${t.task}\n`;
      }
    }

    try {
      await writeFile(todayJournal, journalEntry, { flag: "a" });
    } catch {
      // journal directory may not exist
    }

    const taskList = tasks
      .map((t) => `- [ ] ${t.task}${t.deadline ? ` (by ${t.deadline})` : ""}`)
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text:
            `## Prep Tasks for "${title}"\n\n` +
            `**Conference:** ${conference}\n` +
            `**Slug:** \`${slug}\`\n\n` +
            `${taskList}\n\n` +
            `*Tasks appended to today's Logseq journal.*`,
        },
      ],
      details: { slug, tasks: tasks.length },
    };
  },
});
