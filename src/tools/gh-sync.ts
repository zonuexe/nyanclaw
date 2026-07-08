import { Type } from "typebox";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, readdirSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { logseqGraph } from "../config.ts";

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

function logseqEncode(name: string): string {
  return name.replace(/:/g, "%3A").replace(/\//g, "%2F");
}

function pagePath(name: string): string {
  const graph = logseqGraph();
  const encoded = logseqEncode(name);
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
  const encoded = logseqEncode(name);
  const p = join(graph, "pages", `${encoded}.org`);
  migrateToEncodedFormat(name, encoded, graph);
  const dir = p.substring(0, p.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content, "utf-8");
}

/** Logseq changed its page naming: move old bare-`:` files to `%3A`-encoded names. */
function migrateToEncodedFormat(raw: string, encoded: string, graph: string): void {
  if (raw === encoded) return;
  const oldPath = join(graph, "pages", `${raw}.org`);
  const newPath = join(graph, "pages", `${encoded}.org`);
  if (!existsSync(oldPath)) return;
  if (existsSync(newPath)) {
    try { unlinkSync(oldPath); } catch {}
  } else {
    try { renameSync(oldPath, newPath); } catch {}
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

const ONE_DAY_MS = 86_400_000;

interface NewsSection {
  dateLabel: string;
  lines: string[];
}

/** Parse existing news page into sections keyed by date. */
function parseNewsPage(content: string): Map<string, NewsSection> {
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
function pruneOldSections(sections: Map<string, NewsSection>): void {
  const cutoff = Date.now() - 7 * ONE_DAY_MS;
  for (const [label, _section] of sections) {
    const d = new Date(label);
    if (!isNaN(d.getTime()) && d.getTime() < cutoff) {
      sections.delete(label);
    }
  }
}

/** Render sections back to Org text. */
function renderSections(sections: Map<string, NewsSection>): string {
  const sorted = [...sections.entries()].sort(([a], [b]) => b.localeCompare(a));
  return sorted.map(([_, s]) => s.lines.join("\n")).join("\n").trim() + "\n";
}

/** Build today's news section content for a watched repo. */
function buildTodayNews(repo: string): string[] {
  const [owner, name] = repo.split("/");
  const lines: string[] = [];
  const today = new Date();
  const dateLabel = today.toISOString().slice(0, 10);

  lines.push(`* ${dateLabel}`);

  // My open Issues & PRs in this repo
  const myIssuesRaw = gh(`search issues --repo "${repo}" --author @me --state open --limit 10 --json number,title,state,updatedAt`);
  const myIssues = myIssuesRaw ? JSON.parse(myIssuesRaw) as any[] : [];
  const myPrsRaw = gh(`search prs --repo "${repo}" --author @me --state open --limit 10 --json number,title,state,updatedAt,headRefName`);
  const myPrs = myPrsRaw ? JSON.parse(myPrsRaw) as any[] : [];
  if (myIssues.length > 0 || myPrs.length > 0) {
    lines.push("** My Activity");
    for (const pr of myPrs) {
      const updated = (pr.updatedAt || "").slice(0, 10);
      lines.push(`*** [#${pr.number}] ${pr.title} (PR, ${pr.state}, updated: ${updated})`);
    }
    for (const iss of myIssues) {
      const updated = (iss.updatedAt || "").slice(0, 10);
      lines.push(`*** [#${iss.number}] ${iss.title} (issue, ${iss.state}, updated: ${updated})`);
    }
  }

  // Open PRs
  const prsRaw = gh(`search prs --repo "${repo}" --state open --sort updated --limit 20 --json number,title,state,createdAt,updatedAt,headRefName`);
  const prs = prsRaw ? JSON.parse(prsRaw) as any[] : [];
  if (prs.length > 0) {
    lines.push("** Open PRs");
    for (const pr of prs) {
      const updated = (pr.updatedAt || "").slice(0, 10);
      lines.push(`*** [#${pr.number}] ${pr.title} - ${pr.state}, updated: ${updated}`);
    }
  }

  // Recently merged PRs (last 7 days)
  const mergedRaw = gh(`search prs --repo "${repo}" --state merged --sort updated --limit 20 --json number,title,state,mergedAt,updatedAt`);
  const merged = mergedRaw ? JSON.parse(mergedRaw) as any[] : [];
  const weekAgo = new Date(Date.now() - 7 * ONE_DAY_MS).toISOString();
  const recentMerged = merged.filter((p: any) => p.mergedAt && p.mergedAt >= weekAgo);
  if (recentMerged.length > 0) {
    lines.push("** Recently Merged PRs");
    for (const pr of recentMerged) {
      const mergedAt = (pr.mergedAt || "").slice(0, 10);
      lines.push(`*** [#${pr.number}] ${pr.title} - ${mergedAt}`);
    }
  }

  // Untriaged issues (open, no labels)
  const issuesRaw = gh(`search issues --repo "${repo}" --state open --sort created --limit 20 --json number,title,state,createdAt,labels`);
  const issues = issuesRaw ? JSON.parse(issuesRaw) as any[] : [];
  const untriaged = issues.filter((i: any) => !i.labels?.length);
  if (untriaged.length > 0) {
    lines.push("** Untriaged Issues");
    for (const issue of untriaged) {
      const created = (issue.createdAt || "").slice(0, 10);
      lines.push(`*** [#${issue.number}] ${issue.title} - ${created}`);
    }
  }

  // Recent commits on default branch
  const commitsRaw = gh(`api repos/${repo}/commits?per_page=10 2>/dev/null`, 10_000);
  if (commitsRaw) {
    try {
      const commits = JSON.parse(commitsRaw) as any[];
      if (commits.length > 0) {
        lines.push("** Recent Commits");
        for (const c of commits.slice(0, 5)) {
          const sha = (c.sha || "").slice(0, 7);
          const msg = (c.commit?.message || "").split("\n")[0].slice(0, 80);
          lines.push(`*** ${sha} ${msg}`);
        }
      }
    } catch {}
  }

  return lines;
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
    const today = new Date().toISOString().slice(0, 10);

    for (const target of targets) {
      const newsPage = `GH:${target}/news`;
      const sections = new Map<string, NewsSection>();

      const existing = readPage(newsPage);
      if (existing) {
        const parsed = parseNewsPage(existing);
        for (const [k, v] of parsed) sections.set(k, v);
        pruneOldSections(sections);
      }

      // Fetch untriaged issues for this org/repo
      const issuesRaw = gh(`search issues --repo "${target}" --state open --sort created --limit 30 --json number,title,state,createdAt,labels`);
      const issues = issuesRaw ? JSON.parse(issuesRaw) as any[] : [];
      const untriaged = issues.filter((i: any) => !i.labels?.length);

      if (untriaged.length > 0) {
        const lines: string[] = [`* ${today}`, "** Untriaged Issues"];
        for (const issue of untriaged) {
          const created = (issue.createdAt || "").slice(0, 10);
          lines.push(`*** [#${issue.number}] ${issue.title} - ${created}`);
        }

        if (sections.has(today)) sections.delete(today);
        sections.set(today, { dateLabel: today, lines });
      }

      writePage(newsPage, renderSections(sections));
      results.push(`${target}: ${untriaged.length} untriaged`);
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

        const issuesRaw = gh(`search issues --repo "${target}" --state open --sort created --limit 30 --json number,title,state,createdAt,labels`);
        const issues = issuesRaw ? JSON.parse(issuesRaw) as any[] : [];
        const untriaged = issues.filter((i: any) => !i.labels?.length);
        const today = new Date().toISOString().slice(0, 10);

        if (untriaged.length > 0) {
          const lines: string[] = [`* ${today}`, "** Untriaged Issues"];
          for (const issue of untriaged) {
            lines.push(`*** [#${issue.number}] ${issue.title} - ${(issue.createdAt || "").slice(0, 10)}`);
          }
          if (sections.has(today)) sections.delete(today);
          sections.set(today, { dateLabel: today, lines });
        }

        writePage(newsPage, renderSections(sections));
        results.push(`maintained: ${target} (${untriaged.length} untriaged)`);
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
      const match = file.match(/^GH:(.+)\/news\.(org|md)$/);
      if (!match) continue;
      const content = readFileSync(join(pagesDir, file), "utf-8");
      const sections = parseNewsPage(content);
      for (const [label] of sections) {
        if (label >= cutoff) {
          recentRepos.push(`GH:${match[1]}/news`);
          break;
        }
      }
    }
  }

  // Build dashboard Org content
  const maintContent = readPage("GitHub/maintains");
  const watchContent = readPage("GitHub/watches");
  const today = new Date().toISOString().slice(0, 10);

  let dash = `- Issues\n`;
  if (maintContent) {
    const targets = extractGhLinks(maintContent);
    for (const t of targets) {
      dash += `\t- [[GH:${t}]]\n`;
      if (recentRepos.includes(`GH:${t}/news`)) {
        dash += `\t\t- [[GH:${t}/news]]\n`;
      }
    }
  }

  dash += `- Pull Requests\n\t- (run gh_sync to update)\n`;

  dash += `- Watches\n`;
  if (watchContent) {
    const repos = extractGhLinks(watchContent);
    for (const r of repos) {
      dash += `\t- [[GH:${r}]]\n`;
      if (recentRepos.includes(`GH:${r}/news`)) {
        dash += `\t\t- [[GH:${r}/news]] (updated: ${today})\n`;
      }
    }
  }

  dash += `\n- [[GitHub/watches]]\n- [[GitHub/maintains]]\n`;

  writePage("GitHub", dash);
}
