import { ghListIssues, ghListPrs, ghMyActivity } from "./gh.ts";
import { logseqReadJournal, logseqWriteBlock, logseqSearch } from "./logseq.ts";
import { calendarReadEvents } from "./calendar.ts";
import { talkCreateOutline, talkUpdateOutline, talkListOutlines, talkCreateTasks } from "./talk.ts";
import { ghSyncWatched, ghSyncMaintained, ghSyncAll } from "./gh-sync.ts";
import { systemNow } from "./system.ts";

export function createTools(): any[] {
  return [
    systemNow,
    ghListIssues,
    ghListPrs,
    ghMyActivity,
    ghSyncWatched,
    ghSyncMaintained,
    ghSyncAll,
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
