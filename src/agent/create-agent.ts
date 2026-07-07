import { Agent } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { createTools } from "../tools/index.ts";
import { buildModels } from "./models.ts";
import { loadBootstrapPrompt } from "./bootstrap.ts";
import type { ModelProfile } from "../config.ts";

export async function createAgent(profile: ModelProfile): Promise<Agent> {
  const { models, model } = await buildModels(profile.provider, profile.model);
  const bootstrap = loadBootstrapPrompt();

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT + bootstrap,
      model,
      tools: createTools(),
    },
    convertToLlm: (messages) =>
      messages.flatMap((m) => {
        if (m.role === "user" || m.role === "assistant" || m.role === "toolResult") {
          return [m];
        }
        return [];
      }),
  });

  (agent as any).__models = models;
  (agent as any).__model = model;

  return agent;
}
