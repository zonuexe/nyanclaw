#!/usr/bin/env bun
import * as readline from "node:readline";
import { Writable } from "node:stream";
import { createAgent } from "./agent/create-agent.ts";
import { NyanclawTui } from "./tui/index.ts";
import { getKeychainKey, setKeychainKey } from "./keychain.ts";

const PROVIDER = process.env.NYANCLAW_PROVIDER ?? "opencode-go";
const MODEL = process.env.NYANCLAW_MODEL ?? "deepseek-v4-flash";
const ENV_KEY_MAP: Record<string, string> = {
  "opencode-go": "OPENCODE_API_KEY",
  "openai": "OPENAI_API_KEY",
  "anthropic": "ANTHROPIC_API_KEY",
  "deepseek": "DEEPSEEK_API_KEY",
  "groq": "GROQ_API_KEY",
  "openrouter": "OPENROUTER_API_KEY",
};

async function resolveApiKey(provider: string): Promise<string> {
  const fromKeychain = getKeychainKey(provider);
  if (fromKeychain) return fromKeychain;

  const envVar = ENV_KEY_MAP[provider];
  if (envVar) {
    const fromEnv = process.env[envVar];
    if (fromEnv) return fromEnv;
  }

  const key = await promptApiKey(provider, envVar);
  setKeychainKey(provider, key);
  return key;
}

/**
 * Prompt the user for an API key interactively via readline.
 * Uses a muted output stream so the key is not echoed to the terminal.
 */
function promptApiKey(provider: string, envVar?: string): Promise<string> {
  const hint = envVar ? ` (or set ${envVar})` : "";

  process.stderr.write(`\nnyanclaw: No API key found for "${provider}"${hint}.\n`);
  process.stderr.write(`Paste your API key and press Enter: `);

  const muted = new Writable({
    write(_chunk, _encoding, cb) {
      cb();
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });

  return new Promise((resolve) => {
    rl.question("", (key) => {
      rl.close();
      process.stderr.write("\n");
      resolve(key.trim());
    });
  });
}

const apiKey = await resolveApiKey(PROVIDER);

const envVar = ENV_KEY_MAP[PROVIDER];
if (envVar) process.env[envVar] = apiKey;

const agent = createAgent({
  modelProvider: PROVIDER,
  modelName: MODEL,
});

const tui = new NyanclawTui({ agent });
tui.start();
