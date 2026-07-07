# ADR-0002: Bootstrap File System (SOUL.md / USER.md / IDENTITY.md)

## Status

Accepted

## Context

nyanclaw's system prompt is currently hardcoded as `SYSTEM_PROMPT` in `src/agent/system-prompt.ts`. This works for tool descriptions and behavior rules but provides no mechanism for:

- The user to define the agent's persona, tone, and boundaries (openclaw's SOUL.md)
- The agent to learn and remember who the user is (openclaw's USER.md)
- The user and agent to collaboratively define the agent's identity (openclaw's IDENTITY.md)

OpenClaw solves this with a workspace directory (`~/.openclaw/workspace/`) containing markdown files that are read at session start and injected into the system prompt. Each file has a purpose:

| File | Purpose | Loaded |
|------|---------|--------|
| `SOUL.md` | Persona, tone, boundaries | Every session |
| `USER.md` | User profile, preferences, context | Every session |
| `IDENTITY.md` | Agent's name, vibe, emoji | Every session |

The agent can update these files to persist knowledge about the user and itself.

## Decision

nyanclaw adopts the same pattern with a `workspace_dir` config key pointing to a directory of markdown files.

### Directory

- Default: `$XDG_CONFIG_HOME/nyanclaw/workspace/` (fallback `~/.config/nyanclaw/workspace/`)
- Configurable via `workspace_dir` in `config.yaml`
- Created automatically if missing

### Supported files

| File | Optional? | Content |
|------|-----------|---------|
| `SOUL.md` | Yes | Persona, tone, boundaries, core truths, vibe |
| `USER.md` | Yes | User's name, preferences, context, projects |
| `IDENTITY.md` | Yes | Agent's name, creature, vibe, emoji |

All three are optional. Missing files are silently skipped.

### Injection mechanism

At startup, each existing file is read and appended to the system prompt in order:

```
[hardcoded system prompt]
<tool descriptions>
<behavior rules>

--- SOUL.md ---
<contents of SOUL.md>

--- USER.md ---
<contents of USER.md>

--- IDENTITY.md ---
<contents of IDENTITY.md>
```

### Size limits

- Per-file: 20,000 characters (matching openclaw's `bootstrapMaxChars`)
- Total boostrap: 60,000 characters (matching openclaw's `bootstrapTotalMaxChars`)
- Files exceeding the limit are truncated with a `[...truncated, <file> is N chars over the limit]` marker

### Agent updates

- The agent is instructed that it can update `USER.md` to record durable facts about the user (preferences, projects, context)
- Updates go through `logseqWriteBlock` or direct file write (workspace files are plain markdown, not part of Logseq)

## Considered Options

- **Keep everything in config.yaml**: Rejected. YAML is not a good format for free-form persona text. Markdown files are more natural for this use case and match the existing openclaw ecosystem.
- **Store in Logseq**: Rejected. These files define the agent session itself, they are meta-configuration, not domain data. Keeping them outside the Logseq graph avoids circular dependencies.
- **No bootstrap files**: Rejected. A hardcoded system prompt is inflexible and cannot capture user-specific context.

## Consequences

- nyanclaw is no longer fully self-contained in a single system prompt string.
- Users familiar with openclaw can reuse their existing SOUL.md / USER.md files.
- The agent can persist knowledge about the user across sessions via USER.md updates.
- Missing files degrade gracefully — the agent still works with just the hardcoded prompt.
