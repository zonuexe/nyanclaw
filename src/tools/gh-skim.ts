import { Type } from "typebox";
import {
  appendSkimRun,
  fetchSkimWindow,
  parseRepoSlug,
  parseSinceArg,
  resolveClone,
  type SkimFetchResult,
} from "../skim/index.ts";

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

/**
 * Fetch window + write skim page with deterministic excerpts.
 * LLM can re-summarize later; this makes /skim and tools useful immediately.
 */
export const ghRepoSkim = defineTool({
  name: "gh_repo_skim",
  label: "Skim GitHub repo changes",
  description:
    "Fetch recent commits on a repo default branch via gh (per-commit patches), append a run to Logseq page GH:owner/repo/skim/YYYY-MM-DD. Default window 24h, max 20 commits. Optional since: 1d|3d|YYYY-MM-DD.",
  parameters: Type.Object({
    repo: Type.String({ description: "owner/repo (e.g. phpstan/phpstan-src)" }),
    since: Type.Optional(
      Type.String({
        description: "Window: 1d (default), 3d, 24h, or YYYY-MM-DD",
      }),
    ),
    write: Type.Optional(
      Type.Boolean({
        description: "Append to Logseq skim page (default true)",
        default: true,
      }),
    ),
  }),
  execute: async (_id, params) => {
    try {
      const repo = parseRepoSlug(String(params.repo));
      const window = parseSinceArg(
        params.since === undefined ? undefined : String(params.since),
      );
      const doWrite = params.write !== false;

      const clone = resolveClone(repo);
      let cloneNote: string | undefined;
      if (clone.clonePath) {
        cloneNote = `clone_path (${clone.source}): ${clone.clonePath}${
          clone.needsConfirmToBind
            ? " — not bound to GH page yet (confirm to set :clone_path:)"
            : ""
        }`;
      } else if (clone.exploreHits && clone.exploreHits.length > 1) {
        cloneNote = `multiple explore hits (not auto-bound): ${clone.exploreHits.join("; ")}`;
      } else {
        cloneNote = "clone_path: none (gh-only; patch gaps not filled from git)";
      }

      const fetch: SkimFetchResult = fetchSkimWindow(repo, window);

      let pagePath: string | undefined;
      let pageName: string | undefined;
      if (doWrite) {
        const w = await appendSkimRun({ fetch, cloneNote });
        pagePath = w.path;
        pageName = w.page;
      }

      // Compact text for the agent / TUI
      const lines: string[] = [
        `## Repo skim: ${fetch.repo}`,
        `- branch: \`${fetch.defaultBranch}\``,
        `- window: ${fetch.sinceIso} → ${fetch.untilIso}`,
        `- commits: ${fetch.commits.length}${fetch.truncated ? ` of ${fetch.totalInWindow} (truncated)` : ""}`,
        `- ${cloneNote}`,
      ];
      if (pageName) {
        lines.push(`- Logseq: [[${pageName}]]`);
        lines.push(`- path: \`${pagePath}\``);
      }
      lines.push("");
      for (const c of fetch.commits) {
        lines.push(
          `### ${c.shortSha} — ${c.message} (+${c.stats.additions}/-${c.stats.deletions})`,
        );
        lines.push(`- ${c.htmlUrl}`);
        for (const f of c.files.slice(0, 8)) {
          lines.push(
            `  - ${f.status} \`${f.filename}\` (+${f.additions}/-${f.deletions})${f.patchOmitted ? " [no patch]" : ""}`,
          );
        }
        if (c.files.length > 8) lines.push(`  - … ${c.files.length - 8} more files`);
        lines.push("");
      }
      if (fetch.commits.length === 0) {
        lines.push("_No commits in window._");
      }
      lines.push(
        "Per-commit **diff excerpts** were written to the skim page (deterministic). " +
          "You may refine narrative summaries in chat; re-append via another skim or capture if needed.",
      );

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          repo: fetch.repo,
          defaultBranch: fetch.defaultBranch,
          totalInWindow: fetch.totalInWindow,
          written: fetch.commits.length,
          truncated: fetch.truncated,
          page: pageName,
          path: pagePath,
          clone,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `gh_repo_skim failed: ${msg}` }],
        details: { error: msg },
      };
    }
  },
});
