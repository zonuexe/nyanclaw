import { Type } from "typebox";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { logseqGraph } from "../config.ts";
import {
  encodePageName,
  serializeBlock,
  type BlockSpec,
} from "../org/index.ts";
import { writeOrgFileAtomic } from "../org/fs.ts";
import {
  ONE_DAY_MS,
  newsRefFromFilename,
  parseNewsPage,
  pruneOldSections,
  renderSections,
  safeTitle,
  sectionHasRecentLabel,
  type NewsSection,
} from "./gh-news.ts";

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

// ---------------------------------------------------------------------------
// Logseq page helpers (filesystem-based, supports .org and .md)
// ---------------------------------------------------------------------------

function pagePath(name: string): string {
  const graph = logseqGraph();
  const encoded = encodePageName(name);
  const candidates = [
    join(graph, "pages", `${name}.org`),
    join(graph, "pages", `${name}.md`),
    join(graph, "pages", `${encoded}.org`),
    join(graph, "pages", `${encoded}.md`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return join(graph, "pages", `${encoded}.org`);
}

function readPage(name: string): string | null {
  const p = pagePath(name);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8");
}

function writePage(name: string, content: string): void {
  const graph = logseqGraph();
  const encoded = encodePageName(name);
  const p = join(graph, "pages", `${encoded}.org`);
  migrateToEncodedFormat(name, encoded, graph);
  const body = content.endsWith("\n") ? content : content + "\n";
  writeOrgFileAtomic(p, body);
}

/** Logseq changed its page naming: move old bare-`:` files to `%3A`-encoded names. */
function migrateToEncodedFormat(raw: string, encoded: string, graph: string): void {
  if (raw === encoded) return;
  const oldPath = join(graph, "pages", `${raw}.org`);
  const newPath = join(graph, "pages", `${encoded}.org`);
  if (!existsSync(oldPath)) return;
  if (existsSync(newPath)) {
    try {
      unlinkSync(oldPath);
    } catch {
      /* ignore */
    }
  } else {
    try {
      renameSync(oldPath, newPath);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Extract [[GH:owner/repo]] references from a Logseq page
// ---------------------------------------------------------------------------

function extractGhLinks(content: string): string[] {
  const refs: string[] = [];
  const re = /\[\[GH:([^\]]+)\]\]/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    const ref = match[1].trim();
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

function extractLinks(content: string): string[] {
  const refs: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    refs.push(match[1].trim());
  }
  return refs;
}

// ---------------------------------------------------------------------------
// gh CLI wrappers
// ---------------------------------------------------------------------------

function gh(args: string, timeoutMs = 15_000): string {
  try {
    return execSync(`gh ${args} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 64_384,
    }).trim();
  } catch {}
  return "";
}

function isGhAvailable(): boolean {
  try {
    execSync("gh --version", { encoding: "utf-8", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// News page management (Org format, daily sections, 7-day retention)
// ---------------------------------------------------------------------------

/** Build today's news section via BlockSpec serialize (history sections stay opaque). */
function buildTodayNews(repo: string): string[] {
  const dateLabel = new Date().toISOString().slice(0, 10);
  const children: BlockSpec[] = [];

  const myIssuesRaw = gh(
    `search issues --repo "${repo}" --author @me --state open --limit 10 --json number,title,state,updatedAt`,
  );
  const myIssues = myIssuesRaw ? (JSON.parse(myIssuesRaw) as any[]) : [];
  const myPrsRaw = gh(
    `search prs --repo "${repo}" --author @me --state open --limit 10 --json number,title,state,updatedAt,headRefName`,
  );
  const myPrs = myPrsRaw ? (JSON.parse(myPrsRaw) as any[]) : [];
  if (myIssues.length > 0 || myPrs.length > 0) {
    children.push({
      title: "My Activity",
      children: [
        ...myPrs.map((pr) => ({
          title: safeTitle(
            `[#${pr.number}] ${pr.title} (PR, ${pr.state}, updated: ${(pr.updatedAt || "").slice(0, 10)})`,
          ),
        })),
        ...myIssues.map((iss) => ({
          title: safeTitle(
            `[#${iss.number}] ${iss.title} (issue, ${iss.state}, updated: ${(iss.updatedAt || "").slice(0, 10)})`,
          ),
        })),
      ],
    });
  }

  const prsRaw = gh(
    `search prs --repo "${repo}" --state open --sort updated --limit 20 --json number,title,state,createdAt,updatedAt,headRefName`,
  );
  const prs = prsRaw ? (JSON.parse(prsRaw) as any[]) : [];
  if (prs.length > 0) {
    children.push({
      title: "Open PRs",
      children: prs.map((pr) => ({
        title: safeTitle(
          `[#${pr.number}] ${pr.title} - ${pr.state}, updated: ${(pr.updatedAt || "").slice(0, 10)}`,
        ),
      })),
    });
  }

  const mergedRaw = gh(
    `search prs --repo "${repo}" --state merged --sort updated --limit 20 --json number,title,state,mergedAt,updatedAt`,
  );
  const merged = mergedRaw ? (JSON.parse(mergedRaw) as any[]) : [];
  const weekAgo = new Date(Date.now() - 7 * ONE_DAY_MS).toISOString();
  const recentMerged = merged.filter((p: any) => p.mergedAt && p.mergedAt >= weekAgo);
  if (recentMerged.length > 0) {
    children.push({
      title: "Recently Merged PRs",
      children: recentMerged.map((pr) => ({
        title: safeTitle(
          `[#${pr.number}] ${pr.title} - ${(pr.mergedAt || "").slice(0, 10)}`,
        ),
      })),
    });
  }

  const issuesRaw = gh(
    `search issues --repo "${repo}" --state open --sort created --limit 20 --json number,title,state,createdAt,labels`,
  );
  const issues = issuesRaw ? (JSON.parse(issuesRaw) as any[]) : [];
  const untriaged = issues.filter((i: any) => !i.labels?.length);
  if (untriaged.length > 0) {
    children.push({
      title: "Untriaged Issues",
      children: untriaged.map((issue) => ({
        title: safeTitle(
          `[#${issue.number}] ${issue.title} - ${(issue.createdAt || "").slice(0, 10)}`,
        ),
      })),
    });
  }

  const commitsRaw = gh(`api repos/${repo}/commits?per_page=10 2>/dev/null`, 10_000);
  if (commitsRaw) {
    try {
      const commits = JSON.parse(commitsRaw) as any[];
      if (commits.length > 0) {
        children.push({
          title: "Recent Commits",
          children: commits.slice(0, 5).map((c) => {
            const sha = (c.sha || "").slice(0, 7);
            const msg = (c.commit?.message || "").split("\n")[0].slice(0, 80);
            return { title: safeTitle(`${sha} ${msg}`) };
          }),
        });
      }
    } catch {
      /* ignore parse errors */
    }
  }

  if (children.length === 0) return [];
  return serializeBlock({ title: dateLabel, children }).split("\n");
}

/** Untriaged issues section for a maintained repo (structured serialize). */
function buildUntriagedSection(target: string): { lines: string[]; count: number; dateLabel: string } {
  const dateLabel = new Date().toISOString().slice(0, 10);
  const issuesRaw = gh(
    `search issues --repo "${target}" --state open --sort created --limit 30 --json number,title,state,createdAt,labels`,
  );
  const issues = issuesRaw ? (JSON.parse(issuesRaw) as any[]) : [];
  const untriaged = issues.filter((i: any) => !i.labels?.length);
  if (untriaged.length === 0) {
    return { lines: [], count: 0, dateLabel };
  }
  const text = serializeBlock({
    title: dateLabel,
    children: [
      {
        title: "Untriaged Issues",
        children: untriaged.map((issue) => ({
          title: safeTitle(
            `[#${issue.number}] ${issue.title} - ${(issue.createdAt || "").slice(0, 10)}`,
          ),
        })),
      },
    ],
  });
  return { lines: text.split("\n"), count: untriaged.length, dateLabel };
}

// ---------------------------------------------------------------------------
// Tool: gh_sync_watched
// ---------------------------------------------------------------------------

export const ghSyncWatched = defineTool({
  name: "gh_sync_watched",
  label: "Sync Watched Repos",
  description:
    "Fetch news for all watched repos listed in [[GitHub/watches]] and write daily Org-mode news pages ([[GH:owner/repo/news]]). Keeps 7 days, squashes older entries.",
  parameters: Type.Object({}),
  execute: async () => {
    if (!isGhAvailable()) {
      return { content: [{ type: "text", text: "gh not available." }], details: {} };
    }

    const watchContent = readPage("GitHub/watches");
    if (!watchContent) {
      return { content: [{ type: "text", text: "[[GitHub/watches]] not found." }], details: {} };
    }

    const repos = extractGhLinks(watchContent);
    if (repos.length === 0) {
      return { content: [{ type: "text", text: "No watched repos found." }], details: {} };
    }

    const updated: string[] = [];

    for (const repo of repos) {
      const newsPage = `GH:${repo}/news`;

      // Read existing news
      const existing = readPage(newsPage);
      const sections = existing ? parseNewsPage(existing) : new Map();

      // Prune old sections (older than 7 days)
      pruneOldSections(sections);

      // Build today's section
      const todayLines = buildTodayNews(repo);
      if (todayLines.length > 0) {
        const todayLabel = todayLines[0].slice(2).trim();
        // Replace existing section for today if it exists, otherwise add
        if (sections.has(todayLabel)) {
          sections.delete(todayLabel);
        }
        const section: NewsSection = { dateLabel: todayLabel, lines: todayLines };
        sections.set(todayLabel, section);
      }

      writePage(newsPage, renderSections(sections));
      updated.push(repo);
    }

    // Update [[GitHub]] dashboard
    const dashContent = readPage("GitHub");
    if (dashContent) {
      updateDashboard(dashContent, repos);
    }

    return {
      content: [{
        type: "text",
        text: `## Watched repos synced\n\n${updated.map((r) => `- [[GH:${r}/news]]`).join("\n")}`,
      }],
      details: { repos: updated },
    };
  },
});

// ---------------------------------------------------------------------------
// Tool: gh_sync_maintained
// ---------------------------------------------------------------------------

export const ghSyncMaintained = defineTool({
  name: "gh_sync_maintained",
  label: "Sync Maintained Repos",
  description:
    "Fetch untriaged issues for repos listed under [[GitHub/maintains]] and write to [[GH:owner/repo/news]].",
  parameters: Type.Object({}),
  execute: async () => {
    if (!isGhAvailable()) {
      return { content: [{ type: "text", text: "gh not available." }], details: {} };
    }

    const content = readPage("GitHub/maintains");
    if (!content) {
      return { content: [{ type: "text", text: "[[GitHub/maintains]] not found." }], details: {} };
    }

    const targets = extractGhLinks(content);
    if (targets.length === 0) {
      return { content: [{ type: "text", text: "No maintained repos found." }], details: {} };
    }

    const results: string[] = [];

    for (const target of targets) {
      const newsPage = `GH:${target}/news`;
      const sections = new Map<string, NewsSection>();

      const existing = readPage(newsPage);
      if (existing) {
        const parsed = parseNewsPage(existing);
        for (const [k, v] of parsed) sections.set(k, v);
        pruneOldSections(sections);
      }

      const { lines, count, dateLabel } = buildUntriagedSection(target);
      if (lines.length > 0) {
        if (sections.has(dateLabel)) sections.delete(dateLabel);
        sections.set(dateLabel, { dateLabel, lines });
      }

      writePage(newsPage, renderSections(sections));
      results.push(`${target}: ${count} untriaged`);
    }

    return {
      content: [{
        type: "text",
        text: `## Maintained repos synced\n\n${results.join("\n")}`,
      }],
      details: { results },
    };
  },
});

// ---------------------------------------------------------------------------
// Tool: gh_sync_all (runs watched + maintained)
// ---------------------------------------------------------------------------

export const ghSyncAll = defineTool({
  name: "gh_sync_all",
  label: "Sync All GitHub",
  description:
    "Run all GitHub sync tasks: watched repos news + maintained repos issues. Updates [[GH:owner/repo/news]] pages and refreshes the [[GitHub]] dashboard.",
  parameters: Type.Object({}),
  execute: async () => {
    if (!isGhAvailable()) {
      return { content: [{ type: "text", text: "gh not available." }], details: {} };
    }

    const results: string[] = [];

    // 1. Watched repos
    const watchContent = readPage("GitHub/watches");
    if (watchContent) {
      const repos = extractGhLinks(watchContent);
      for (const repo of repos) {
        const newsPage = `GH:${repo}/news`;
        const existing = readPage(newsPage);
        const sections = existing ? parseNewsPage(existing) : new Map();
        pruneOldSections(sections);
        const todayLines = buildTodayNews(repo);
        if (todayLines.length > 0) {
          const label = todayLines[0].slice(2).trim();
          if (sections.has(label)) sections.delete(label);
          sections.set(label, { dateLabel: label, lines: todayLines });
        }
        writePage(newsPage, renderSections(sections));
        results.push(`watched: ${repo}`);
      }
    }

    // 2. Maintained repos
    const maintContent = readPage("GitHub/maintains");
    if (maintContent) {
      const targets = extractGhLinks(maintContent);
      for (const target of targets) {
        const newsPage = `GH:${target}/news`;
        const existing = readPage(newsPage);
        const sections = existing ? parseNewsPage(existing) : new Map();
        pruneOldSections(sections);

        const { lines, count, dateLabel } = buildUntriagedSection(target);
        if (lines.length > 0) {
          if (sections.has(dateLabel)) sections.delete(dateLabel);
          sections.set(dateLabel, { dateLabel, lines });
        }

        writePage(newsPage, renderSections(sections));
        results.push(`maintained: ${target} (${count} untriaged)`);
      }
    }

    // 3. Update dashboard
    const dashContent = readPage("GitHub");
    if (dashContent) updateDashboard(dashContent);

    return {
      content: [{
        type: "text",
        text: `## GitHub Sync Complete\n\n${results.join("\n")}`,
      }],
      details: { results },
    };
  },
});

// ---------------------------------------------------------------------------
// Dashboard update
// ---------------------------------------------------------------------------

function updateDashboard(_content: string, _repos?: string[]): void {
  const cutoff = new Date(Date.now() - 7 * ONE_DAY_MS).toISOString().slice(0, 10);
  const pagesDir = join(logseqGraph(), "pages");
  const recentRepos: string[] = [];

  if (existsSync(pagesDir)) {
    for (const file of readdirSync(pagesDir)) {
      const newsRef = newsRefFromFilename(file);
      if (!newsRef) continue;
      try {
        const content = readFileSync(join(pagesDir, file), "utf-8");
        const sections = parseNewsPage(content);
        if (sectionHasRecentLabel(sections, cutoff)) {
          recentRepos.push(newsRef);
        }
      } catch {
        /* skip unreadable */
      }
    }
  }

  const maintContent = readPage("GitHub/maintains");
  const watchContent = readPage("GitHub/watches");
  const today = new Date().toISOString().slice(0, 10);

  const children: BlockSpec[] = [];

  const issueKids: BlockSpec[] = [];
  if (maintContent) {
    for (const t of extractGhLinks(maintContent)) {
      const kid: BlockSpec = {
        title: `[[GH:${t}]]`,
        children: recentRepos.includes(`GH:${t}/news`)
          ? [{ title: `[[GH:${t}/news]]` }]
          : undefined,
      };
      issueKids.push(kid);
    }
  }
  children.push({ title: "Issues", children: issueKids.length ? issueKids : undefined });

  children.push({
    title: "Pull Requests",
    children: [{ title: "(run gh_sync to update)" }],
  });

  const watchKids: BlockSpec[] = [];
  if (watchContent) {
    for (const r of extractGhLinks(watchContent)) {
      watchKids.push({
        title: `[[GH:${r}]]`,
        children: recentRepos.includes(`GH:${r}/news`)
          ? [{ title: `[[GH:${r}/news]] (updated: ${today})` }]
          : undefined,
      });
    }
  }
  children.push({ title: "Watches", children: watchKids.length ? watchKids : undefined });
  children.push({ title: "[[GitHub/watches]]" });
  children.push({ title: "[[GitHub/maintains]]" });

  const body = children.map((b) => serializeBlock(b)).join("\n");
  writePage("GitHub", body);
}
