import { ghListIssues, ghListPrs, ghMyActivity } from "./gh.ts";
import {
  logseqReadJournal,
  logseqAppendBlock,
  logseqAppendNote,
  logseqAppendQuote,
  logseqSetTodo,
  logseqSetPlanning,
  logseqUpsertTask,
  logseqWriteBlock,
  logseqSearch,
} from "./logseq.ts";
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
    logseqAppendBlock,
    logseqAppendNote,
    logseqAppendQuote,
    logseqSetTodo,
    logseqSetPlanning,
    logseqUpsertTask,
    logseqWriteBlock,
    logseqSearch,
    calendarReadEvents,
    talkCreateOutline,
    talkUpdateOutline,
    talkListOutlines,
    talkCreateTasks,
  ];
}
