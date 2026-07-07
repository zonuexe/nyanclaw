import { Type } from "typebox";
import { execSync } from "node:child_process";

function defineTool(def: {
  name: string;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: { type: "text"; text: string }[]; details: unknown }>;
}) {
  return def as any;
}

function isIcalBuddyAvailable(): boolean {
  try {
    execSync("which icalBuddy", { encoding: "utf-8", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Query events with icalBuddy.
 *
 * Flags used:
 *   -nc        No color
 *   -n         No calendar names in output
 *   -npn       No property names
 *   -b "- "    Bullet prefix for each event
 *   -ps "|ss|" Custom property separator for summary/startdate
 *   -ic ""     Include all calendars
 *   -ec ""     Exclude no calendars
 *
 * Returns lines like:
 *   - Event Title
 *   10:15 - 11:30
 */
function queryEvents(range: string): string {
  const flags = [
    "-nc",
    "-n",
    "-npn",
    '-b "- "',
    '-ps "|ss|dt|"',
    "-ic ''",
    "-ec ''",
    "-eep ''",
    "-iep 'datetime,title'",
    "-li 0",
    "-f",
  ].join(" ");

  return execSync(`icalBuddy ${flags} "${range}" 2>/dev/null`, {
    encoding: "utf-8",
    timeout: 15_000,
  }).trim();
}

/**
 * Parse icalBuddy output into structured event objects.
 * Output format:
 *   - Event Title
 *   notes line (optional)
 *   10:15 - 11:30
 *   (blank line)
 */
interface CalendarEvent {
  summary: string;
  calendar?: string;
  timeRange?: string;
}

function parseEvents(raw: string): CalendarEvent[] {
  if (!raw) return [];

  const events: CalendarEvent[] = [];
  const blocks = raw.split(/\n(?=- )/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length === 0) continue;

    const first = lines[0];
    if (!first.startsWith("- ")) continue;

    const summary = first.slice(2).trim();
    const timeRange = lines.find((l) => /^\d/.test(l.trim()))?.trim();
    events.push({ summary, timeRange });
  }

  return events;
}

export const calendarReadEvents = defineTool({
  name: "calendar_read_events",
  label: "Read Calendar Events",
  description:
    "Read macOS Calendar events via icalBuddy for today or a date range. Read-only.",
  parameters: Type.Object({
    days: Type.Optional(
      Type.Number({
        description: "Number of days. 1 = today only, 7 = this week (default: 1).",
        default: 1,
      }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    if (!isIcalBuddyAvailable()) {
      return {
        content: [
          {
            type: "text",
            text:
              "icalBuddy is not installed. Install it with: brew install ical-buddy",
          },
        ],
        details: { error: "icalBuddy not found" },
      };
    }

    const days = (params.days as number | undefined) ?? 1;

    const range = days <= 1
      ? "eventsToday"
      : `eventsFrom:today to:today+${days - 1}d`;

    const raw = queryEvents(range);
    const events = parseEvents(raw);

    if (events.length === 0) {
      return {
        content: [{ type: "text", text: "No events found today." }],
        details: { days, count: 0 },
      };
    }

    const formatted = events
      .map((e) => {
        const time = e.timeRange ? ` ${e.timeRange}` : " (all day)";
        return `- ${e.summary}${time}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `## Calendar Events (${days === 1 ? "today" : `next ${days} days`})\n\n${formatted}`,
        },
      ],
      details: { days, count: events.length },
    };
  },
});
