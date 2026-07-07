import { Type } from "typebox";
import { execSync } from "node:child_process";

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

function gh(args: string, timeoutMs = 10_000): string {
  try {
    return execSync(`gh ${args} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 16_384,
    }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`gh CLI error: ${msg}`);
  }
}

function isGhAvailable(): boolean {
  try {
    execSync("gh --version", { encoding: "utf-8", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

interface GhIssue {
  number: number;
  title: string;
  state: string;
  repository?: { nameWithOwner: string };
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  labels?: { name: string }[];
}

interface GhPr {
  number: number;
  title: string;
  state: string;
  headRefName?: string;
  repository?: { nameWithOwner: string };
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}

const JSON_FIELDS = "number,title,state,createdAt,updatedAt,url";
const ISSUE_JSON = `${JSON_FIELDS},labels`;
const PR_JSON = `${JSON_FIELDS},headRefName`;

function formatIssues(items: GhIssue[]): string {
  if (items.length === 0) return "No issues found.";
  return items
    .map((i) => {
      const repo = i.repository?.nameWithOwner ? ` (${i.repository.nameWithOwner})` : "";
      const labels = i.labels?.length
        ? " " + i.labels.map((l) => `\`${l.name}\``).join(" ")
        : "";
      return `- [#${i.number}]${repo} **${i.title}** [${i.state}]${labels}`;
    })
    .join("\n");
}

function formatPrs(items: GhPr[]): string {
  if (items.length === 0) return "No pull requests found.";
  return items
    .map((p) => {
      const repo = p.repository?.nameWithOwner ? ` (${p.repository.nameWithOwner})` : "";
      const branch = p.headRefName ? ` (\`${p.headRefName}\`)` : "";
      return `- [#${p.number}]${repo} **${p.title}** [${p.state}]${branch}`;
    })
    .join("\n");
}

export const ghListIssues = defineTool({
  name: "gh_list_issues",
  label: "List GitHub Issues",
  description: "List your GitHub Issues. Can filter by assignment, authorship, state, and repository.",
  parameters: Type.Object({
    scope: Type.Optional(
      Type.Union(
        [Type.Literal("assigned"), Type.Literal("authored"), Type.Literal("all")],
        { description: "Scope: assigned to you, authored by you, or all", default: "assigned" },
      ),
    ),
    state: Type.Optional(
      Type.Union(
        [Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")],
        { description: "Issue state filter", default: "open" },
      ),
    ),
    limit: Type.Optional(Type.Number({ description: "Max results", default: 20 })),
    repo: Type.Optional(Type.String({ description: "Filter by repository (e.g., owner/name)" })),
  }),
  execute: async (_toolCallId, params) => {
    if (!isGhAvailable()) {
      return {
        content: [{ type: "text", text: "GitHub CLI (`gh`) is not installed." }],
        details: { error: "gh not found" },
      };
    }

    const scope = (params.scope as string) ?? "assigned";
    const state = (params.state as string) ?? "open";
    const limit = (params.limit as number) ?? 20;
    const repo = params.repo as string | undefined;

    const stateFlag = state === "all" ? "--state all" : `--state ${state}`;
    const limitFlag = `--limit ${limit}`;
    const repoFlag = repo ? `--repo ${repo}` : "";
    const jsonFlag = `--json ${ISSUE_JSON}`;

    let issues: GhIssue[] = [];

    if (scope === "authored") {
      const raw = gh(`search issues --author @me ${stateFlag} ${limitFlag} --json ${ISSUE_JSON} ${repoFlag}`);
      if (raw) issues = JSON.parse(raw) as GhIssue[];
    } else if (scope === "assigned") {
      const raw = gh(`issue list --assignee @me ${stateFlag} ${limitFlag} ${jsonFlag} ${repoFlag}`);
      if (raw) issues = JSON.parse(raw) as GhIssue[];
      if (!repo && issues.length < limit) {
        const raw2 = gh(`search issues --assignee @me ${stateFlag} --limit ${limit} --json ${ISSUE_JSON}`);
        if (raw2) {
          const searched = JSON.parse(raw2) as GhIssue[];
          const existing = new Set(issues.map((i) => `${i.repository?.nameWithOwner ?? ""}#${i.number}`));
          for (const s of searched) {
            const key = `${s.repository?.nameWithOwner ?? ""}#${s.number}`;
            if (!existing.has(key)) issues.push(s);
          }
        }
      }
    } else {
      const rawA = gh(`search issues --author @me ${stateFlag} --limit ${limit} --json ${ISSUE_JSON}`);
      if (rawA) issues = JSON.parse(rawA) as GhIssue[];
      const rawB = gh(`search issues --assignee @me ${stateFlag} --limit ${limit} --json ${ISSUE_JSON}`);
      if (rawB) {
        const assigned = JSON.parse(rawB) as GhIssue[];
        const existing = new Set(issues.map((i) => `${i.repository?.nameWithOwner ?? ""}#${i.number}`));
        for (const s of assigned) {
          const key = `${s.repository?.nameWithOwner ?? ""}#${s.number}`;
          if (!existing.has(key)) issues.push(s);
        }
      }
    }

    const formatted = formatIssues(issues);
    return {
      content: [{ type: "text", text: `## GitHub Issues (${scope}, ${state})\n\n${formatted}` }],
      details: { scope, state, count: issues.length },
    };
  },
});

export const ghListPrs = defineTool({
  name: "gh_list_prs",
  label: "List GitHub PRs",
  description: "List your open GitHub Pull Requests across repositories.",
  parameters: Type.Object({
    state: Type.Optional(
      Type.Union(
        [Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")],
        { description: "PR state filter", default: "open" },
      ),
    ),
    limit: Type.Optional(Type.Number({ description: "Max results", default: 20 })),
    repo: Type.Optional(Type.String({ description: "Filter by repository (e.g., owner/name)" })),
  }),
  execute: async (_toolCallId, params) => {
    if (!isGhAvailable()) {
      return {
        content: [{ type: "text", text: "GitHub CLI (`gh`) is not installed." }],
        details: { error: "gh not found" },
      };
    }

    const state = (params.state as string) ?? "open";
    const limit = (params.limit as number) ?? 20;
    const repo = params.repo as string | undefined;

    const stateFlag = state === "all" ? "--state all" : `--state ${state}`;
    const limitFlag = `--limit ${limit}`;
    const repoFlag = repo ? `--repo ${repo}` : "";
    const jsonFlag = `--json ${PR_JSON}`;

    let prs: GhPr[] = [];
    if (repo) {
      const raw = gh(`pr list --author @me ${stateFlag} ${limitFlag} ${jsonFlag} ${repoFlag}`);
      if (raw) prs = JSON.parse(raw) as GhPr[];
    } else {
      const raw = gh(`search prs --author @me ${stateFlag} ${limitFlag} --json ${PR_JSON}`);
      if (raw) prs = JSON.parse(raw) as GhPr[];
    }

    const formatted = formatPrs(prs);
    return {
      content: [{ type: "text", text: `## GitHub Pull Requests (${state})\n\n${formatted}` }],
      details: { state, count: prs.length },
    };
  },
});

export const ghMyActivity = defineTool({
  name: "gh_my_activity",
  label: "My GitHub Activity",
  description:
    "Get an overview of your recent GitHub activity: open issues and PRs. Useful for startup sync.",
  parameters: Type.Object({}),
  execute: async () => {
    if (!isGhAvailable()) {
      return {
        content: [{ type: "text", text: "GitHub CLI (`gh`) is not installed." }],
        details: { error: "gh not found" },
      };
    }

    const [issuesRaw, prsRaw] = [
      gh(`search issues --author @me --state open --limit 20 --json ${ISSUE_JSON}`),
      gh(`search prs --author @me --state open --limit 20 --json ${PR_JSON}`),
    ];

    const issues = issuesRaw ? (JSON.parse(issuesRaw) as GhIssue[]) : [];
    const prs = prsRaw ? (JSON.parse(prsRaw) as GhPr[]) : [];

    const parts: string[] = [];
    parts.push("## GitHub Activity Summary\n");
    parts.push(`**Open Issues:** ${issues.length}`);
    parts.push(`**Open PRs:** ${prs.length}\n`);

    if (issues.length > 0) {
      parts.push("### Open Issues");
      parts.push(formatIssues(issues));
      parts.push("");
    }
    if (prs.length > 0) {
      parts.push("### Open Pull Requests");
      parts.push(formatPrs(prs));
    }

    return {
      content: [{ type: "text", text: parts.join("\n") }],
      details: { issues: issues.length, prs: prs.length },
    };
  },
});
