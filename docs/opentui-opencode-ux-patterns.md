# OpenCode TUI: UX patterns to reproduce (OpenTUI reference)

Findings from reading OpenCode's TUI (`packages/tui` in `sst/opencode`),
which is built on OpenTUI in production. This is the reference for what
"OpenCode-grade usability" concretely means, and how to reproduce each
piece in nyanclaw's OpenTUI migration (ADR-0003).

> Source: https://github.com/sst/opencode → `packages/tui/src`

## Big-picture architecture

- **Renderer:** `@opentui/solid` (SolidJS reconciler), **not React.**
  OpenCode uses fine-grained Solid signals (`createSignal`, `createMemo`,
  `createEffect`, `<For>`, `<Show>`, `<Switch>`) rather than React state.
  - Implication for nyanclaw: our PoC uses `@opentui/react`, which is a
    valid choice and simpler for our small surface. Solid gives finer
    reactivity (less re-render churn) but adds a learning curve. **Decision
    point:** stay on React for parity work; only consider Solid if render
    performance on long transcripts becomes a problem.
- **Layout root:** `createCliRenderer({ externalOutputMode: "passthrough",
  targetFps: 60, exitOnCtrlC: false, useKittyKeyboard: {}, autoFocus: false,
  useMouse: <config>, openConsoleOnError: false })`. Note `exitOnCtrlC:
  false` — Ctrl+C is handled in-app for graceful shutdown (matches our PoC).
- **Keybindings:** a dedicated `@opentui/keymap` package with a mode stack
  (`base`, `autocomplete`, dialog modes…), leader-key sequences, and
  per-command bindings. OpenCode registers dozens of commands
  (`command.palette.show`, `model.list`, `session.new`, …).
- **Structure:** `app.tsx` composes ~30 context providers (theme, sync,
  sdk, project, dialog, toast, keymap, …) then routes to `Home` or
  `Session`. Heavy use of a central **dialog stack** and **toast** system.

## Screen layout (session route)

Vertical flex column:

1. **Message transcript** — a `ScrollBoxRenderable` of message parts.
   - Each assistant/user message is a block; tool calls render inline
     (`ToolPart`) with collapsible output.
   - Markdown parts use OpenTUI `Markdown` with a theme-driven
     `SyntaxStyle`; code/diff parts use `Code`/`Diff` renderables.
   - Supports: timestamps toggle, thinking/reasoning toggle, tool-detail
     toggle, scrollbar toggle, conceal toggle — all persisted via a KV store.
2. **Prompt area** (`component/prompt/index.tsx`) — a
   `TextareaRenderable` (multi-line), with:
   - An **anchor `BoxRenderable`** used to position the autocomplete popup.
   - Extmarks for inline file/agent mentions (styled spans inside input).
   - Paste handling (`PasteEvent` + `decodePasteBytes`), including turning
     pasted file paths into attachments.
   - Draft retention, prompt history, and a "stash" feature.
3. **Footer** (`routes/session/footer.tsx`) — a flex row, space-between:
   - Left: current directory (`~`-abbreviated).
   - Right: permission count, LSP count, MCP count/status dots, `/status`
     hint. Uses colored `•`/`⊙`/`△` glyphs from the theme.

## Autocomplete (the key UX to copy)

`component/prompt/autocomplete.tsx`. Two trigger modes:

- **`/` at start** → slash-command palette (built-in + server + MCP
  commands). Selecting rewrites the input line to `/<name> `.
- **`@` anywhere** → mention palette: **files** (via SDK fuzzy find,
  frecency-ranked), **agents**, **git references**, and **MCP resources**.
  Supports `#start-end` line ranges on file mentions.

Mechanics worth reproducing:

- Popup is a `ScrollBoxRenderable` positioned relative to the input anchor;
  position recomputed on resize and via a 50ms poll of anchor x/y/width.
- Fuzzy matching via `fuzzysort` with a custom `scoreFn` that boosts
  prefix matches (×2) and multiplies by a **frecency** score.
- Keyboard vs mouse input mode tracked to avoid spurious hover selection
  when the list scrolls under the cursor.
- Commands are padded to equal display width for column alignment.

nyanclaw's current pi-tui uses `CombinedAutocompleteProvider` (commands +
file paths). To reach parity we need at minimum the **`/` command palette**;
`@`-mentions are a stretch goal (nyanclaw's tools differ from OpenCode's).

## Dialogs & command palette

- `ui/dialog.tsx` provides a dialog stack; `ui/dialog-select.tsx` is a
  reusable fuzzy-filterable select with categories, per-row actions,
  footer hints, and keybinding labels. This one component backs the
  model picker, session list, theme list, command palette, etc.
- **Takeaway:** invest early in one generic `DialogSelect` equivalent;
  most "rich" OpenCode dialogs are just configurations of it.

## Spinner / loading

- OpenTUI has a **built-in `<spinner>` renderable** (`frames`, `interval`,
  `color`). OpenCode wraps it in `component/spinner.tsx` with an
  animations-enabled KV toggle and a static `⋯` fallback.
- Frames used: `["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]` (our PoC uses
  the same set via a manual interval; we can switch to `<spinner>` later).
- There is also an elaborate "Knight Rider" gradient spinner
  (`ui/spinner.ts`) for startup — optional polish.

## Theming

- `context/theme.tsx` + `theme/assets/*.json` — 30+ named themes, each a
  JSON palette (text, textMuted, background, backgroundElement, success,
  warning, error, accents…) plus a derived `SyntaxStyle`.
- Components read `theme.<token>` reactively; switching themes is instant.
- **Takeaway for nyanclaw:** centralize colors (we started with
  `src/tui-otui/theme.ts`) and drive markdown/code via one `SyntaxStyle`.
  We don't need 30 themes — one or two is fine — but the *indirection*
  (semantic tokens, not raw hex at call sites) is worth adopting.

## Mapping to nyanclaw parity work

| OpenCode pattern | nyanclaw need | Effort |
|---|---|---|
| ScrollBox transcript | messages area (PoC has it) | done (PoC) |
| Textarea prompt + anchor | multi-line editor | medium |
| `/` command palette autocomplete | replace pi-tui provider | medium |
| `@` file/agent mentions | nice-to-have | high |
| Footer status row | context %/model + tool/LSP hints | low |
| Built-in `<spinner>` | loader (PoC uses manual frames) | low |
| Generic DialogSelect | model picker, session list | medium |
| Theme tokens + SyntaxStyle | `theme.ts` (started) | low |
| Inline tool-call rendering | show `tool_execution_*` events | medium |

## Notable divergences (don't blindly copy)

- OpenCode is a **multi-session, multi-workspace, server-backed** app
  (SDK + sync engine). nyanclaw is single-session and agent-embedded, so
  most of OpenCode's context providers (sync, sdk, project, workspace,
  permission, question) have **no nyanclaw equivalent** and should be
  skipped.
- OpenCode uses Solid; nyanclaw's PoC uses React. Keep them apart — don't
  copy Solid `createEffect`/signal code verbatim.
- `@opentui/keymap` is powerful but heavy; for nyanclaw's handful of
  commands, `useKeyboard` + a small command table is sufficient at first.

## References

- OpenCode TUI: `sst/opencode` → `packages/tui/src`
  - `app.tsx`, `routes/session/index.tsx`, `routes/session/footer.tsx`
  - `component/prompt/index.tsx`, `component/prompt/autocomplete.tsx`
  - `ui/dialog-select.tsx`, `component/spinner.tsx`, `context/theme.tsx`
- OpenTUI React API: `@opentui/react` README
- nyanclaw migration: ADR-0003, `src/tui-otui/`
