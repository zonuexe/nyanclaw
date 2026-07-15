# ADR-0003: Migrate the TUI from pi-tui to OpenTUI

## Status

Proposed

## Context

nyanclaw's terminal UI is currently built on the pi built-in TUI
(`@earendil-works/pi-tui`). The whole UI lives in `src/tui/index.ts`
(~274 lines) as the `NyanclawTui` class, which drives an imperative
component tree (`TUI`, `Container`, `Editor`, `Markdown`, `Text`,
`CancellableLoader`, `showOverlay`) and hand-written ANSI escape themes.

We want a richer, more comprehensive component set that reproduces the
usability of the OpenCode CLI. [OpenTUI](https://github.com/anomalyco/opentui)
is the natural target because:

- It is the native core that **powers OpenCode in production today**, so
  matching OpenCode's UX means adopting the same primitives.
- It ships a broad component library: `ScrollBox` (real scrolling +
  scrollbars), tree-sitter–backed `Markdown`/`Code` syntax highlighting,
  `Diff`, `LineNumber`, `Input`/`Textarea` with Emacs-style keybindings,
  undo/redo, selection, `Select`/`TabSelect`, and a Yoga (flexbox) layout
  engine.
- It offers a React reconciler (`@opentui/react`) enabling a declarative
  UI, which is the shortest path to reproducing OpenCode's layout.
- Distribution is Bun-friendly: the Zig core ships as prebuilt
  platform binaries via `optionalDependencies` (`@opentui/core-darwin-arm64`
  etc.), so **end users do not need Zig installed**. Zig is only required
  to build the core itself.

### Key differences from pi-tui

| Concern | pi-tui | OpenTUI |
|---|---|---|
| Programming model | Imperative add/remove + `requestRender()` | Renderable tree + Yoga flexbox; declarative via React |
| Editor | `Editor` with autocomplete provider | `InputRenderable` / `TextareaRenderable` |
| Markdown | Single-color themes, manual ANSI | tree-sitter syntax highlighting, table alignment, streaming |
| Scrolling | `Container` (no real scroll) | `ScrollBoxRenderable` with scrollbars |
| Slash autocomplete | `CombinedAutocompleteProvider` (built-in) | **Must be rebuilt** (`Select` or custom) |
| Loader/spinner | `CancellableLoader` | **Self-authored** (`Timeline`/`setFrameCallback`/interval) |
| Ctrl+C / exit | `matchesKey` + `tui.stop()` | `createCliRenderer({exitOnCtrlC})` or `useKeyboard` |

### Blast radius

The UI dependency is well isolated: only `src/tui/index.ts` uses pi-tui
runtime components, and `src/tui/commands.ts` imports pi-tui **types**
(`AutocompleteItem`, `SlashCommand`) only. The agent (`src/agent`) and
tool (`src/tools`) layers are UI-agnostic and require no changes. The
command logic in `commands.ts` is fully reusable.

## Decision

Adopt `@opentui/react` and rebuild the UI declaratively. Migrate
incrementally behind a runtime switch so the legacy UI stays intact until
the OpenTUI version reaches parity.

- New UI lives under `src/tui-otui/` (`App.tsx`, `index.tsx`, `theme.ts`).
- `src/index.ts` selects the front-end via `NYANCLAW_TUI=opentui`
  (defaults to the legacy pi-tui UI).
- `commands.ts` and all agent/tool code are reused unchanged.
- Once parity + burn-in are achieved, make OpenTUI the default and remove
  `src/tui/` and the `@earendil-works/pi-tui` dependency.

### Dependencies added

- `@opentui/core`, `@opentui/react`, `react` (runtime)
- `@types/react` (dev)
- `tsconfig.json`: `jsx: react-jsx`, `jsxImportSource: @opentui/react`,
  `lib: [ESNext, DOM]`

## Consequences

**Positive**

- Real scrolling, syntax-highlighted markdown/code, richer editor — a
  concrete step toward OpenCode-grade UX.
- Declarative React UI is easier to extend and reason about than the
  imperative pi-tui tree.
- Shared lineage with OpenCode means patterns/examples transfer directly.

**Negative / risks**

- Adds a native (Zig-core) dependency. Mitigated by prebuilt binaries,
  but adds platform-specific optional deps and a larger install.
- Slash-command autocomplete and the cancellable loader must be
  re-implemented; they have no drop-in equivalent.
- React + reconciler increases the runtime surface vs. pi-tui.
- Two UI stacks coexist during migration (temporary maintenance cost).

## Migration checklist (issue-sized slices)

Each item is intended to be an independently grabbable issue.

1. **PoC scaffold** *(done)* — add deps, `tsconfig` JSX, `src/tui-otui/`
   with a working `App.tsx` (scrollbox + input + markdown + status bar),
   behind `NYANCLAW_TUI=opentui`. Type-checks clean.
2. **Streaming assistant rendering** — verify `<markdown streaming>`
   handles delta accumulation and finalization without flicker; tune
   `internalBlockMode`/`streaming` toggling on `message_end`.
3. **Slash-command autocomplete** — rebuild the pi-tui
   `CombinedAutocompleteProvider` UX (command + file-path completion)
   using `Select`/custom overlay. Reuse `commands.ts`.
4. **Cancellable loader** — replace `CancellableLoader` with a spinner
   that supports abort (Ctrl+C / Esc → `agent.abort()`).
5. **Status bar polish** — token/context %, model/profile, live refresh;
   match the legacy overlay behavior (bottom-right, non-capturing).
6. **Editor parity** — decide `Input` (single-line) vs `Textarea`
   (multi-line + submit-on-Meta+Enter); wire history, paste handling.
7. **Tool-call rendering** — surface `tool_execution_*` events (OpenCode
   shows tool activity inline); no equivalent exists in the legacy UI yet.
8. **Theming pass** — consolidate colors in `theme.ts`, align with
   OpenCode's palette; syntax theme via `SyntaxStyle`.
9. **Exit / lifecycle** — graceful `renderer.stop()` + terminal restore
   on Ctrl+C, errors, and normal quit.
10. **Cutover** — make OpenTUI default, delete `src/tui/`, drop
    `@earendil-works/pi-tui`, update docs.

## References

- OpenTUI: https://github.com/anomalyco/opentui
- awesome-opentui: https://github.com/msmps/awesome-opentui
- `@opentui/react` API: `node_modules/@opentui/react` README
- PoC: `src/tui-otui/` (this repo)
