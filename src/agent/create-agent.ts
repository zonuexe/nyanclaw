import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai/compat";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { createTools } from "../tools/index.ts";

export interface AgentConfig {
  modelName?: string;
  modelProvider?: string;
}

export function createAgent(config?: AgentConfig): Agent {
  const provider = (config?.modelProvider ?? "anthropic") as any;
  const modelName = config?.modelName ?? "claude-sonnet-4-20250514";

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: getModel(provider, modelName),
      tools: createTools(),
    },
    convertToLlm: (messages) =>
      messages.flatMap((m) => {
        // Pass through standard LLM messages; filter anything else
        if (m.role === "user" || m.role === "assistant" || m.role === "toolResult") {
          return [m];
        }
        return [];
      }),
  });

  return agent;
}
