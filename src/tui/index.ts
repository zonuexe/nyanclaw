import {
  TUI,
  Text,
  Editor,
  Markdown,
  ProcessTerminal,
  Container,
  matchesKey,
  Key,
  CombinedAutocompleteProvider,
  type EditorTheme,
  type SlashCommand,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import { commands, commandAutocompleteItems } from "./commands.ts";

const MINIMAL_EDITOR_HEIGHT = 3;

const markdownTheme: MarkdownTheme = {
  heading: (s) => `\x1b[1m\x1b[38;5;39m${s}\x1b[39m\x1b[22m`,
  link: (s) => `\x1b[4m\x1b[38;5;33m${s}\x1b[39m\x1b[24m`,
  linkUrl: (s) => `\x1b[38;5;33m${s}\x1b[39m`,
  code: (s) => `\x1b[48;5;236m\x1b[38;5;203m${s}\x1b[39m\x1b[49m`,
  codeBlock: (s) => `\x1b[48;5;236m\x1b[38;5;180m${s}\x1b[39m\x1b[49m`,
  codeBlockBorder: (s) => `\x1b[38;5;240m${s}\x1b[39m`,
  quote: (s) => `\x1b[38;5;245m${s}\x1b[39m`,
  quoteBorder: (s) => `\x1b[38;5;240m${s}\x1b[39m`,
  hr: (s) => `\x1b[38;5;240m${s}\x1b[39m`,
  listBullet: (s) => `\x1b[38;5;39m${s}\x1b[39m`,
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  italic: (s) => `\x1b[3m${s}\x1b[23m`,
  strikethrough: (s) => `\x1b[9m${s}\x1b[29m`,
  underline: (s) => `\x1b[4m${s}\x1b[24m`,
};

/**
 * Minimal theme for the editor.
 */
const editorTheme: EditorTheme = {
  borderColor: (s) => `\x1b[38;5;67m${s}\x1b[39m`,
  selectList: {
    selectedPrefix: (s) => `\x1b[48;5;236m\x1b[38;5;39m${s}\x1b[39m\x1b[49m`,
    selectedText: (s) => `\x1b[38;5;39m${s}\x1b[39m`,
    description: (s) => `\x1b[38;5;245m${s}\x1b[39m`,
    scrollInfo: (s) => `\x1b[38;5;245m${s}\x1b[39m`,
    noMatch: (s) => `\x1b[38;5;240m${s}\x1b[39m`,
  },
};

import type { Config } from "../config.ts";

export interface NyanclawTuiOptions {
  agent: Agent;
  config: Config;
}

/**
 * nyanclaw TUI application.
 */
export class NyanclawTui {
  private tui: TUI;
  private editor: Editor;
  private messageContainer: Container;
  private agent: Agent;
  private running = true;

  private config: Config;

  constructor(opts: NyanclawTuiOptions) {
    this.agent = opts.agent;
    this.config = opts.config;

    const terminal = new ProcessTerminal();
    this.tui = new TUI(terminal);

    // Message area (scrollable container above editor)
    this.messageContainer = new Container();
    this.tui.addChild(this.messageContainer);

    // Editor at the bottom
    const provider = new CombinedAutocompleteProvider(
      commandAutocompleteItems() as SlashCommand[],
      process.cwd(),
    );

    this.editor = new Editor(this.tui, editorTheme, { paddingX: 1 });
    this.editor.setAutocompleteProvider(provider);
    this.editor.onSubmit = (text) => this.handleSubmit(text);
    this.tui.addChild(this.editor);

    // Focus the editor
    this.tui.setFocus(this.editor);

    // Ctrl+C to exit
    this.tui.addInputListener((data) => {
      if (matchesKey(data, Key.ctrl("c"))) {
        this.running = false;
        this.tui.stop();
        process.exit(0);
      }
      return undefined;
    });

    // Subscribe to agent events to render responses
    this.agent.subscribe((event) => this.handleAgentEvent(event));
  }

  private loadingComponent: Text | null = null;
  private responseStarted = false;

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case "turn_start":
        this.responseStarted = false;
        this.loadingComponent = new Text("Processing...", 0, 0);
        this.messageContainer.addChild(this.loadingComponent);
        this.tui.requestRender();
        break;

      case "message_update":
        if (this.loadingComponent) {
          this.messageContainer.removeChild(this.loadingComponent);
          this.loadingComponent = null;
          this.responseStarted = false;
        }
        if (event.assistantMessageEvent.type === "text_delta" && !this.responseStarted) {
          this.responseStarted = true;
        }
        if (event.assistantMessageEvent.type === "text_delta") {
          this.updateAssistantResponse(event.assistantMessageEvent.delta);
        }
        break;

      case "message_end":
        if (event.message.role === "assistant") {
          this.finalizeAssistantResponse();
        }
        break;

      case "agent_end":
        this.responseStarted = false;
        if (this.loadingComponent) {
          this.messageContainer.removeChild(this.loadingComponent);
          this.loadingComponent = null;
          this.tui.requestRender();
        }
        break;
    }
  }

  private assistantResponseText = "";
  private assistantMdComponent: Markdown | null = null;

  private updateAssistantResponse(delta: string): void {
    this.assistantResponseText += delta;

    if (!this.assistantMdComponent) {
      this.assistantMdComponent = new Markdown(this.assistantResponseText, 1, 0, markdownTheme);
      this.messageContainer.addChild(this.assistantMdComponent);
    } else {
      this.assistantMdComponent.setText(this.assistantResponseText);
    }

    this.tui.requestRender();
  }

  private finalizeAssistantResponse(): void {
    this.assistantResponseText = "";
    this.assistantMdComponent = null;
    this.tui.requestRender();
  }

  /**
   * Handle editor submission.
   */
  private async handleSubmit(text: string): Promise<void> {
    this.editor.addToHistory(text);
    this.editor.setText("");

    // Show the user's message
    const userMsg = new Text(`> ${text}`, 1, 0);
    this.messageContainer.addChild(userMsg);
    this.tui.requestRender();

    // Check for /commands
    if (text.startsWith("/")) {
      const parts = text.slice(1).split(/\s+/);
      const cmdName = parts[0];
      const args = parts.slice(1);
      const cmd = commands.find((c) => c.name === cmdName);
      if (cmd) {
        const result = await cmd.run(this.agent, args);
        if (result) {
          // Show command result
          const resultText = new Text(result, 1, 0);
          this.messageContainer.addChild(resultText);
          this.tui.requestRender();
        }
        return;
      }
    }

    // Send to agent
    try {
      await this.agent.prompt(text);
    } catch (err) {
      const errorMsg = new Text(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        1,
        0,
      );
      this.messageContainer.addChild(errorMsg);
      this.tui.requestRender();
    }
  }

  start(): void {
    const welcome = new Text("Welcome to nyanclaw. Type /help for commands.", 1, 0);
    this.messageContainer.addChild(welcome);
    this.tui.requestRender();
    this.tui.start();
  }
}
