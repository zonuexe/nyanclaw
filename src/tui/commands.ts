import type { Agent } from "@earendil-works/pi-agent-core";
import type { AutocompleteItem, SlashCommand } from "@earendil-works/pi-tui";
import { deleteKeychainKey } from "../keychain.ts";
import { loadConfig, type Config } from "../config.ts";
import { runOnboarding } from "../persona/interview.ts";
import { ghSyncAll } from "../tools/gh-sync.ts";
import {
  applyProposal,
  createProposal,
  listPendingProposals,
  rejectProposal,
  type RecordType,
} from "../records/index.ts";

export interface CommandDef {
  name: string;
  description: string;
  run: (agent: Agent, args: string[]) => Promise<string>;
  /**
   * Return the candidate values for the next argument position.
   *
   * `completedArgs` are the arguments already fully typed (not including the
   * partial token the user is currently editing). Return the full candidate
   * list for that position; the UI filters it by the current prefix. Return
   * an empty array (or omit the function) when there is nothing to complete.
   */
  completeArg?: (completedArgs: string[]) => string[];
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
    name: "bye",
    description:
      "End session: offer to draft Record Proposals from this conversation (one-shot offer)",
    run: async (agent, args) => {
      const force = args[0] === "yes" || args[0] === "-y";
      // Heuristic: skip empty sessions
      const msgs = (agent.state.messages ?? []).filter(
        (m: { role?: string }) => m.role === "user" || m.role === "assistant",
      );
      if (msgs.length === 0) {
        return "Session empty — nothing to capture. Goodbye.";
      }
      if (!force) {
        return (
          `## Session end\n\n` +
          `This session has **${msgs.length}** user/assistant messages.\n\n` +
          `Draft candidate Record Proposals into the inbox?\n` +
          `- \`/bye yes\` — create pending decision/lesson/preference candidates from recent user lines\n` +
          `- Or run \`/capture <type> <title>\` yourself, then leave.\n\n` +
          `Nothing is written until you confirm.`
        );
      }
      // Lightweight candidate extraction: last few user messages as decision drafts
      const users = msgs
        .filter((m: { role?: string }) => m.role === "user")
        .slice(-5);
      const created: string[] = [];
      for (const m of users) {
        const content = (m as { content?: unknown }).content;
        let text = "";
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          text = content
            .map((p) =>
              typeof p === "string"
                ? p
                : p && typeof p === "object" && "text" in p
                  ? String((p as { text: unknown }).text)
                  : "",
            )
            .join("");
        }
        text = text.trim();
        if (!text || text.startsWith("/")) continue;
        const title = text.split("\n")[0]!.slice(0, 80);
        try {
          const meta = await createProposal({
            type: "decision",
            title,
            body: text.split("\n").slice(0, 40),
          });
          created.push(meta.id);
        } catch {
          /* skip bad lines */
        }
      }
      if (created.length === 0) {
        return "No candidate proposals created (nothing suitable). Review with /inbox.";
      }
      return (
        `## Drafted ${created.length} proposal(s)\n\n` +
        created.map((id) => `- \`${id}\``).join("\n") +
        `\n\nReview with \`/inbox\`, then \`/apply\` or \`/reject\`.`
      );
    },
  },
  {
    name: "capture",
    description:
      "Draft a Record Proposal (not live). Usage: /capture decision|lesson|preference|quote <title> [| body...]",
    completeArg: (completedArgs) => {
      if (completedArgs.length === 0) {
        return ["decision", "lesson", "preference", "quote", "note"];
      }
      return [];
    },
    run: async (_agent, args) => {
      const typeRaw = (args[0] ?? "decision").toLowerCase();
      const allowed: RecordType[] = ["decision", "lesson", "preference", "quote", "note"];
      if (!allowed.includes(typeRaw as RecordType)) {
        return `Unknown type "${typeRaw}". Use: ${allowed.join(", ")}`;
      }
      const type = typeRaw as RecordType;
      const rest = args.slice(1).join(" ").trim();
      if (!rest) {
        return "Usage: /capture <type> <title> [| optional body paragraph...]";
      }
      const [titlePart, ...bodyParts] = rest.split("|").map((s) => s.trim());
      const title = titlePart || "Untitled";
      const body =
        bodyParts.length > 0
          ? bodyParts.join("\n").split("\n").map((l) => l.trim())
          : [];
      try {
        const meta = await createProposal({ type, title, body });
        return (
          `## Proposal created (draft only)\n\n` +
          `- **id**: \`${meta.id}\`\n` +
          `- **type**: ${meta.type}\n` +
          `- **title**: ${meta.title}\n` +
          `- **path**: \`${meta.path}\`\n\n` +
          `Listed on \`nyanclaw/inbox\`. Live Records are **not** updated until \`/apply ${meta.id}\`.`
        );
      } catch (err) {
        return `Capture failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "inbox",
    description: "List pending Record Proposals",
    run: async (_agent, _args) => {
      try {
        const pending = await listPendingProposals();
        if (pending.length === 0) return "Inbox is empty (no pending proposals).";
        const lines = pending.map(
          (p) => `- \`${p.id}\` **${p.type}**: ${p.title}`,
        );
        return `## Pending proposals\n\n${lines.join("\n")}\n\n\`/apply <id>\` or \`/reject <id>\`.`;
      } catch (err) {
        return `Inbox failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "apply",
    description: "Apply a pending Proposal to a live Record. Usage: /apply <id>",
    run: async (_agent, args) => {
      const id = args[0];
      if (!id) return "Usage: /apply <proposal-id>";
      try {
        const r = await applyProposal(id);
        return (
          `## Applied\n\n- **proposal**: \`${id}\`\n- **record**: \`${r.recordPath}\`\n\nAudit logged under nyanclaw/audit.`
        );
      } catch (err) {
        return `Apply failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "reject",
    description: "Reject a pending Proposal. Usage: /reject <id>",
    run: async (_agent, args) => {
      const id = args[0];
      if (!id) return "Usage: /reject <proposal-id>";
      try {
        await rejectProposal(id);
        return `Rejected proposal \`${id}\`.`;
      } catch (err) {
        return `Reject failed: ${err instanceof Error ? err.message : String(err)}`;
      }
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
    completeArg: (completedArgs) => {
      // Only the first argument (the profile name) is completable.
      if (completedArgs.length > 0) return [];
      return ["list", ...Object.keys(loadConfig().profiles)];
    },
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
    completeArg: (completedArgs) => {
      // Only the first argument (the provider) is completable.
      if (completedArgs.length > 0) return [];
      const config = loadConfig();
      const providers = Object.values(config.profiles).map((p) => p.provider);
      return [...new Set(providers)];
    },
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
