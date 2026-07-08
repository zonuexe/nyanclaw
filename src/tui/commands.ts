import type { Agent } from "@earendil-works/pi-agent-core";
import type { AutocompleteItem, SlashCommand } from "@earendil-works/pi-tui";
import { deleteKeychainKey } from "../keychain.ts";
import { loadConfig, type Config } from "../config.ts";
import { runOnboarding } from "../persona/interview.ts";
import { ghSyncAll } from "../tools/gh-sync.ts";

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
    description: "Sync GitHub: fetch watched repos news + maintained issues into Logseq",
    run: async (_agent, _args) => {
      const result = await ghSyncAll.execute("", {});
      return result.content[0]?.text || "gh_sync_all completed.";
    },
  },
  {
    name: "gh-sync-all",
    description: "Alias for sync-gh",
    run: async (_agent, _args) => {
      const result = await ghSyncAll.execute("", {});
      return result.content[0]?.text || "gh_sync_all completed.";
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
    name: "model",
    description: "Show current model profile or switch to another. Usage: /model, /model list, /model <profile-name>",
    run: async (agent, args) => {
      const config = loadConfig();
      const names = Object.keys(config.profiles);
      const currentKey = config.defaultProfile;
      const current = config.profiles[currentKey];

      if (args.length === 0 || args[0] === "list") {
        const lines = names.map((n) => {
          const p = config.profiles[n];
          const mark = n === currentKey ? " *" : " ";
          return `- **${n}**${mark} — \`${p.provider}/${p.model}\``;
        });
        return `## Model Profiles\n\n${lines.join("\n")}\n\nCurrent: **${currentKey}** (\`${current.provider}/${current.model}\`)\n\nSwitch with: \`/model <name>\``;
      }

      const target = args[0];
      const profile = config.profiles[target];
      if (!profile) {
        return `Profile "${target}" not found. Available: ${names.join(", ")}`;
      }

      // Switch the agent's model — next turn uses the new one
      const models = (agent as any).__models;
      if (!models) return "Error: models not available.";
      const newModel = models.getModel(profile.provider as any, profile.model);
      if (!newModel) return `Model "${profile.provider}/${profile.model}" not found in catalog.`;
      agent.state.model = newModel;
      config.defaultProfile = target;
      return `Switched to profile **${target}** (\`${profile.provider}/${profile.model}\`). Next turn will use this model.`;
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
  return commands.map((c) => ({ name: c.name, description: c.description }));
}
