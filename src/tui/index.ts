import {
  TUI,
  Text,
  Editor,
  ProcessTerminal,
  Container,
  matchesKey,
  Key,
  CombinedAutocompleteProvider,
  type EditorTheme,
  type SlashCommand,
} from "@earendil-works/pi-tui";
import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import { commands, commandAutocompleteItems } from "./commands.ts";

const MINIMAL_EDITOR_HEIGHT = 3;

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

export interface NyanclawTuiOptions {
  agent: Agent;
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

  constructor(opts: NyanclawTuiOptions) {
    this.agent = opts.agent;

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

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case "turn_start":
        // Could show a loading indicator
        break;

      case "message_update":
        // Stream text deltas in real-time
        if (event.assistantMessageEvent.type === "text_delta") {
          const text = event.assistantMessageEvent.delta;
          // Get or update the last assistant message component
          this.updateAssistantResponse(text);
        }
        break;

      case "message_end":
        if (event.message.role === "assistant") {
          this.finalizeAssistantResponse();
        }
        break;

      case "agent_end":
        // Agent finished processing — nothing extra needed
        break;
    }
  }

  private assistantResponseText = "";
  private assistantTextComponent: Text | null = null;

  private updateAssistantResponse(delta: string): void {
    this.assistantResponseText += delta;

    if (!this.assistantTextComponent) {
      this.assistantTextComponent = new Text(this.assistantResponseText, 1, 0);
      this.messageContainer.addChild(this.assistantTextComponent);
    } else {
      this.assistantTextComponent.setText(this.assistantResponseText);
    }

    this.tui.requestRender();
  }

  private finalizeAssistantResponse(): void {
    this.assistantResponseText = "";
    this.assistantTextComponent = null;
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
