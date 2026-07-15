/**
 * Proposal (draft Record) store under nyanclaw/proposals and inbox listing.
 */

import { randomBytes } from "node:crypto";
import {
  appendNote,
  ensureMachinePage,
  inboxPage,
  proposalPage,
  writeDocument,
  type OrgWriteOpts,
  type PageRef,
} from "../org/index.ts";
import { resolvePath } from "../org/paths.ts";
import { readOrgFile } from "../org/fs.ts";
import { logseqGraph } from "../config.ts";

export type RecordType = "decision" | "lesson" | "preference" | "quote" | "note";

export type ProposalState = "pending" | "applied" | "rejected";

export type CreateProposalInput = {
  type: RecordType;
  title: string;
  body: string[];
  sourceSessionId?: string;
};

export type ProposalMeta = {
  id: string;
  type: RecordType;
  state: ProposalState;
  title: string;
  path: string;
  createdAt: string;
  sourceSessionId?: string;
};

function newProposalId(type: RecordType): string {
  const d = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${type}_${d}_${randomBytes(3).toString("hex")}`;
}

function graphRootOf(opts?: OrgWriteOpts): string {
  return opts?.graphRoot ?? logseqGraph();
}

export async function createProposal(
  input: CreateProposalInput,
  opts?: OrgWriteOpts,
): Promise<ProposalMeta> {
  const id = newProposalId(input.type);
  const createdAt = new Date().toISOString();
  const ref = proposalPage(id);
  const bodyLines = input.body.length ? input.body : ["(empty)"];

  await writeDocument(
    ref,
    {
      title: `nyanclaw/proposals/${id}`,
      blocks: [
        {
          title: "meta",
          properties: {
            id,
            type: input.type,
            state: "pending",
            created: createdAt,
            ...(input.sourceSessionId ? { source_session: input.sourceSessionId } : {}),
          },
        },
        {
          title: input.title,
          body: bodyLines.map((l) => (l === "" ? " " : l.replace(/^\*+\s/, " ").replace(/^-\s/, " "))),
        },
      ],
    },
    opts,
  );

  await ensureMachinePage(inboxPage(), opts);
  await appendNote(
    inboxPage(),
    {
      lines: [`pending ${id} (${input.type}): ${input.title}`],
      style: "list",
    },
    opts,
  );

  const path = resolvePath(ref, graphRootOf(opts));
  return {
    id,
    type: input.type,
    state: "pending",
    title: input.title,
    path,
    createdAt,
    sourceSessionId: input.sourceSessionId,
  };
}

export async function listPendingProposals(opts?: OrgWriteOpts): Promise<ProposalMeta[]> {
  const gr = graphRootOf(opts);
  const inboxPath = resolvePath(inboxPage(), gr);
  const text = readOrgFile(inboxPath);
  if (!text) return [];

  const out: ProposalMeta[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^- pending (\S+) \((\w+)\): (.*)$/);
    if (!m) continue;
    const id = m[1]!;
    const type = m[2] as RecordType;
    const title = m[3]!;
    out.push({
      id,
      type,
      state: "pending",
      title,
      path: resolvePath(proposalPage(id), gr),
      createdAt: "",
    });
  }
  return out;
}

export function proposalRef(id: string): PageRef {
  return proposalPage(id);
}

/**
 * Apply a pending proposal: write a human-facing Record page and mark proposal applied.
 * Removes matching pending line from inbox (rewrite remaining pending lines).
 */
export async function applyProposal(
  id: string,
  opts?: OrgWriteOpts,
): Promise<{ recordPath: string; proposalPath: string }> {
  const gr = graphRootOf(opts);
  const pref = proposalPage(id);
  const ppath = resolvePath(pref, gr);
  const raw = readOrgFile(ppath);
  if (!raw) {
    throw new Error(`proposal not found: ${id}`);
  }
  if (/:state:\s*applied/i.test(raw)) {
    throw new Error(`proposal already applied: ${id}`);
  }
  if (/:state:\s*rejected/i.test(raw)) {
    throw new Error(`proposal already rejected: ${id}`);
  }

  const typeMatch = raw.match(/:type:\s*(\S+)/);
  const type = (typeMatch?.[1] ?? "decision") as RecordType;
  // Title: first level-1 headline that is not "meta"
  let title = id;
  for (const line of raw.split("\n")) {
    const hm = line.match(/^\*\s+(.+)$/);
    if (hm && hm[1] !== "meta") {
      title = hm[1]!.trim();
      break;
    }
  }
  // Body: lines under title block that look like indented body (two spaces)
  const body: string[] = [];
  let inTitle = false;
  for (const line of raw.split("\n")) {
    if (/^\*\s+/.test(line)) {
      inTitle = !line.startsWith("* meta");
      continue;
    }
    if (inTitle && line.startsWith("  ") && !line.startsWith("  :")) {
      body.push(line.slice(2));
    }
  }

  const recordName = `Records/${type}/${title}`.slice(0, 200);
  const recordRef: PageRef = { kind: "page", name: recordName };
  await writeDocument(
    recordRef,
    {
      title: recordName,
      blocks: [
        {
          title,
          tags: [type.charAt(0).toUpperCase() + type.slice(1)],
          body: body.length ? body : undefined,
          properties: {
            nyanclaw_proposal: id,
            nyanclaw_type: type,
            applied: new Date().toISOString(),
          },
        },
      ],
    },
    opts,
  );

  // Mark proposal applied (rewrite document)
  const applied = raw.replace(/:state:\s*\S+/, ":state: applied");
  const { writeOrgFileAtomic } = await import("../org/fs.ts");
  writeOrgFileAtomic(ppath, applied.endsWith("\n") ? applied : applied + "\n");

  // Rewrite inbox without this id
  const pending = (await listPendingProposals(opts)).filter((p) => p.id !== id);
  await writeDocument(
    inboxPage(),
    {
      title: "nyanclaw/inbox",
      blocks: [],
    },
    opts,
  );
  if (pending.length) {
    await appendNote(
      inboxPage(),
      {
        lines: pending.map((p) => `pending ${p.id} (${p.type}): ${p.title}`),
        style: "list",
      },
      opts,
    );
  }

  const { appendAuditLine } = await import("../org/namespace.ts");
  await appendAuditLine(
    `${new Date().toISOString()} applied ${id} → ${recordName}`,
    opts,
  );

  return {
    recordPath: resolvePath(recordRef, gr),
    proposalPath: ppath,
  };
}

export async function rejectProposal(id: string, opts?: OrgWriteOpts): Promise<void> {
  const gr = graphRootOf(opts);
  const ppath = resolvePath(proposalPage(id), gr);
  const raw = readOrgFile(ppath);
  if (!raw) throw new Error(`proposal not found: ${id}`);
  if (/:state:\s*applied/i.test(raw)) throw new Error(`cannot reject applied proposal: ${id}`);
  const rejected = raw.replace(/:state:\s*\S+/, ":state: rejected");
  const { writeOrgFileAtomic } = await import("../org/fs.ts");
  writeOrgFileAtomic(ppath, rejected.endsWith("\n") ? rejected : rejected + "\n");

  const pending = (await listPendingProposals(opts)).filter((p) => p.id !== id);
  await writeDocument(inboxPage(), { title: "nyanclaw/inbox", blocks: [] }, opts);
  if (pending.length) {
    await appendNote(
      inboxPage(),
      {
        lines: pending.map((p) => `pending ${p.id} (${p.type}): ${p.title}`),
        style: "list",
      },
      opts,
    );
  }
  const { appendAuditLine } = await import("../org/namespace.ts");
  await appendAuditLine(`${new Date().toISOString()} rejected ${id}`, opts);
}
