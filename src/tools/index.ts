import { ghListIssues, ghListPrs } from "./gh.ts";
import { logseqReadJournal, logseqWriteBlock, logseqSearch } from "./logseq.ts";
import { calendarReadEvents } from "./calendar.ts";

export function createTools(): any[] {
  return [
    ghListIssues,
    ghListPrs,
    logseqReadJournal,
    logseqWriteBlock,
    logseqSearch,
    calendarReadEvents,
  ];
}
