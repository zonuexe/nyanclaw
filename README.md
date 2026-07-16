# 🐈 Nyanclaw

**Nyanclaw** is a personal AI assistant — a local TUI agent for thinking, tasks, and durable notes, with Logseq as the source of truth.

It draws inspiration from projects such as **OpenClaw** and **Hermes Agent**, but those systems felt *too feature-rich* for the author's daily use. Nyanclaw is built **from scratch** with a narrower scope: enough power for a personal workflow, without the weight of a multi-channel, self-improving mega-assistant.

Nyanclaw is built on [**pi**](https://pi.dev/), so it can talk to the many LLMs listed under pi’s [Providers](https://pi.dev/docs/latest/providers).

## What it does

Nyanclaw is meant for **one person’s daily loop**: chat in a TUI, keep tasks and notes in **Logseq (Org files)**, and occasionally pull in outside context (GitHub, calendar, X/web via Grok).

Roughly, it helps with:

- **Tasks & schedule** — TODOs in the Logseq graph, journal as the daily view; optional macOS Calendar (read-only); GitHub issues/PRs synced in for visibility
- **Thinking & records** — capture decisions/lessons as **proposals**, then apply or reject; sessions kept as evidence, not auto-promoted to “memory”
- **Safe graph writes** — structured Org ops instead of free-form LLM Org text
- **Repo awareness** — skim recent commits/diffs on a GitHub repo via `gh` into Logseq pages
- **Fresher public knowledge** — optional **Grok CLI** consult for tweets/news while the main agent can stay on a cheaper model (e.g. DeepSeek)

The graph is the **source of truth**. Config and API keys stay local (config file + macOS Keychain).

## What it doesn’t

Nyanclaw is **not** trying to be a full personal OS or a “self-improving everything” bot.

It deliberately avoids (or only lightly touches):

- **Multi-channel gateway** life (Telegram/Discord/Slack/… as first-class surfaces)
- **Aggressive autonomous learning** that rewrites live memory/skills without you
- **Persona / companion** product surface
- **General remote automation** across arbitrary apps and devices
- **Bidirectional GitHub** (no “close the issue from Logseq” sync)
- Replacing Logseq itself — it **writes into** your graph, it isn’t a second vault

If OpenClaw/Hermes feel like a platform, Nyanclaw aims to feel like a **sharp personal tool**.

And if something is missing or too much for *you*: ask **your own** coding agent. Growing or trimming Nyanclaw into an assistant specialized for your workflow is probably very easy.

## Features

- **TUI chat** — hybrid natural language + slash commands (`/help`, `/model`, …), built on [pi](https://pi.dev/)
- **Logseq as source of truth** — file-based Org graph; tasks, journals, and notes live where you already work
- **Structured Org writes** — append blocks, notes, quotes, and planning via schema-driven ops (not free-form “please write valid Org”)
- **Task hygiene** — TODO / DONE / WAITING, deadlines, upsert by title; GitHub → Logseq one-way sync for watched/maintained repos
- **Record learning (draft → apply)** — `/capture`, `/distill`, `/inbox`, `/apply`, `/reject`, `/bye` for decisions and lessons without silent memory mutation
- **Repo skim** — `/skim owner/repo` fetches recent default-branch commits and per-commit diffs via `gh`, appends to `GH:…/skim/YYYY-MM-DD`
- **Grok consult** — `/grok` / `ask_grok` for web- and X-aware answers while the main agent stays on a fast model
- **Local secrets** — API keys in macOS Keychain; paths and profiles in `config.yaml`

See [`docs/user-manual.md`](docs/user-manual.md) for command details.

## Requirements & Quick start

### For humans

Nyanclaw is intended to be **set up with help from your own coding agent** (Claude Code, Cursor, Codex, OpenCode, Grok, …). You start from this repo as a base and shape it into *your* assistant.

**Strongly recommended:** paste the prompt below into your agent. It will ask where to put the sources, clone the repo, and follow the agent install steps.

```text
I want to build my own personal AI agent based on https://github.com/zonuexe/nyanclaw .

1. First, ask me which path on disk I want the source tree cloned into (do not assume a path).
2. Then git clone https://github.com/zonuexe/nyanclaw into that path (or clone and rename as needed).
3. Set up the project following the "For LLM Agents" section of the README in the clone:
   https://raw.githubusercontent.com/zonuexe/nyanclaw/master/README.md
4. Prefer reading the cloned README and docs/user-manual.md over improvising install steps.
```

After setup, run the app from the clone (`bun run start`), point `logseq_graph` at your Logseq graph, and customize tools/prompts with the same agent when you want something more personal.

### Requirements (summary)

| Need | Notes |
| :--- | :--- |
| **macOS** (current focus) | Keychain for API keys; Calendar integration is macOS-oriented |
| **[Bun](https://bun.sh/)** | Runtime and package manager |
| **[Git](https://git-scm.com/)** | Clone and develop |
| **Logseq** (file / Org graph) | Source of truth for tasks and notes |
| **LLM credentials** | Whatever [pi Providers](https://pi.dev/docs/latest/providers) you configure (API key and/or CLI auth) |
| **Optional** | [`gh`](https://cli.github.com/) (GitHub sync/skim), [Grok CLI](https://x.ai/cli) (`/grok`), icalBuddy for richer calendar |

### For LLM Agents

You are setting up **Nyanclaw** so a human can run a personal TUI agent on their machine. Follow this section end to end. Do not invent alternate installers.

#### 0. Ask for the install path

**Before cloning**, ask the human:

> Where should I put the Nyanclaw source tree? (absolute path to a directory that does not already exist, or an empty directory you want me to use.)

Do not default to `~/nyanclaw` or the agent’s cwd without confirmation.

#### 1. Clone

```bash
git clone https://github.com/zonuexe/nyanclaw.git "$NYANCLAW_SRC"
cd "$NYANCLAW_SRC"
```

If they want a fork as their long-term base: clone their fork instead, still treating this README’s agent section as the setup checklist.

#### 2. Install dependencies

Requires [Bun](https://bun.sh/). If `bun` is missing, install it (e.g. `curl -fsSL https://bun.sh/install | bash`) then:

```bash
cd "$NYANCLAW_SRC"
bun install
```

Sanity check:

```bash
bun test
bun run tsc --noEmit
```

#### 3. Create config

Config path (XDG if set, else home):

```text
$XDG_CONFIG_HOME/nyanclaw/config.yaml
# typically:
~/.config/nyanclaw/config.yaml
```

Create the directory and a minimal file. **Ask the human** for:

1. **Logseq graph path** — absolute path to their file-based Org graph (contains `pages/` and `journals/`).
2. **Default LLM** — provider + model id from [pi Providers](https://pi.dev/docs/latest/providers) / their `~/.pi/agent/models.json` catalog if they use one.

Example skeleton (replace values):

```yaml
default_profile: default

profiles:
  default:
    # Examples only — use IDs the human actually has credentials for
    provider: opencode-go
    model: deepseek-v4-flash
  # heavy:
  #   provider: …
  #   model: …

# Required for Logseq tools / records / skim pages
logseq_graph: /absolute/path/to/your/logseq/graph

# Optional
# slides_dir: /path/to/talk-outlines
# repo_explore_roots:
#   - ~/src
#   - ~/work
# grok_model: grok-4.5
# grok_bin: /Users/you/.grok/bin/grok
```

Do **not** put API keys in this file. Nyanclaw uses **macOS Keychain** (service `nyanclaw`, account = provider name) and prompts on first use when needed.

Optional pi catalog for extra providers: `~/.pi/agent/models.json` (pi standard). See [pi Providers](https://pi.dev/docs/latest/providers).

#### 4. Optional CLIs

| Feature | Install / login |
| :--- | :--- |
| GitHub sync / repo skim | [`gh`](https://cli.github.com/) + `gh auth login` |
| `/grok` / `ask_grok` (X & live web) | [Grok CLI](https://x.ai/cli) + `grok login` |
| Calendar | System Calendar; icalBuddy if the calendar tool expects it |

#### 5. Run

```bash
cd "$NYANCLAW_SRC"
bun run start
# or: bun run dev
```

Optional OpenTUI frontend if the entrypoint supports it (see `src/index.ts` / env flags the human already uses).

On first model use, complete any Keychain / provider auth prompts.

Useful in-app commands: `/help`, `/model`, `/capture`, `/skim owner/repo`, `/grok …`. Details: [`docs/user-manual.md`](docs/user-manual.md).

#### 6. Personalize (expected)

Nyanclaw is a **base**. After it runs:

- Adjust `SYSTEM_PROMPT` / tools under `src/` for the human’s workflow
- Add or remove tools; keep Logseq writes on the structured Org path
- Prefer a git remote under **their** account for ongoing customization

Read `CONTEXT.md` and `docs/adr/` before large architectural changes.

#### 7. Do not

- Skip asking for the clone path
- Commit secrets or paste API keys into config
- Point `logseq_graph` at a disposable path without the human agreeing
- Replace Logseq with a second notes vault “for convenience”
- Invent a second package manager flow if Bun works

## License

Nyanclaw is dual-licensed under:

1. **[GNU GPL v3][GPL-3.0]** (or later) — full text in [`LICENSE`](LICENSE)
2. **[NYSL 0.9982][NYSL]** (“Everyone’sWare”) — full text in [`NYSL.TXT`](NYSL.TXT)

As a *general-purpose* license pairing this is an odd combination **on purpose**. What it means for **you**:

- You may **keep** the original license notices and use/redistribute under GPL and/or NYSL as you prefer.
- Or you may **redistribute under your own responsibility** more freely, in the spirit of NYSL — including treating a fork as *your* software.

In particular, the NYSL path allows you to **remove the GPL notice entirely**, relicense under **your own** terms, and **replace the author’s name with yours** when you publish your modified version (as if you had written it). That is allowed; do it carefully and at your own risk. Read the [NYSL FAQ][NYSL-FAQ] before relying on that path.

```
Nyanclaw - My Own Personal AI Assistant
Copyright (C) 2026  USAMI Kenta <tadsan@zonu.me>

You may use, modify, and redistribute this software under the terms of
either the GNU General Public License version 3 (or later), or NYSL
Version 0.9982, at your option. See LICENSE and NYSL.TXT.

This software is provided without warranty; use at your own risk.
```

[GPL-3.0]: https://www.gnu.org/licenses/gpl-3.0
[NYSL]: https://www.kmonos.net/nysl/
[NYSL-FAQ]: https://www.kmonos.net/nysl/faq.html
