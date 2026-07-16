/**
 * Call the Grok CLI for one-shot Q&A (web/X-aware).
 * Prefer this over ACP for pure information queries — lighter and already proven.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfig } from "../config.ts";

export const DEFAULT_GROK_MODEL = "grok-4.5";
export const DEFAULT_GROK_TIMEOUT_MS = 180_000;

export type GrokAskOptions = {
  prompt: string;
  /** Optional URL (tweet, article) appended to the prompt for clarity */
  url?: string;
  model?: string;
  timeoutMs?: number;
  /** Disable Grok web search tools (rarely needed) */
  disableWebSearch?: boolean;
  /** Override binary path */
  bin?: string;
};

export type GrokAskResult = {
  ok: boolean;
  text: string;
  model: string;
  bin: string;
  durationMs: number;
  error?: string;
};

function resolveGrokBin(explicit?: string): string {
  if (explicit && existsSync(explicit)) return explicit;
  const cfg = loadConfig();
  if (cfg.grokBin && existsSync(cfg.grokBin)) return cfg.grokBin;
  // common install locations
  const candidates = [
    process.env.GROK_BIN,
    `${process.env.HOME}/.grok/bin/grok`,
    `${process.env.HOME}/.local/bin/grok`,
    "/usr/local/bin/grok",
    "grok",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c === "grok") {
      try {
        execSync("command -v grok", { encoding: "utf-8", timeout: 2000 });
        return "grok";
      } catch {
        continue;
      }
    }
    if (existsSync(c)) return c;
  }
  return "grok";
}

export function defaultGrokModel(): string {
  return loadConfig().grokModel ?? process.env.NYANCLAW_GROK_MODEL ?? DEFAULT_GROK_MODEL;
}

export function buildGrokPrompt(prompt: string, url?: string): string {
  const body = prompt.trim();
  const u = url?.trim();
  if (!u) return body;
  if (body.includes(u)) return body;
  return `${body}\n\nURL: ${u}`;
}

/**
 * Run `grok -p <prompt> -m <model> --output-format plain`.
 * Grok CLI can use web/X tools unless --disable-web-search.
 */
export function askGrok(opts: GrokAskOptions): GrokAskResult {
  const model = opts.model ?? defaultGrokModel();
  const bin = resolveGrokBin(opts.bin);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_GROK_TIMEOUT_MS;
  const fullPrompt = buildGrokPrompt(opts.prompt, opts.url);
  const started = Date.now();

  const args = [
    "-p",
    fullPrompt,
    "-m",
    model,
    "--output-format",
    "plain",
  ];
  if (opts.disableWebSearch) {
    args.push("--disable-web-search");
  }

  try {
    const text = execFileSync(bin, args, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env },
    }).trim();
    return {
      ok: true,
      text: text || "(empty response from grok)",
      model,
      bin,
      durationMs: Date.now() - started,
    };
  } catch (err: unknown) {
    const e = err as {
      message?: string;
      stderr?: Buffer | string;
      stdout?: Buffer | string;
      status?: number;
    };
    const stderr = e.stderr
      ? typeof e.stderr === "string"
        ? e.stderr
        : e.stderr.toString("utf-8")
      : "";
    const stdout = e.stdout
      ? typeof e.stdout === "string"
        ? e.stdout
        : e.stdout.toString("utf-8")
      : "";
    // Sometimes partial answer is on stdout even on non-zero
    if (stdout.trim()) {
      return {
        ok: true,
        text: stdout.trim(),
        model,
        bin,
        durationMs: Date.now() - started,
      };
    }
    return {
      ok: false,
      text: "",
      model,
      bin,
      durationMs: Date.now() - started,
      error: [e.message, stderr].filter(Boolean).join("\n").slice(0, 2000),
    };
  }
}

export function isGrokAvailable(): boolean {
  try {
    const bin = resolveGrokBin();
    execFileSync(bin, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}
