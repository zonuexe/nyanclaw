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

export const systemNow = defineTool({
  name: "system_now",
  label: "Current Date & Time",
  description: "Get the current date, time, and timezone from the system clock.",
  parameters: Type.Object({
    format: Type.Optional(
      Type.Union(
        [Type.Literal("full"), Type.Literal("date"), Type.Literal("iso")],
        { description: "Output format", default: "full" },
      ),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const format = (params.format as string) ?? "full";
    const now = new Date();

    let text: string;
    if (format === "iso") {
      text = now.toISOString();
    } else if (format === "date") {
      text = now.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } else {
      text = now.toLocaleString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
    }

    return {
      content: [{ type: "text", text }],
      details: {
        iso: now.toISOString(),
        unix: Math.floor(now.getTime() / 1000),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };
  },
});
