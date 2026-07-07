#!/usr/bin/env bun
import { createAgent } from "./agent/create-agent.ts";
import { NyanclawTui } from "./tui/index.ts";

const agent = createAgent({
  modelProvider: process.env.NYANCLAW_PROVIDER ?? "anthropic",
  modelName: process.env.NYANCLAW_MODEL ?? "claude-sonnet-4-20250514",
});

const tui = new NyanclawTui({ agent });

tui.start();
