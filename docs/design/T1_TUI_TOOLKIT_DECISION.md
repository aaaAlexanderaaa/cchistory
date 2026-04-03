# T1 TUI Toolkit And Interaction Decision

## Status

- Objective: `T1 - Canonical TUI`
- KR: `T1-KR2 Architecture and toolkit decision`
- Backlog task closed by this note: `choose the TUI toolkit and interaction primitives after design review`
- Date: 2026-04-01
- Inputs: `docs/design/T1_TUI_RUNTIME_PATH_DECISION.md`, `docs/design/T1_TUI_SCOPE_AND_WORKFLOW_INVENTORY.md`, and the `ui-ux-pro-max` skill review for keyboard-first high-density interfaces

## Decision

Choose **Ink** as the canonical TUI toolkit, with a **read-first pane-based interaction model** and a small set of CCHistory-specific primitives built on top.

Do not start with:

- prompt-only libraries such as `clack` / `inquirer`, because they do not provide a persistent multi-pane recall surface,
- low-level terminal frameworks such as `blessed`/`neo-blessed` as the default, because they would push the project into a more imperative, terminal-specific UI architecture than v1 needs.

## Why Ink Wins

### Lens A: System Consistency

CCHistory already lives in a TypeScript workspace and already has a React-shaped
frontend surface on the web side. Ink is not the web stack, but it keeps the
same component model, state composition style, and testing ergonomics close to
what the repository already understands.

That matters because TUI v1 is not a terminal toy; it is a canonical product
surface that should stay aligned with shared projection logic and with future
extractable read-side components.

### Lens B: User Experience

The TUI is supposed to be keyboard-first, high-signal, and persistent. The user
needs to keep a project list, a turn/result list, and a detail/context pane in
view without re-running commands for every step.

Ink fits that better than prompt libraries because it supports:

- persistent layouts,
- live pane updates,
- component-level keyboard handling,
- search/result/detail state in one running surface.

The `ui-ux-pro-max` review also reinforced the interaction priorities that map
well to Ink-based TUI design:

- visible focus indicators,
- logical keyboard navigation order,
- high contrast for dense text surfaces,
- readability over decorative motion.

### Lens C: Implementation Risk

Ink is not perfect for every terminal problem, but it is the lowest-risk choice
for TUI v1 because it lets the project stay declarative and incremental.

Compared with `blessed`/`neo-blessed`:

- layout and state logic stay easier to reason about,
- component composition is simpler,
- tests can stay closer to the current TypeScript tooling mindset,
- the team avoids prematurely committing to a low-level screen-buffer model.

The main risk is performance and ergonomics for very large tables or highly
specialized terminal widgets. That risk is acceptable for v1 because the first
slice is read-first and can deliberately avoid terminal-maximal widgets.

## Rejected Options

### Prompt Libraries (`clack`, `inquirer`, similar)

**Rejected because:** they are excellent for guided flows and confirmations, but
not for a persistent project/search/detail workspace.

They may still be useful later for one-off mutation flows, but not as the core
TUI framework.

### `blessed` / `neo-blessed`

**Rejected for v1 because:** they provide more raw terminal power than the first
slice needs, but at the cost of a more imperative and terminal-specific UI
architecture.

They remain fallback options only if Ink proves unable to support the required
pane navigation or rendering stability.

## Chosen Interaction Primitives

The first canonical TUI should use these primitives:

1. **Left rail / primary list** for projects or search modes.
2. **Middle list pane** for turns, sessions, or search results.
3. **Right detail pane** for canonical text, context summary, and source/session cues.
4. **Persistent status bar** for active mode, read mode, store path, and counts.
5. **Inline command/search bar** for `/` search and direct jump flows.
6. **Help overlay** for discoverable shortcuts instead of hidden key bindings.

## Keyboard Model

Adopt a small, explicit keyboard vocabulary:

- `Tab` / `Shift+Tab`: move focus across panes
- `↑` / `↓` or `j` / `k`: move within the active list
- `Enter`: drill into the selected item
- `/`: open search mode
- `Esc`: close overlay / leave search input / return focus
- `p`: projects mode
- `s`: source health summary
- `l`: linking inbox summary
- `?`: keyboard help
- `q`: quit the TUI

These bindings are intentionally conservative. V1 should optimize clarity and
muscle memory before adding Vim-heavy or terminal-power-user shortcuts.

## Visual Rules For V1

Following the interaction review:

- use high-contrast dark defaults,
- keep focus styling always visible,
- prefer dense but readable rows over decorative cards,
- keep body text readable with comfortable line height,
- avoid hover-dependent semantics,
- avoid motion-heavy transitions.

## Risks And Mitigations

### Risk: Large result sets feel slow or noisy

Mitigation:

- page or window long lists,
- keep row rendering compact,
- load detail panes lazily,
- avoid rendering huge raw evidence blocks by default.

### Risk: Ink abstraction gaps for advanced widgets

Mitigation:

- keep v1 to list/detail/search/summary flows,
- build small custom primitives only when required,
- revisit `blessed` only if a concrete blocker appears.

### Risk: TUI diverges from CLI/API semantics

Mitigation:

- keep the runtime path chosen in `T1_TUI_RUNTIME_PATH_DECISION.md`,
- consume shared read/projection helpers,
- treat Ink as the rendering shell, not the semantic source.

## What This Unblocks

This toolkit choice is sufficient to define the first implementation slice:

- one TUI entrypoint,
- one pane-based project browser,
- one search/results/detail flow,
- one lightweight source health panel,
- targeted validation for keyboard navigation and read-side projections.
