/**
 * Resolve local clone path: Logseq GH:owner/repo clone_path property, then explore roots.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../config.ts";
import { logseqGraph } from "../config.ts";
import { encodePageName } from "../org/paths.ts";
import { parseRepoSlug } from "./fetch.ts";

export type CloneResolveResult = {
  repo: string;
  clonePath?: string;
  source?: "property" | "explore";
  exploreHits?: string[];
  /** True when explore found candidates that are not yet written to the GH page. */
  needsConfirmToBind?: boolean;
};

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

function ghPagePath(repo: string): string {
  const graph = logseqGraph();
  const name = `GH:${repo}`;
  const encoded = encodePageName(name);
  const candidates = [
    join(graph, "pages", `${name}.org`),
    join(graph, "pages", `${encoded}.org`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return join(graph, "pages", `${encoded}.org`);
}

/** Read :clone_path: from Org property drawer or line. */
export function readClonePathFromOrg(content: string): string | undefined {
  const m = content.match(/^\s*:clone_path:\s*(.+)\s*$/im);
  if (!m) return undefined;
  return expandHome(m[1]!.trim());
}

export function readClonePathForRepo(repoInput: string): string | undefined {
  const repo = parseRepoSlug(repoInput);
  const p = ghPagePath(repo);
  if (!existsSync(p)) return undefined;
  try {
    const content = readFileSync(p, "utf-8");
    const path = readClonePathFromOrg(content);
    if (path && existsSync(path)) return path;
    return path; // may not exist on disk yet
  } catch {
    return undefined;
  }
}

export function getExploreRoots(): string[] {
  const c = loadConfig();
  const roots = c.repoExploreRoots ?? [];
  return roots.map(expandHome).filter((r) => existsSync(r));
}

/**
 * Search explore roots for a directory that looks like the repo
 * (ends with /repo or /owner/repo, optionally .git).
 */
export function exploreCloneCandidates(repoInput: string, roots?: string[]): string[] {
  const repo = parseRepoSlug(repoInput);
  const [owner, name] = repo.split("/") as [string, string];
  const searchRoots = roots ?? getExploreRoots();
  const hits: string[] = [];

  function consider(dir: string): void {
    if (!existsSync(dir)) return;
    try {
      if (!statSync(dir).isDirectory()) return;
    } catch {
      return;
    }
    const git = join(dir, ".git");
    if (!existsSync(git)) return;
    if (!hits.includes(dir)) hits.push(dir);
  }

  for (const root of searchRoots) {
    consider(join(root, name));
    consider(join(root, owner, name));
    consider(join(root, repo));
    // one level of subdirs
    try {
      for (const ent of readdirSync(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        if (ent.name.startsWith(".")) continue;
        const sub = join(root, ent.name);
        consider(join(sub, name));
        consider(join(sub, owner, name));
      }
    } catch {
      /* ignore */
    }
  }
  return hits;
}

/**
 * Resolve clone path without writing property.
 * Prefer GH page clone_path; else explore (may return multiple hits).
 */
export function resolveClone(repoInput: string): CloneResolveResult {
  const repo = parseRepoSlug(repoInput);
  const fromProp = readClonePathForRepo(repo);
  if (fromProp && existsSync(fromProp)) {
    return { repo, clonePath: fromProp, source: "property" };
  }
  const hits = exploreCloneCandidates(repo);
  if (hits.length === 1) {
    return {
      repo,
      clonePath: hits[0],
      source: "explore",
      exploreHits: hits,
      needsConfirmToBind: true,
    };
  }
  if (hits.length > 1) {
    return {
      repo,
      exploreHits: hits,
      needsConfirmToBind: true,
    };
  }
  return { repo, exploreHits: [] };
}
