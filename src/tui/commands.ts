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
import { getCurrentSessionId } from "../session/index.ts";

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
            sourceSessionId: getCurrentSessionId(),
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
    name: "distill",
    description:
      "Smarter session distill into Proposals. Usage: /distill [decision|lesson|preference|all]",
    completeArg: (completedArgs) => {
      if (completedArgs.length === 0) {
        return ["decision", "lesson", "preference", "all"];
      }
      return [];
    },
    run: async (agent, args) => {
      const kind = (args[0] ?? "all").toLowerCase();
      const types: RecordType[] =
        kind === "all"
          ? ["decision", "lesson", "preference"]
          : kind === "decision" || kind === "lesson" || kind === "preference"
            ? [kind]
            : [];
      if (types.length === 0) {
        return "Usage: /distill [decision|lesson|preference|all]";
      }

      const msgs = (agent.state.messages ?? []).filter(
        (m: { role?: string }) => m.role === "user" || m.role === "assistant",
      );
      if (msgs.length === 0) {
        return "Nothing to distill — conversation is empty.";
      }

      function msgText(m: unknown): string {
        if (!m || typeof m !== "object") return "";
        const content = (m as { content?: unknown }).content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          return content
            .map((p) =>
              typeof p === "string"
                ? p
                : p && typeof p === "object" && "text" in p
                  ? String((p as { text: unknown }).text)
                  : "",
            )
            .join("");
        }
        return "";
      }

      const userTexts = msgs
        .filter((m: { role?: string }) => m.role === "user")
        .map((m) => msgText(m))
        .map((t) => t.trim())
        .filter((t) => t && !t.startsWith("/"));

      type Cand = { type: RecordType; title: string; body: string[]; score: number };
      const cands: Cand[] = [];

      const decisionHints =
        /\b(decide|decided|decision|方針|決定|採用|選ぶ|選んだ|instead of|rather than|will use|にします|に決めた)\b/i;
      const lessonHints =
        /\b(lesson|learned|mistake|avoid|don't|do not|pitfall|学び|教訓|注意|失敗|避ける|壊れた)\b/i;
      const prefHints =
        /\b(prefer|preference|always|never|default|好み|常に|絶対|デフォルト|言語|language)\b/i;

      for (const text of userTexts.slice(-12)) {
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const title = (lines[0] ?? text).slice(0, 80);
        const body = lines.slice(0, 40);
        const lower = text.toLowerCase();

        if (types.includes("decision") && decisionHints.test(text)) {
          cands.push({ type: "decision", title, body, score: 3 + (lower.includes("decide") ? 1 : 0) });
        }
        if (types.includes("lesson") && lessonHints.test(text)) {
          cands.push({ type: "lesson", title, body, score: 3 });
        }
        if (types.includes("preference") && prefHints.test(text)) {
          cands.push({ type: "preference", title, body, score: 2 });
        }
      }

      // Fallback: if nothing matched and type is a single kind, take last 3 user turns
      if (cands.length === 0 && types.length === 1) {
        for (const text of userTexts.slice(-3)) {
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          cands.push({
            type: types[0]!,
            title: (lines[0] ?? text).slice(0, 80),
            body: lines.slice(0, 40),
            score: 1,
          });
        }
      }

      // Dedupe by type+title, keep highest score, cap 8
      cands.sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      const picked: Cand[] = [];
      for (const c of cands) {
        const k = `${c.type}:${c.title}`;
        if (seen.has(k)) continue;
        seen.add(k);
        picked.push(c);
        if (picked.length >= 8) break;
      }

      if (picked.length === 0) {
        return (
          "No distill candidates (no keyword hits). " +
          "Try `/distill decision` after discussing a choice, or use `/capture` manually."
        );
      }

      const created: string[] = [];
      const sessionId = getCurrentSessionId();
      for (const c of picked) {
        try {
          const meta = await createProposal({
            type: c.type,
            title: c.title,
            body: c.body,
            sourceSessionId: sessionId,
          });
          created.push(`${meta.type} \`${meta.id}\` — ${meta.title}`);
        } catch {
          /* skip */
        }
      }

      if (created.length === 0) {
        return "Distill failed to create proposals.";
      }
      return (
        `## Distilled ${created.length} proposal(s)\n\n` +
        created.map((l) => `- ${l}`).join("\n") +
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
        const sessionId = getCurrentSessionId();
        const meta = await createProposal({
          type,
          title,
          body,
          sourceSessionId: sessionId,
        });
        return (
          `## Proposal created (draft only)\n\n` +
          `- **id**: \`${meta.id}\`\n` +
          `- **type**: ${meta.type}\n` +
          `- **title**: ${meta.title}\n` +
          `- **path**: \`${meta.path}\`\n` +
          (sessionId ? `- **source session**: \`${sessionId}\`\n` : "") +
          `\nListed on \`nyanclaw/inbox\`. Live Records are **not** updated until \`/apply ${meta.id}\`.`
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
