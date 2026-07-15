/** Structured Org intent types for deterministic Logseq-subset writes. */

export type TodoKeyword = "TODO" | "DONE" | "WAITING";

export type OrgTimestamp = {
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
};

export type BlockStyle = "headline" | "list";

/** Root-only level. Children must omit level (inherited as parent+1). */
export type BlockSpec = {
  style?: BlockStyle;
  level?: number;
  todo?: TodoKeyword | null;
  title: string;
  tags?: string[];
  deadline?: OrgTimestamp | null;
  scheduled?: OrgTimestamp | null;
  properties?: Record<string, string>;
  body?: string[];
  children?: BlockSpec[];
};

export type NoteSpec = {
  style?: "list" | "paragraph";
  lines: string[];
};

export type QuoteSpec = {
  heading?: string;
  level?: number;
  tags?: string[];
  lines: string[];
};

export type PageRef =
  | { kind: "journal"; date?: string }
  | { kind: "page"; name: string };

export type DocumentSpec = {
  title?: string;
  blocks: BlockSpec[];
};

export type WriteResult = {
  path: string;
  op: "create" | "append" | "replace" | "upsert" | "splice";
  bytes: number;
  validated: true;
  mtimeBeforeMs?: number;
  contentHashBefore?: string;
};

export type OrgErrorCode =
  | "invalid_title"
  | "invalid_body"
  | "invalid_quote"
  | "invalid_tags"
  | "invalid_timestamp"
  | "invalid_level"
  | "invalid_style"
  | "invalid_depth"
  | "invalid_size"
  | "invalid_properties"
  | "l2_fail"
  | "path_escape"
  | "not_found"
  | "ambiguous";

export class OrgError extends Error {
  readonly code: OrgErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: OrgErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "OrgError";
    this.code = code;
    this.details = details;
  }
}
