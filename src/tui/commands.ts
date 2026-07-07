import type { Agent } from "@earendil-works/pi-agent-core";
import type { AutocompleteItem, SlashCommand } from "@earendil-works/pi-tui";
import { deleteKeychainKey } from "../keychain.ts";
import { loadConfig } from "../config.ts";
import { runOnboarding } from "../persona/interview.ts";

export interface CommandDef {
  name: string;
  description: string;
  run: (agent: Agent, args: string[]) => Promise<string>;
}

/**
 * Built-in slash commands for nyanclaw.
 */
export const commands: CommandDef[] = [
  {
    name: "help",
    description: "Show available commands",
    run: async (_agent, _args) => {
      const lines = commands.map((c) => `- **/${c.name}** — ${c.description}`);
      return `## Available commands\n\n${lines.join("\n")}`;
    },
  },
  {
    name: "sync-gh",
    description: "Sync GitHub Issues and PRs into Logseq",
    run: async (agent, _args) => {
      // Trigger the agent to run GitHub sync
      agent.followUp({
        role: "user",
        content:
          "Please sync my GitHub Issues and PRs. List my open issues (both created and assigned) and my open PRs, then write a summary to today's Logseq journal.",
        timestamp: Date.now(),
      });
      return "GitHub sync triggered. The agent will process it after the current turn.";
    },
  },
  {
    name: "clear",
    description: "Clear the conversation history",
    run: async (agent, _args) => {
      agent.reset();
      return "Conversation cleared.";
    },
  },
  {
    name: "journal",
    description: "Show today's Logseq journal",
    run: async (agent, _args) => {
      agent.followUp({
        role: "user",
        content: "Please read today's Logseq journal and show me the contents.",
        timestamp: Date.now(),
      });
      return "Reading journal...";
    },
  },
  {
    name: "onboard",
    description: "Re-run the onboarding interview to update USER.md and SOUL.md.",
    run: async (_agent, _args) => {
      await runOnboarding();
      return "Onboarding complete. Restart nyanclaw for changes to take effect.";
    },
  },
  {
    name: "reset-key",
    description: "Delete the stored API key from Keychain and exit. Restart to re-enter it.",
    run: async (_agent, args) => {
      const provider = args[0] ?? loadConfig().profiles[loadConfig().defaultProfile].provider;
      deleteKeychainKey(provider);
      return `API key for "${provider}" removed from Keychain. Restart nyanclaw to re-enter it.`;
    },
  },
];

export function commandAutocompleteItems(): (AutocompleteItem | SlashCommand)[] {
  return commands.map((c) => ({
    name: c.name,
    description: c.description,
    value: c.name,
    label: c.name,
  }));
}
