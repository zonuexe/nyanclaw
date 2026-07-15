import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { Agent } from "@earendil-works/pi-agent-core";
import type { Config } from "../config.ts";
import { App } from "./App.tsx";

export interface NyanclawOpenTuiOptions {
  agent: Agent;
  config: Config;
}

/**
 * OpenTUI (React) front-end for nyanclaw.
 *
 * This is the experimental replacement for the legacy pi-tui UI in
 * `src/tui/index.ts`. Enable it by setting NYANCLAW_TUI=opentui.
 */
export class NyanclawOpenTui {
  private readonly agent: Agent;
  private readonly config: Config;

  constructor(opts: NyanclawOpenTuiOptions) {
    this.agent = opts.agent;
    this.config = opts.config;
  }

  async start(): Promise<void> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false, // handled inside App for graceful shutdown
      targetFps: 30,
    });
    createRoot(renderer).render(<App agent={this.agent} config={this.config} />);
    renderer.start();
  }
}
