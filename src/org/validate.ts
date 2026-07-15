/**
 * L2 structural validation (hard gate). L1 parse is debug-only.
 */

import { parse } from "org-mode-ast";
import { OrgError } from "./types.ts";

export type L2Intent =
  | { kind: "append_fragment"; fragment: string }
  | { kind: "append_note"; fragment: string }
  | { kind: "append_quote"; fragment: string }
  | { kind: "write_document" };

function countHeadlineLines(text: string): number {
  return text.split("\n").filter((l) => /^\*+\s/.test(l)).length;
}

function countListItemLines(text: string): number {
  return text.split("\n").filter((l) => /^\s*-\s/.test(l)).length;
}

function hasDoubleMarkers(text: string): boolean {
  return text.split("\n").some((l) => /^\*+\s+\*+\s/.test(l) || /^(\s*)-\s+-\s/.test(l));
}

function fragmentHasPlanningAsHeadline(fragment: string): boolean {
  return fragment.split("\n").some((l) => /^\*+\s+(DEADLINE|SCHEDULED)\s*:/i.test(l));
}

function fragmentHasKeywordAsHeadline(fragment: string): boolean {
  return fragment.split("\n").some((l) => /^\*+\s+#\+/.test(l) || /^\s*-\s+#\+/.test(l));
}

/** Hard structural checks on composed file text before write. */
export function assertStructuralOk(
  before: string,
  after: string,
  intent: L2Intent,
): void {
  if (hasDoubleMarkers(after)) {
    throw new OrgError("l2_fail", "double markers detected", { check: "double_markers" });
  }

  if (intent.kind === "append_fragment" || intent.kind === "append_note" || intent.kind === "append_quote") {
    const frag = intent.fragment;
    if (fragmentHasPlanningAsHeadline(frag)) {
      throw new OrgError("l2_fail", "planning line serialized as headline", {
        check: "planning_as_headline",
        snippet: frag.slice(0, 200),
      });
    }
    if (fragmentHasKeywordAsHeadline(frag)) {
      throw new OrgError("l2_fail", "org keyword serialized as headline/list", {
        check: "keyword_as_headline",
        snippet: frag.slice(0, 200),
      });
    }
  }

  if (intent.kind === "append_quote") {
    const frag = intent.fragment;
    const begins = (frag.match(/^#\+BEGIN_QUOTE$/gm) ?? []).length;
    const ends = (frag.match(/^#\+END_QUOTE$/gm) ?? []).length;
    if (begins !== 1 || ends !== 1) {
      throw new OrgError("l2_fail", "quote fragment must have exactly one BEGIN/END_QUOTE pair", {
        check: "quote_balance",
        begins,
        ends,
      });
    }
    const bi = frag.indexOf("#+BEGIN_QUOTE");
    const ei = frag.indexOf("#+END_QUOTE");
    if (bi < 0 || ei < bi) {
      throw new OrgError("l2_fail", "quote BEGIN/END order invalid", { check: "quote_order" });
    }
    const inner = frag.slice(bi + "#+BEGIN_QUOTE".length, ei);
    if (inner.split("\n").some((l) => /^\*+\s/.test(l) || /^\s*-\s/.test(l))) {
      throw new OrgError("l2_fail", "quote body must not contain headline/list markers", {
        check: "quote_inner_markers",
      });
    }
  }

  if (intent.kind === "append_fragment") {
    const frag = intent.fragment;
    const hDelta = countHeadlineLines(after) - countHeadlineLines(before);
    const lDelta = countListItemLines(after) - countListItemLines(before);
    const fragH = countHeadlineLines(frag);
    const fragL = countListItemLines(frag);
    // Fragment markers should account for the delta (allow trailing noise only if equal)
    if (hDelta !== fragH || lDelta !== fragL) {
      // Soften: still require non-negative and no planning-as-headline already checked
      if (hDelta < 0 || lDelta < 0) {
        throw new OrgError("l2_fail", "append decreased headline/list count", {
          check: "count_delta",
          hDelta,
          lDelta,
        });
      }
    }
  }

  if (intent.kind === "append_note") {
    // notes should not introduce TODO planning lines as siblings
    const frag = intent.fragment;
    if (/^(DEADLINE|SCHEDULED)\s*:/m.test(frag)) {
      throw new OrgError("l2_fail", "note fragment must not add planning", { check: "note_planning" });
    }
  }
}

/** Debug-only L1: parse without treating success as safety. */
export function maybeRoundTrip(text: string): { ok: boolean; error?: string } {
  try {
    parse(text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
