import { Type } from "typebox";
import { askGrok, isGrokAvailable, defaultGrokModel } from "../grok/client.ts";

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

/**
 * Delegate current-events / X (Twitter) / web-aware questions to the Grok CLI.
 * Primary nyanclaw model (e.g. DeepSeek) stays for tools & Logseq; Grok for freshness.
 */
export const askGrokTool = defineTool({
  name: "ask_grok",
  label: "Ask Grok (web/X)",
  description:
    "Ask Grok (xAI CLI) a question that needs up-to-date web or X (Twitter) knowledge. " +
    "Use for: explaining a tweet/X URL, recent news, public posts, current events. " +
    "Do NOT use for Logseq writes, local git, or routine task management — use nyanclaw tools instead. " +
    "Pass the full question in `prompt`; put tweet/article links in `url` when relevant.",
  parameters: Type.Object({
    prompt: Type.String({
      description:
        "Question for Grok in the user's language (e.g. このツイートの背景を説明して)",
    }),
    url: Type.Optional(
      Type.String({
        description: "Optional https://x.com/... or https://twitter.com/... or web URL",
      }),
    ),
    model: Type.Optional(
      Type.String({
        description: `Grok model id (default from config / ${defaultGrokModel()})`,
      }),
    ),
  }),
  execute: async (_id, params) => {
    if (!isGrokAvailable()) {
      return {
        content: [
          {
            type: "text",
            text:
              "ask_grok: Grok CLI not found or not runnable. Install from https://x.ai/cli and run `grok login`.",
          },
        ],
        details: { error: "grok_unavailable" },
      };
    }

    const prompt = String(params.prompt ?? "").trim();
    if (!prompt) {
      return {
        content: [{ type: "text", text: "ask_grok: prompt is required." }],
        details: { error: "empty_prompt" },
      };
    }

    const url = params.url ? String(params.url).trim() : undefined;
    const model = params.model ? String(params.model) : undefined;

    const result = askGrok({ prompt, url, model });
    if (!result.ok) {
      return {
        content: [
          {
            type: "text",
            text: `ask_grok failed (${result.durationMs}ms, model=${result.model}): ${result.error}`,
          },
        ],
        details: result,
      };
    }

    return {
      content: [
        {
          type: "text",
          text:
            `## Grok (${result.model})\n\n` +
            result.text +
            `\n\n_via \`${result.bin}\` · ${result.durationMs}ms_`,
        },
      ],
      details: {
        model: result.model,
        bin: result.bin,
        durationMs: result.durationMs,
        url,
      },
    };
  },
});
