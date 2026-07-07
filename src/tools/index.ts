import { ghListIssues, ghListPrs, ghMyActivity } from "./gh.ts";
import { logseqReadJournal, logseqWriteBlock, logseqSearch } from "./logseq.ts";
import { calendarReadEvents } from "./calendar.ts";
import { talkCreateOutline, talkUpdateOutline, talkListOutlines, talkCreateTasks } from "./talk.ts";

export function createTools(): any[] {
  return [
    ghListIssues,
    ghListPrs,
    ghMyActivity,
    logseqReadJournal,
    logseqWriteBlock,
    logseqSearch,
    calendarReadEvents,
    talkCreateOutline,
    talkUpdateOutline,
    talkListOutlines,
    talkCreateTasks,
  ];
}
