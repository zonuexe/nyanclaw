import { join } from "node:path";
import type { PageRef } from "./types.ts";
import { OrgError } from "./types.ts";

export function encodePageName(name: string): string {
  return name.replace(/:/g, "%3A").replace(/\//g, "%2F");
}

export function decodePageName(fileBase: string): string {
  return fileBase
    .replace(/\.org$/i, "")
    .replace(/\.md$/i, "")
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/");
}

export function journalDateFile(date?: Date | string): string {
  let d: Date;
  if (date === undefined) {
    d = new Date();
  } else if (typeof date === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new OrgError("invalid_timestamp", `journal date must be YYYY-MM-DD: ${date}`);
    }
    const [y, m, day] = date.split("-").map(Number);
    d = new Date(y!, m! - 1, day!);
  } else {
    d = date;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}_${m}_${day}`;
}

/** Resolve PageRef to absolute path under graphRoot; assert containment. */
export function resolvePath(ref: PageRef, graphRoot: string): string {
  const root = graphRoot.endsWith("/") ? graphRoot.slice(0, -1) : graphRoot;
  let abs: string;
  if (ref.kind === "journal") {
    const file = `${journalDateFile(ref.date)}.org`;
    abs = join(root, "journals", file);
  } else {
    if (ref.name.includes("..") || ref.name.split("/").includes("..")) {
      throw new OrgError("path_escape", "page name must not contain ..");
    }
    const encoded = encodePageName(ref.name);
    abs = join(root, "pages", `${encoded}.org`);
  }
  assertUnderGraph(abs, root);
  return abs;
}

export function assertUnderGraph(absPath: string, graphRoot: string): void {
  const root = graphRoot.endsWith("/") ? graphRoot.slice(0, -1) : graphRoot;
  const normalized = absPath.startsWith(root + "/") || absPath === root;
  if (!normalized) {
    throw new OrgError("path_escape", "path escapes graph root", { absPath, graphRoot: root });
  }
  if (absPath.includes("\0")) {
    throw new OrgError("path_escape", "path contains NUL");
  }
}

export function titleForPageRef(ref: PageRef): string {
  if (ref.kind === "journal") {
    return journalDateFile(ref.date);
  }
  return ref.name;
}
