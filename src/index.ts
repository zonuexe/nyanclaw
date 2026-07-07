#!/usr/bin/env bun
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
 * Prompt the user for an API key interactively.
 * Uses raw mode to prevent echo to terminal.
 */
function promptApiKey(provider: string, envVar?: string): Promise<string> {
  const hint = envVar ? ` (or set ${envVar})` : "";

  process.stderr.write(`\nnyanclaw: No API key found for "${provider}"${hint}.\n`);
  process.stderr.write(`Paste your API key and press Enter: `);

  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw ?? false;
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);

    const onData = (data: Buffer) => {
      const key = data.toString("utf-8").replace(/[\r\n]/g, "").trim();
      if (!key) return;

      if (process.stdin.setRawMode) process.stdin.setRawMode(wasRaw);
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      process.stderr.write("\n");
      resolve(key);
    };

    process.stdin.on("data", onData);
    process.stdin.resume();
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
