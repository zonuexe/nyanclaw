import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceDir } from "../config.ts";

const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 60_000;

const BOOTSTRAP_FILES = ["SOUL.md", "USER.md", "IDENTITY.md"] as const;

/**
 * Seed a bootstrap file with a template if it does not exist yet.
 */
function seedFile(name: string, template: string): void {
  const dir = workspaceDir();
  const path = join(dir, name);
  if (!existsSync(path)) {
    writeFileSync(path, template, "utf-8");
  }
}

const SEED_SOUL = `# SOUL.md - Who You Are

Use this file to define the agent's persona, tone, and boundaries.
See docs.adr/0002-bootstrap-file-system.md for details.
`;

const SEED_USER = `# USER.md - About Your Human

- **Name:**
- **What to call them:**
- **Timezone:**

Use this file to describe the user. The agent can update it over time.
See docs.adr/0002-bootstrap-file-system.md for details.
`;

/**
 * Read all bootstrap files from the workspace directory and return their
 * contents concatenated into a string suitable for appending to the system
 * prompt. Missing files are silently skipped. Per-file and total size limits
 * are enforced.
 */
export function loadBootstrapPrompt(): string {
  const dir = workspaceDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  seedFile("SOUL.md", SEED_SOUL);
  seedFile("USER.md", SEED_USER);

  const parts: string[] = [];
  let total = 0;

  for (const name of BOOTSTRAP_FILES) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;

    let content = readFileSync(path, "utf-8").trim();
    if (!content) continue;

    if (content.length > MAX_FILE_CHARS) {
      const over = content.length - MAX_FILE_CHARS;
      content = content.slice(0, MAX_FILE_CHARS) +
        `\n\n[...truncated: ${name} is ${over} chars over the limit]\n`;
    }

    const section = `\n--- ${name} ---\n${content}\n`;
    total += section.length;

    if (total > MAX_TOTAL_CHARS) {
      const over = total - MAX_TOTAL_CHARS;
      parts.push(
        `\n[...truncated: total bootstrap exceeds ${MAX_TOTAL_CHARS} chars by ${over}]\n`,
      );
      break;
    }

    parts.push(section);
  }

  return parts.join("");
}
