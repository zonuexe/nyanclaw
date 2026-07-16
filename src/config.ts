import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "nyanclaw");
  return join(homedir(), ".config", "nyanclaw");
}

function configPath(): string {
  return join(configDir(), "config.yaml");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelProfile {
  provider: string;
  model: string;
}

export interface Config {
  profiles: Record<string, ModelProfile>;
  defaultProfile: string;
  logseqGraph?: string;
  slidesDir?: string;
  workspaceDir?: string;
  /** Directories to search for git clones (not a per-repo map). */
  repoExploreRoots?: string[];
  /** Default Grok CLI model for ask_grok (e.g. grok-4.5). */
  grokModel?: string;
  /** Optional absolute path to the grok binary. */
  grokBin?: string;
}

let _cached: Config | null = null;

export function loadConfig(): Config {
  if (_cached) return _cached;

  const path = configPath();
  if (!existsSync(path)) {
    console.error(`nyanclaw: config not found at ${path}\n`);
    console.error("Create a config file:");
    console.error(`  mkdir -p ${configDir()}`);
    console.error(`  cat > ${path} << 'EOF'`);
    console.error("profiles:");
    console.error("  default:");
    console.error("    provider: opencode-go");
    console.error("    model: deepseek-v4-flash");
    console.error("EOF");
    process.exit(1);
  }

  let parsed: any;
  try {
    parsed = YAML.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(`nyanclaw: failed to parse ${path}:`, err);
    process.exit(1);
  }

  if (!parsed?.profiles || Object.keys(parsed.profiles).length === 0) {
    console.error("nyanclaw: config must define at least one profile under 'profiles:'");
    process.exit(1);
  }

  const exploreRoots = parsed.repo_explore_roots ?? parsed.repoExploreRoots;
  const config: Config = {
    profiles: {},
    defaultProfile: parsed.default_profile ?? "default",
    logseqGraph: parsed.logseq_graph || undefined,
    slidesDir: parsed.slides_dir || undefined,
    workspaceDir: parsed.workspace_dir || undefined,
    repoExploreRoots: Array.isArray(exploreRoots)
      ? exploreRoots.map(String)
      : undefined,
    grokModel: parsed.grok_model || parsed.grokModel || undefined,
    grokBin: parsed.grok_bin || parsed.grokBin || undefined,
  };

  for (const [name, p] of Object.entries(parsed.profiles) as [string, any][]) {
    if (!p?.provider || !p?.model) {
      console.error(`nyanclaw: profile "${name}" must have 'provider' and 'model'`);
      process.exit(1);
    }
    config.profiles[name] = { provider: p.provider, model: p.model };
  }

  if (!config.profiles[config.defaultProfile]) {
    console.error(`nyanclaw: default_profile "${config.defaultProfile}" not found`);
    process.exit(1);
  }

  _cached = config;
  return config;
}

export function piCatalogPath(): string {
  return join(homedir(), ".pi", "agent", "models.json");
}

export function configDirectory(): string {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function logseqGraph(): string {
  const v = loadConfig().logseqGraph;
  if (!v) throw new Error("logseq_graph not set in config.yaml");
  return v;
}

export function slidesDir(): string {
  const v = loadConfig().slidesDir;
  if (!v) throw new Error("slides_dir not set in config.yaml");
  return v;
}

export function workspaceDir(): string {
  const c = loadConfig();
  if (c.workspaceDir) return c.workspaceDir;
  return join(configDirectory(), "workspace");
}

