/**
 * Append a Repo skim run section to GH:owner/repo/skim/YYYY-MM-DD
 */

import {
  appendBlock,
  type BlockSpec,
  type OrgWriteOpts,
} from "../org/index.ts";
import type { SkimCommit, SkimFetchResult } from "./fetch.ts";
import { excerptSummary } from "./fetch.ts";

export function skimPageName(repo: string, runDate = new Date()): string {
  const y = runDate.getFullYear();
  const m = String(runDate.getMonth() + 1).padStart(2, "0");
  const d = String(runDate.getDate()).padStart(2, "0");
  return `GH:${repo}/skim/${y}-${m}-${d}`;
}

export type CommitSummaryInput = {
  shortSha: string;
  /** LLM or excerpt lines */
  summaryLines: string[];
};

export type SkimWriteInput = {
  fetch: SkimFetchResult;
  /** Per-commit summary lines keyed by shortSha or full sha */
  summaries?: Record<string, string[]>;
  cloneNote?: string;
};

function commitBlock(c: SkimCommit, summaryLines: string[]): BlockSpec {
  const title = `${c.shortSha} ${c.message}`.slice(0, 200);
  const body = [
    `date: ${c.authorDate}`,
    `url: ${c.htmlUrl}`,
    `stats: +${c.stats.additions} -${c.stats.deletions}`,
    ...summaryLines.map((l) => l.slice(0, 300)),
  ];
  return { title, body };
}

/**
 * Append one run section under the day's skim page.
 */
export async function appendSkimRun(
  input: SkimWriteInput,
  opts?: OrgWriteOpts & { runDate?: Date },
): Promise<{ page: string; path: string }> {
  const { fetch } = input;
  const runDate = opts?.runDate ?? new Date();
  const page = skimPageName(fetch.repo, runDate);
  const ranAt = fetch.fetchedAt;
  const windowDesc = `${fetch.sinceIso} → ${fetch.untilIso}`;
  const trunc = fetch.truncated
    ? `commits: ${fetch.commits.length} of ${fetch.totalInWindow} (truncated at max)`
    : `commits: ${fetch.commits.length}`;

  const metaBody = [
    `ran_at: ${ranAt}`,
    `branch: ${fetch.defaultBranch}`,
    `window: ${windowDesc}`,
    trunc,
  ];
  if (input.cloneNote) metaBody.push(input.cloneNote);

  const children: BlockSpec[] = fetch.commits.map((c) => {
    const key = c.shortSha;
    const lines =
      input.summaries?.[c.sha] ??
      input.summaries?.[key] ??
      excerptSummary(c);
    return commitBlock(c, lines);
  });

  if (fetch.commits.length === 0) {
    children.push({
      title: "no commits in window",
      body: ["No commits on the default branch in the requested window."],
    });
  }

  const block: BlockSpec = {
    title: `run ${ranAt}`,
    body: metaBody,
    children,
  };

  const result = await appendBlock({ kind: "page", name: page }, block, opts);
  return { page, path: result.path };
}
