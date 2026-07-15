/**
 * Reserved Logseq logical prefix for machine-oriented nyanclaw pages (ADR-0004).
 * Humans may open these; daily reading is optional.
 */

import type { PageRef } from "./types.ts";
import { OrgError } from "./types.ts";
import { appendNote, writeDocument, type OrgWriteOpts } from "./ops.ts";
import { resolvePath } from "./paths.ts";
import { readOrgFile } from "./fs.ts";
import { logseqGraph } from "../config.ts";

export const NYANCLAW_NS = "nyanclaw";

export function machinePage(name: string): PageRef {
  const trimmed = name.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed || trimmed.includes("..")) {
    throw new OrgError("path_escape", `invalid machine page name: ${name}`);
  }
  if (trimmed.startsWith(`${NYANCLAW_NS}/`)) {
    return { kind: "page", name: trimmed };
  }
  return { kind: "page", name: `${NYANCLAW_NS}/${trimmed}` };
}

export function inboxPage(): PageRef {
  return machinePage("inbox");
}

export function auditPage(): PageRef {
  return machinePage("audit");
}

export function sessionPage(id: string): PageRef {
  if (!id || /[/\0]/.test(id) || id.includes("..")) {
    throw new OrgError("path_escape", `invalid session id: ${id}`);
  }
  return machinePage(`sessions/${id}`);
}

export function proposalPage(id: string): PageRef {
  if (!id || /[/\0]/.test(id) || id.includes("..")) {
    throw new OrgError("path_escape", `invalid proposal id: ${id}`);
  }
  return machinePage(`proposals/${id}`);
}

function graphRootOf(opts?: OrgWriteOpts): string {
  return opts?.graphRoot ?? logseqGraph();
}

/** Ensure a machine page exists with TITLE; optional first note lines. */
export async function ensureMachinePage(
  ref: PageRef,
  opts?: OrgWriteOpts & { seedLines?: string[] },
): Promise<{ path: string; created: boolean }> {
  if (ref.kind !== "page" || !ref.name.startsWith(`${NYANCLAW_NS}/`)) {
    throw new OrgError("path_escape", "ensureMachinePage requires nyanclaw/ page ref");
  }
  const gr = graphRootOf(opts);
  const path = resolvePath(ref, gr);
  const before = readOrgFile(path);
  if (before !== null) {
    return { path, created: false };
  }
  await writeDocument(
    ref,
    {
      title: ref.name,
      blocks: [],
    },
    opts,
  );
  if (opts?.seedLines?.length) {
    await appendNote(ref, { lines: opts.seedLines, style: "list" }, opts);
  }
  return { path, created: true };
}

/** Append one audit line to nyanclaw/audit. */
export async function appendAuditLine(line: string, opts?: OrgWriteOpts): Promise<void> {
  const ref = auditPage();
  await ensureMachinePage(ref, opts);
  await appendNote(ref, { lines: [line], style: "list" }, opts);
}
