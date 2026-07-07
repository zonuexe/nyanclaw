#!/usr/bin/env bun
import * as readline from "node:readline";
import { Writable } from "node:stream";
import { loadConfig } from "./config.ts";
import { createAgent } from "./agent/create-agent.ts";
import { NyanclawTui } from "./tui/index.ts";
import { getKeychainKey, setKeychainKey } from "./keychain.ts";

async function main() {
  const config = loadConfig();
  const profile = config.profiles[config.defaultProfile];

  const existing = getKeychainKey(profile.provider);
  if (!existing) {
    const key = await promptApiKey(profile.provider);
    setKeychainKey(profile.provider, key);
  }

  const agent = await createAgent(profile);
  const tui = new NyanclawTui({ agent, config });

  try {
    const { execSync } = await import("node:child_process");
    execSync("gh --version", { encoding: "utf-8", timeout: 2000 });
    agent.followUp({
      role: "user",
      content:
        "Please sync my GitHub activity: fetch my open Issues and PRs, then write a summary to today's Logseq journal.",
      timestamp: Date.now(),
    });
  } catch {}

  tui.start();
}

async function promptApiKey(provider: string): Promise<string> {
  process.stderr.write(`\nnyanclaw: Enter API key for "${provider}": `);
  const muted = new Writable({ write(_c, _e, cb) { cb(); } });
  const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve) => {
    rl.question("", (key) => {
      rl.close();
      process.stderr.write("\n");
      resolve(key.trim());
    });
  });
}

main().catch((err) => {
  console.error("nyanclaw:", err);
  process.exit(1);
});
