# nyanclaw — Context / Glossary

## Project

- **nyanclaw**: Personal agent. Built on the pi SDK, runs as a TUI application.

## Domain Terms

### Task Management

- **Source of Truth**: Logseq. All task state lives in Logseq's Org mode files.
- **Task representation**: Org mode `TODO`/`DONE`/`WAITING` keywords + Logseq `#Task` tag, `SCHEDULED:` / `DEADLINE:` properties.
- **GitHub integration**: External integration only. Open Source Issues and PRs are fetched via `gh` CLI on startup and imported into Logseq for visibility. Sync is one-way (GitHub → Logseq only; no reverse sync).

### Schedule Management

- **Logseq journal**: Primary daily view. The agent writes scheduled events into the daily journal page.
- **macOS Calendar (iCal)**: Read-only. The agent fetches today's / this week's events via `osascript` (AppleScript/JXA) and reflects them in the Logseq journal.

### Logseq Integration

- **Graph path**: Configured via `LOGSEQ_GRAPH` env var.
- **Graph type**: File-based (non-DB version). Format is Org mode (`.org`).
- **Agent access method**: Direct file read/write (`pages/<page-name>.org`, `journals/YYYY_MM_DD.org`).
- **CLI**: `logseq` Node CLI may also be used (`list task`, `upsert block`, etc.).

### Experience Accumulation / Journaling

- **Strategy**: No explicit save operation required. Accumulation happens as a side effect of task management and schedule management.
- **Journal**: Each day's tasks, events, and activity are automatically aggregated into the Logseq journal page.

### Interface

- **Primary**: TUI (`@earendil-works/pi-tui`).
- **Secondary**: Emacs (future).
- **GitHub sync timing**: Automatic on nyanclaw startup. Fetches own Issues/PRs and assigned Issues.
- **Repository watching**: Starts as `/watch-summary` command within nyanclaw. Extract into a separate tool if it grows too large.
- **Interaction model**: Hybrid — natural-language REPL for daily conversation plus `/command`-style shortcuts for routine operations.
- **Project structure**: Single package (flat `src/`). Re-evaluate core/app two-layer split if the toolset grows.
- **Runtime**: Bun.
- **Org mode parsing**: `org-mode-ast` (npm) as first choice. If Logseq-specific syntax causes issues, design a proper parser (not line-oriented) rather than ad-hoc string manipulation.
- **SDK packages**: `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`.
- **Lifecycle**: On-demand launch (daemon mode is future work).
