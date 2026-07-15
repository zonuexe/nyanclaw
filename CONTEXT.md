# nyanclaw — Context / Glossary

## Project

- **nyanclaw**: Personal agent and local thought-and-record sidecar. Built on the pi SDK, runs as a TUI application. Focuses on thinking support, durable records, task/schedule hygiene — not persona, multi-channel messaging, or a broad external task runner.

## Domain Terms

### Source of Truth

- **Source of Truth**: The operator's **Logseq graph** (file-based Org mode). All durable knowledge and operational state that nyanclaw persists for the human lives there: tasks, journals, pages, decisions, proposals, session evidence, and other machine-oriented pages. There is no parallel long-term memory tree outside the graph.
- **Derived cache**: Optional rebuildable indexes (e.g. search DB). Never authoritative; may be deleted and regenerated from the graph.
_Avoid_: dual store, `~/.nyanclaw/memory` as SoT, shadow Markdown vault

### Task Management

- **Task representation**: Org mode `TODO`/`DONE`/`WAITING` keywords + Logseq `#Task` tag, `SCHEDULED:` / `DEADLINE:` properties.
- **GitHub integration**: External integration only. Open Source Issues and PRs are fetched via `gh` CLI on startup and imported into Logseq for visibility. Sync is one-way (GitHub → Logseq only; no reverse sync).

### Schedule Management

- **Logseq journal**: Primary daily view. The agent writes scheduled events into the daily journal page.
- **macOS Calendar (iCal)**: Read-only. The agent fetches today's / this week's events via `osascript` (AppleScript/JXA) and reflects them in the Logseq journal.

### Thinking & Records

- **Session**: A conversation or thinking episode stored as **evidence** (not automatically promoted to durable knowledge).
- **Record**: A durable, user-accepted note in the graph. **v1 types**: decision, lesson, preference, quote/note. Later: workflow, question, project-context, reading note, reflection, etc.
- **Proposal**: A draft change to Records (or indexes/templates) awaiting human apply / edit / reject. Learning defaults to proposal-based; the agent does not silently mutate live Records.
- **Proposal review path**: Canonical apply/reject/edit-apply runs **inside nyanclaw** (`/inbox`, `/apply`, `/reject`, etc.). Proposal pages in Logseq are inspectable evidence; hand-editing status in Logseq is not the v1 apply mechanism.
- **Template**: A reusable capture shape for thinking or recording (decision, weekly review, etc.) — not a broad automation skill.
- **Write policy (dual track)**:
  - **Task / journal track**: structured, immediate writes to the graph (append task, planning, quote-as-commanded content, etc.) via the deterministic Org write path — not free-form Org.
  - **Record learning track**: default **draft** — create Proposals only; **apply** only after explicit user accept (or an explicit apply-mode action). No silent promotion of Session evidence into live Records.
- **Capture trigger**:
  - **Primary**: user-invoked — `/capture`, `/review`, `/distill`, or natural-language “record this / distill that”.
  - **Also**: **session-end offer** — on session close / `/bye` (or equivalent), nyanclaw may ask once whether to draft candidate Proposals into an inbox. It does not create Proposals silently without that yes.
  - **Not in v1**: idle background self-learning that writes Proposals without a user turn.
_Avoid_: skill workshop (product name from other tools), free-form live self-improvement, hidden user modeling / persona, single global “full autonomy” for all writes, silent background Record promotion

### Logseq Integration

- **Graph path**: From config (`logseq_graph`), not ad-hoc env for app settings.
- **Graph type**: File-based (non-DB version). Format is Org mode (`.org`).
- **Agent access method**: Structured ops over graph files (`pages/`, `journals/`, and reserved nyanclaw namespaces as needed). Free-form Org generation is not the primary write path.
- **Graph namespace**:
  - **Human Records / tasks**: normal Logseq pages and journals (no forced prefix).
  - **Machine / sidecar pages**: reserved logical prefix **`nyanclaw/`** under the graph (e.g. `nyanclaw/sessions/<id>`, `nyanclaw/proposals/<id>`, `nyanclaw/inbox`, `nyanclaw/audit`). Humans may open them; daily reading is not required.
_Avoid_: second vault outside the graph, dumping sessions only into daily journals as the primary store
- **CLI**: `logseq` Node CLI may also be used (`list task`, `upsert block`, etc.).

### Experience Accumulation / Journaling

- **Strategy**: Daily journal aggregation continues as a side effect of task and schedule work; **durable learning** (lessons, decisions) uses explicit capture / review → Proposal → apply, not silent background mutation of live Records.
- **Journal**: Each day's tasks, events, and activity aggregate into the Logseq journal page.

### Configuration

- **Config file**: `$XDG_CONFIG_HOME/nyanclaw/config.yaml` (fallback `~/.config/nyanclaw/config.yaml`). YAML format.
- **Model catalog**: `~/.pi/agent/models.json` (pi standard). Built-in pi catalog used as base.
- **Profiles**: Named model profiles (e.g., `default`, `heavy`) in config.yaml. Each maps to a `provider/model` from the catalog.
- **Model routing**: Agent-driven auto-selection plus explicit `/model` command.
- **API key storage**: macOS Keychain only (service: `nyanclaw`, account: provider name). No env var fallback. Prompted interactively on first use.
- **pi SDK**: `createModels()` — not the compat global API.
- **All env vars removed**: Paths and settings come from config.yaml only (except where the platform forces secrets into the keychain).

### Interface

- **Primary**: TUI (`@earendil-works/pi-tui`).
- **Secondary**: Emacs (future).
- **GitHub sync timing**: Automatic on nyanclaw startup. Fetches own Issues/PRs and assigned Issues.
- **Repository watching**: Starts as `/watch-summary` command within nyanclaw. Extract into a separate tool if it grows too large.
- **Interaction model**: Hybrid — natural-language REPL for daily conversation plus `/command`-style shortcuts for routine operations.
- **Project structure**: Single package (flat `src/`). Re-evaluate core/app two-layer split if the toolset grows.
- **Runtime**: Bun.
- **Org mode writing**: Structured intent → deterministic Logseq-subset serializer → structural validation → atomic write. Prefer this over ad-hoc string assembly or free-form LLM Org.
- **Org mode parsing**: `org-mode-ast` (npm) for walk/ranges; generation is nyanclaw-owned.
- **SDK packages**: `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`.
- **Lifecycle**: On-demand launch (daemon mode is future work).
