/**
 * Deterministic GitHub commit+patch fetch for Repo skim (gh API, no clone).
 */

import { execSync } from "node:child_process";

export const SKIM_MAX_COMMITS = 20;
export const SKIM_PATCH_BUDGET_CHARS = 40_000; // per commit, total patches fed onward

export type SkimWindow =
  | { kind: "rolling"; hours: number }
  | { kind: "since"; iso: string };

export type SkimFileDiff = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  hasPatch: boolean;
  patch?: string;
  patchOmitted?: boolean;
};

export type SkimCommit = {
  sha: string;
  shortSha: string;
  message: string;
  authorDate: string;
  htmlUrl: string;
  stats: { additions: number; deletions: number; total: number };
  files: SkimFileDiff[];
  patchBudgetExceeded?: boolean;
};

export type SkimFetchResult = {
  repo: string;
  defaultBranch: string;
  sinceIso: string;
  untilIso: string;
  totalInWindow: number;
  truncated: boolean;
  commits: SkimCommit[];
  fetchedAt: string;
};

/** Call `gh api <path>` — path may include query string; do not over-encode `:` in timestamps. */
function ghJson(apiPath: string, timeoutMs = 30_000): unknown {
  try {
    // Quote path so `&` and `:` in query strings are not eaten by the shell.
    const out = execSync(`gh api ${JSON.stringify(apiPath)}`, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
    if (!out) return null;
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function parseRepoSlug(input: string): string {
  const s = input.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const m = s.match(/^([^/]+)\/([^/]+)$/);
  if (!m) throw new Error(`expected owner/repo, got: ${input}`);
  return `${m[1]}/${m[2]}`;
}

export function windowToSinceIso(window: SkimWindow, now = new Date()): string {
  if (window.kind === "since") return window.iso;
  const ms = window.hours * 3600_000;
  return new Date(now.getTime() - ms).toISOString();
}

/** Parse CLI-ish duration: 1d, 24h, 3d → rolling hours; or ISO date → since start of that day UTC. */
export function parseSinceArg(arg?: string): SkimWindow {
  if (!arg || arg === "1d" || arg === "24h") return { kind: "rolling", hours: 24 };
  const m = arg.match(/^(\d+)([dh])$/i);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    return { kind: "rolling", hours: unit === "d" ? n * 24 : n };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    return { kind: "since", iso: `${arg}T00:00:00Z` };
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(arg)) {
    return { kind: "since", iso: arg };
  }
  throw new Error(`invalid since/window: ${arg} (use 1d, 3d, 24h, or YYYY-MM-DD)`);
}

export function getDefaultBranch(repo: string): string {
  const meta = ghJson(`repos/${repo}`) as { default_branch?: string } | null;
  return meta?.default_branch || "main";
}

function listCommitShas(repo: string, branch: string, sinceIso: string): string[] {
  const shas: string[] = [];
  let page = 1;
  while (page <= 5) {
    // Keep ISO `:` unencoded — GitHub accepts it; over-encoding broke empty responses via gh.
    const path =
      `repos/${repo}/commits?sha=${branch}&since=${sinceIso}&per_page=100&page=${page}`;
    const batch = ghJson(path) as { sha: string }[] | null;
    if (!batch?.length) break;
    for (const c of batch) shas.push(c.sha);
    if (batch.length < 100) break;
    page++;
  }
  return shas;
}

function fetchCommitDetail(repo: string, sha: string): SkimCommit | null {
  const c = ghJson(`repos/${repo}/commits/${sha}`, 60_000) as {
    sha: string;
    html_url?: string;
    commit?: { message?: string; author?: { date?: string } };
    stats?: { additions?: number; deletions?: number; total?: number };
    files?: {
      filename?: string;
      status?: string;
      additions?: number;
      deletions?: number;
      patch?: string;
    }[];
  } | null;
  if (!c?.sha) return null;

  const files: SkimFileDiff[] = [];
  let used = 0;
  let budgetExceeded = false;
  for (const f of c.files ?? []) {
    const filename = f.filename || "(unknown)";
    const hasPatch = typeof f.patch === "string" && f.patch.length > 0;
    let patch = hasPatch ? f.patch : undefined;
    let patchOmitted = !hasPatch;
    if (patch) {
      const room = SKIM_PATCH_BUDGET_CHARS - used;
      if (room <= 0) {
        patch = undefined;
        patchOmitted = true;
        budgetExceeded = true;
      } else if (patch.length > room) {
        patch = patch.slice(0, room) + "\n… [patch truncated by nyanclaw budget]";
        used = SKIM_PATCH_BUDGET_CHARS;
        budgetExceeded = true;
      } else {
        used += patch.length;
      }
    }
    files.push({
      filename,
      status: f.status || "modified",
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      hasPatch: hasPatch && !patchOmitted,
      patch,
      patchOmitted: patchOmitted || undefined,
    });
  }

  const msg = (c.commit?.message || "").split("\n")[0] || "(no message)";
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: msg,
    authorDate: c.commit?.author?.date || "",
    htmlUrl: c.html_url || `https://github.com/${repo}/commit/${c.sha}`,
    stats: {
      additions: c.stats?.additions ?? 0,
      deletions: c.stats?.deletions ?? 0,
      total: c.stats?.total ?? 0,
    },
    files,
    patchBudgetExceeded: budgetExceeded || undefined,
  };
}

/**
 * Fetch commits on default branch in window; cap at SKIM_MAX_COMMITS (newest first).
 */
export function fetchSkimWindow(
  repoInput: string,
  window: SkimWindow = { kind: "rolling", hours: 24 },
  opts?: { maxCommits?: number; now?: Date },
): SkimFetchResult {
  const repo = parseRepoSlug(repoInput);
  const now = opts?.now ?? new Date();
  const sinceIso = windowToSinceIso(window, now);
  const untilIso = now.toISOString();
  const maxCommits = opts?.maxCommits ?? SKIM_MAX_COMMITS;
  const defaultBranch = getDefaultBranch(repo);
  const allShas = listCommitShas(repo, defaultBranch, sinceIso);
  const totalInWindow = allShas.length;
  const selected = allShas.slice(0, maxCommits);
  const commits: SkimCommit[] = [];
  for (const sha of selected) {
    const detail = fetchCommitDetail(repo, sha);
    if (detail) commits.push(detail);
  }
  return {
    repo,
    defaultBranch,
    sinceIso,
    untilIso,
    totalInWindow,
    truncated: totalInWindow > selected.length,
    commits,
    fetchedAt: now.toISOString(),
  };
}

/** Deterministic one-line-ish excerpt from patches for non-LLM fallback summaries. */
export function excerptSummary(commit: SkimCommit, maxLines = 8): string[] {
  const lines: string[] = [];
  lines.push(
    `+${commit.stats.additions} -${commit.stats.deletions} across ${commit.files.length} file(s)`,
  );
  for (const f of commit.files.slice(0, 12)) {
    const flag = f.patchOmitted ? " (no patch)" : "";
    lines.push(`${f.status} ${f.filename} (+${f.additions}/-${f.deletions})${flag}`);
  }
  if (commit.files.length > 12) {
    lines.push(`… and ${commit.files.length - 12} more files`);
  }
  // first meaningful patch lines
  let taken = 0;
  for (const f of commit.files) {
    if (!f.patch || taken >= maxLines) break;
    for (const pl of f.patch.split("\n")) {
      if (pl.startsWith("@@") || pl.startsWith("diff")) continue;
      if (pl.startsWith("+") || pl.startsWith("-")) {
        if (pl.startsWith("+++") || pl.startsWith("---")) continue;
        lines.push(`${f.filename}: ${pl.slice(0, 120)}`);
        taken++;
        if (taken >= maxLines) break;
      }
    }
  }
  if (commit.patchBudgetExceeded) {
    lines.push("(patch budget exceeded — some hunks omitted)");
  }
  return lines;
}
