import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { ScrollBoxRenderable, KeyEvent } from "@opentui/core";
import { estimateTokens } from "@earendil-works/pi-agent-core";
import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { Config } from "../config.ts";
import { commands } from "../tui/commands.ts";
import { SessionRecorder, setCurrentSession } from "../session/index.ts";
import { palette, syntaxStyle } from "./theme.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type Line =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string }
  | { kind: "system"; id: number; text: string }
  | { kind: "error"; id: number; text: string };

export interface AppProps {
  agent: Agent;
  config: Config;
}

let _lineId = 0;
const nextId = () => ++_lineId;

export function App({ agent, config }: AppProps): React.ReactNode {
  const renderer = useRenderer();
  const [lines, setLines] = useState<Line[]>([
    { kind: "system", id: nextId(), text: "Welcome to nyanclaw (OpenTUI). Type /help for commands." },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [processing, setProcessing] = useState(false);
  const [spinner, setSpinner] = useState(0);
  const [statusVersion, setStatusVersion] = useState(0);

  const scrollRef = useRef<ScrollBoxRenderable>(null);
  // Index of the streaming assistant line, or null when not streaming.
  const streamingIdRef = useRef<number | null>(null);
  const sessionRef = useRef(new SessionRecorder());

  useEffect(() => {
    setCurrentSession(sessionRef.current);
    return () => setCurrentSession(null);
  }, []);

  // --- agent event subscription -------------------------------------------
  useEffect(() => {
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case "turn_start":
          setProcessing(true);
          break;

        case "message_update": {
          const ev = event.assistantMessageEvent;
          if (ev.type === "text_delta") {
            setProcessing(false);
            appendAssistantDelta(ev.delta);
          }
          break;
        }

        case "message_end":
          if (event.message.role === "assistant") {
            streamingIdRef.current = null;
            setStatusVersion((v) => v + 1);
          }
          break;

        case "agent_end":
          setProcessing(false);
          setStatusVersion((v) => v + 1);
          void sessionRef.current.flushFromAgent(agent);
          break;
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const appendAssistantDelta = useCallback((delta: string) => {
    setLines((prev) => {
      const id = streamingIdRef.current;
      if (id !== null) {
        return prev.map((l) =>
          l.id === id && l.kind === "assistant" ? { ...l, text: l.text + delta } : l,
        );
      }
      const newId = nextId();
      streamingIdRef.current = newId;
      return [...prev, { kind: "assistant", id: newId, text: delta }];
    });
  }, []);

  // --- spinner animation ---------------------------------------------------
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => setSpinner((s) => (s + 1) % SPINNER_FRAMES.length), 100);
    return () => clearInterval(t);
  }, [processing]);

  // --- autoscroll to bottom on new content --------------------------------
  useEffect(() => {
    const sb = scrollRef.current;
    if (sb) {
      try {
        sb.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
      } catch {
        // best-effort; ignore if API differs
      }
    }
  }, [lines]);

  // --- graceful shutdown ---------------------------------------------------
  // NOTE: renderer.stop() only halts the render loop; it does NOT restore the
  // terminal. OpenTUI puts the terminal into Kitty keyboard / raw mode, and
  // only renderer.destroy() tears that down. Skipping destroy() leaves the
  // terminal in Kitty mode, so subsequent keypresses leak escape sequences
  // like "9;5u" (CSI-u encoded Ctrl+I etc.) into the shell.
  const shutdown = useCallback(
    (code = 0) => {
      try {
        if (!renderer.isDestroyed) {
          renderer.setTerminalTitle("");
          renderer.destroy();
        }
      } catch {
        // best-effort; still exit
      }
      process.exit(code);
    },
    [renderer],
  );

  // Restore the terminal on process-level exit paths too (SIGINT/SIGTERM,
  // uncaught errors), not just the in-app Ctrl+C handler.
  useEffect(() => {
    const onSignal = () => shutdown(0);
    const onExit = () => {
      try {
        if (!renderer.isDestroyed) renderer.destroy();
      } catch {
        // ignore
      }
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    process.on("SIGHUP", onSignal);
    process.on("exit", onExit);
    return () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("SIGHUP", onSignal);
      process.off("exit", onExit);
    };
  }, [renderer, shutdown]);

  const pushLine = useCallback((line: Omit<Line, "id">) => {
    setLines((prev) => [...prev, { ...line, id: nextId() } as Line]);
  }, []);

  // --- slash command / argument suggestions -------------------------------
  const completion = computeCompletion(inputValue);

  const completeFirstSuggestion = useCallback((): boolean => {
    const first = completion.suggestions[0];
    if (first === undefined) return false;
    setInputValue(applySuggestion(inputValue, completion, first.value));
    return true;
  }, [inputValue, completion]);

  // --- global keys ---------------------------------------------------------
  useKeyboard((key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      shutdown(0);
      return;
    }

    if (key.name === "tab" && completeFirstSuggestion()) {
      key.preventDefault();
      key.stopPropagation();
    }
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      setInputValue("");
      if (!trimmed) return;

      pushLine({ kind: "user", text: trimmed });

      if (trimmed.startsWith("/")) {
        const parts = trimmed.slice(1).split(/\s+/);
        const cmdName = parts[0];
        const args = parts.slice(1);
        let cmd = commands.find((c) => c.name === cmdName);
        if (!cmd) cmd = commands.find((c) => c.name.startsWith(cmdName));
        if (cmd) {
          try {
            const result = await cmd.run(agent, args);
            if (result) pushLine({ kind: "assistant", text: result });
          } catch (err) {
            pushLine({ kind: "error", text: errMsg(err) });
          }
          setStatusVersion((v) => v + 1);
          return;
        }
      }

      try {
        await agent.prompt(trimmed);
      } catch (err) {
        pushLine({ kind: "error", text: errMsg(err) });
      }
    },
    [agent, pushLine],
  );

  const status = buildStatus(agent, config, statusVersion);

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, backgroundColor: palette.bg }}>
      {/* Conversation area */}
      <scrollbox
        ref={scrollRef}
        style={{
          flexGrow: 1,
          rootOptions: { backgroundColor: palette.bg },
          viewportOptions: { backgroundColor: palette.bg },
          contentOptions: { backgroundColor: palette.bg, paddingLeft: 1, paddingRight: 1 },
          scrollbarOptions: { trackOptions: { foregroundColor: palette.faint } },
        }}
      >
        {lines.map((line) => (
          <MessageLine key={line.id} line={line} />
        ))}
        {processing && (
          <text fg={palette.accent}>{`${SPINNER_FRAMES[spinner]} Processing...`}</text>
        )}
      </scrollbox>

      {/* Slash command / argument hints */}
      {completion.suggestions.length > 0 && (
        <box style={{ flexDirection: "column", paddingLeft: 1, backgroundColor: palette.bgAlt }}>
          {completion.suggestions.slice(0, 8).map((s, i) => (
            <text key={s.value} bg={palette.bgAlt} wrapMode="none">
              <span fg={i === 0 ? palette.userPrompt : palette.accent} bg={palette.bgAlt}>
                {s.label}
              </span>
              {s.description ? (
                <span fg={i === 0 ? palette.dim : palette.faint} bg={palette.bgAlt}>
                  {`  ${s.description}`}
                </span>
              ) : null}
            </text>
          ))}
        </box>
      )}

      {/* Editor */}
      <box style={{ border: true, borderColor: palette.accentDim, height: 3 }}>
        <input
          focused
          placeholder="Message nyanclaw…  (/help for commands)"
          value={inputValue}
          onInput={setInputValue}
          onSubmit={handleSubmit as never}
        />
      </box>

      {/* Status bar */}
      <box style={{ paddingLeft: 1, paddingRight: 1, justifyContent: "flex-end" }}>
        <text fg={palette.dim}>{status}</text>
      </box>
    </box>
  );
}

interface Suggestion {
  /** The value inserted when this suggestion is applied. */
  value: string;
  /** Text shown in the hint list. */
  label: string;
  description?: string;
}

type Completion =
  | { kind: "none"; suggestions: [] }
  | { kind: "command"; suggestions: Suggestion[] }
  | { kind: "arg"; command: string; completedArgs: string[]; partial: string; suggestions: Suggestion[] };

/**
 * Compute completion suggestions for the current input.
 *
 * - `/prefix`            → complete the command name.
 * - `/cmd arg1 partial`  → complete the current argument value via the
 *   command's `completeArg` hook, filtered by `partial`.
 */
function computeCompletion(input: string): Completion {
  if (!input.startsWith("/")) return { kind: "none", suggestions: [] };

  const body = input.slice(1);

  // Still typing the command name (no space yet).
  if (!body.includes(" ")) {
    const suggestions = commands
      .filter((c) => c.name.startsWith(body))
      .map((c) => ({ value: c.name, label: `/${c.name}`, description: c.description }));
    return { kind: "command", suggestions };
  }

  // Typing arguments.
  const parts = body.split(" ");
  const cmdName = parts[0];
  const command = commands.find((c) => c.name === cmdName);
  if (!command?.completeArg) return { kind: "none", suggestions: [] };

  // Tokens after the command name. The last one is the partial being edited;
  // everything before it is a completed argument.
  const argTokens = parts.slice(1);
  const partial = argTokens[argTokens.length - 1] ?? "";
  const completedArgs = argTokens.slice(0, -1);

  const candidates = command.completeArg(completedArgs);
  const suggestions = candidates
    .filter((v) => v.startsWith(partial))
    .map((v) => ({ value: v, label: v }));

  return { kind: "arg", command: cmdName, completedArgs, partial, suggestions };
}

/** Build the new input string when a suggestion is accepted. */
function applySuggestion(input: string, completion: Completion, value: string): string {
  if (completion.kind === "command") {
    return `/${value} `;
  }
  if (completion.kind === "arg") {
    const prefix = [`/${completion.command}`, ...completion.completedArgs].join(" ");
    return `${prefix} ${value} `;
  }
  return input;
}

function MessageLine({ line }: { line: Line }): React.ReactNode {
  switch (line.kind) {
    case "user":
      return (
        <text>
          <span fg={palette.userPrompt}>{"❯ "}</span>
          {line.text}
        </text>
      );
    case "assistant":
      return (
        <markdown
          content={line.text}
          syntaxStyle={syntaxStyle}
          fg="#c0caf5"
          streaming
        />
      );
    case "system":
      return <text fg={palette.dim}>{line.text}</text>;
    case "error":
      return <text fg={palette.error}>{`Error: ${line.text}`}</text>;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildStatus(agent: Agent, config: Config, _version: number): string {
  const messages = agent.state.messages;
  const model = agent.state.model;
  const ctxTotal = model?.contextWindow ?? 128000;

  let used = 0;
  for (const msg of messages) {
    try {
      used += estimateTokens(msg as never);
    } catch {
      used += 100;
    }
  }

  const pct = ctxTotal > 0 ? Math.round((used / ctxTotal) * 100) : 0;
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  const ctx = `${fmt(used)} / ${fmt(ctxTotal)} (${pct}%)`;
  const modelStr = `${config.defaultProfile}  ${model?.provider ?? "?"}/${model?.id ?? "?"}`;
  return `${ctx}  |  ${modelStr}`;
}
