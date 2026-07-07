# ADR-0001: Logseq as the Source of Truth for Task Management

## Status

Accepted

## Context

nyanclaw is a personal agent whose core functions are task management, schedule management, and tacit experience accumulation. The initial proposal was to use GitHub Issues as the Source of Truth, with Logseq as a secondary reference layer. However, the user does not use GitHub for their day job — creating a private repository solely for task management would be counterproductive: the tail wagging the dog.

## Decision

Logseq (file-based, Org mode format, path configured via `LOGSEQ_GRAPH`) is the primary store (Source of Truth) for task management. Tasks are managed in Logseq using Org mode's `TODO`/`DONE`/`WAITING` keywords, `SCHEDULED:`/`DEADLINE:` properties, and Logseq's `#Task` tag.

GitHub is an external integration only. On nyanclaw startup, `gh` CLI fetches the user's own Issues/PRs and assigned Issues and imports them into Logseq for visibility. This sync is one-way (GitHub → Logseq only); state changes in Logseq are never written back to GitHub.

## Considered Options

- **GitHub Issues as Source of Truth**: Rejected. The user's daily workflow does not revolve around GitHub. Using GitHub purely for task management inverts means and ends.
- **Bidirectional sync**: Rejected. Completing a task in Logseq does not need to update GitHub (OSS Issues follow OSS conventions). Bidirectional sync adds complexity for minimal benefit.
- **Agent-internal task DB**: Rejected. Building custom persistence offers no advantage over using Logseq, which is already in place and actively used.

## Consequences

- Task listing and state changes operate directly on Logseq files (parsed and generated via `org-mode-ast`).
- GitHub integration is implemented as a read-only sync tool.
- macOS Calendar is also read-only; its events are merged into the Logseq journal page.
- Even when the user is not actively opening Logseq, nyanclaw keeps the graph alive by writing journal entries automatically.
