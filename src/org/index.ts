export type {
  BlockSpec,
  BlockStyle,
  DocumentSpec,
  NoteSpec,
  OrgTimestamp,
  PageRef,
  QuoteSpec,
  TodoKeyword,
  WriteResult,
} from "./types.ts";
export { OrgError } from "./types.ts";

export {
  serializeBlock,
  serializeDocument,
  serializeNote,
  serializeQuote,
  renderBlock,
  renderDocument,
  renderNote,
  renderQuote,
  assertSafeTitle,
  normalizeTags,
  formatTs,
} from "./serialize.ts";

export { assertStructuralOk, maybeRoundTrip } from "./validate.ts";
export type { L2Intent } from "./validate.ts";

export {
  encodePageName,
  decodePageName,
  journalDateFile,
  resolvePath,
  assertUnderGraph,
  titleForPageRef,
} from "./paths.ts";

export {
  appendBlock,
  appendBlocks,
  appendNote,
  appendQuote,
  writeDocument,
  setTodoState,
  setPlanning,
  upsertTask,
} from "./ops.ts";
export type { OrgWriteOpts } from "./ops.ts";

export {
  normalizeTitle,
  enumerateBlocks,
  findMatchingBlocks,
  requireOneMatch,
  rewriteTodoOnLine,
  splicePlanningLines,
  isPlanningLine,
  readPlanningFromBlockLines,
} from "./match.ts";
export type { LocatedHeadline, MatchQuery } from "./match.ts";

export {
  NYANCLAW_NS,
  machinePage,
  inboxPage,
  auditPage,
  sessionPage,
  proposalPage,
  ensureMachinePage,
  appendAuditLine,
} from "./namespace.ts";
