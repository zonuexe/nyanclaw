import { Type } from "typebox";
import { execSync } from "node:child_process";

// Helper to define tools — same shape as gh.ts
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

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const calendarReadEvents = defineTool({
  name: "calendar_read_events",
  label: "Read Calendar Events",
  description: "Read macOS Calendar events for today or a date range. Read-only.",
  parameters: Type.Object({
    days: Type.Optional(
      Type.Number({ description: "Number of days to look ahead (default: 1 = today only)" }),
    ),
    calendar: Type.Optional(
      Type.String({ description: "Calendar name filter (default: all calendars)" }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const days = (params.days as number | undefined) ?? 1;
    const calendarName = params.calendar as string | undefined;
    const now = new Date();
    const startDate = formatDate(now);
    const end = new Date(now);
    end.setDate(end.getDate() + days);
    const endDate = formatDate(end);

    try {
      const script = `
      const app = Application('Calendar');
      app.includeStandardAdditions = true;
      const calendars = app.calendars.whose({ name: "${calendarName ?? ""}" || true });
      const start = new Date("${startDate}T00:00:00");
      const end = new Date("${endDate}T23:59:59");
      const events = [];
      for (const cal of calendars()) {
        for (const ev of cal.events.whose({ startDate: start, endDate: end })()) {
          events.push({
            summary: ev.summary(),
            startDate: ev.startDate().toISOString(),
            endDate: ev.endDate().toISOString(),
            calendar: cal.name(),
          });
        }
      }
      JSON.stringify(events);
      `;

      const output = execSync(`osascript -l JavaScript -e '${script}'`, {
        encoding: "utf-8",
        timeout: 5000,
      });

      const events = JSON.parse(output.trim());
      const formatted = events.length === 0
        ? "No events found."
        : events.map((e: { summary: string; startDate: string; endDate: string; calendar: string }) =>
            `- ${e.summary} (${e.startDate.slice(0, 16)} - ${e.endDate.slice(0, 16)}, ${e.calendar})`
          ).join("\n");

      return {
        content: [{ type: "text", text: formatted }],
        details: { events, startDate, endDate },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Application") || msg.includes("not")) {
        return {
          content: [{ type: "text", text: `Calendar not accessible: ${msg}` }],
          details: { error: msg },
        };
      }
      throw err;
    }
  },
});
