# R24 Rich Browse And Search Surfaces For CLI And TUI

## Status

- Drafted on 2026-04-02.
- Purpose: define an `ls`-inspired operator contract for richer CLI and TUI
  browsing of projects, sessions, turns, and delegated child work.
- Scope: map compact, long, and tree-style discovery patterns onto canonical
  CCHistory read surfaces without violating the design freeze.

## Why This Exists

The current repository already offers strong primitives:

- CLI `ls`, `tree`, `show`, `search`, and `query`;
- TUI browse mode, search mode, and lightweight source-health summaries;
- related-work summaries for transcript-primary child sessions and evidence-only
  automation runs.

That is useful, but it is still flatter and less rewarding than terminal-native
inspection patterns such as `ls`, `ls -la`, or `ls --tree`. Operators want to
scan quickly, then progressively reveal richer context without switching mental
models or jumping straight into verbose JSON.

The user request for this objective is therefore not "make it look like Unix
`ls` at all costs." The real requirement is stronger:

1. project, session, turn, and subagent-related browsing should expand more
   gracefully;
2. denser metadata should appear when it adds operator value, not noise;
3. hierarchy should be easier to read when parent session, child session, and
   related-work structure matters;
4. search should remain `UserTurn`-first while making it easier to pivot into
   surrounding project, session, and child-work context.

This note defines that contract before implementation.

## Frozen Constraints From The Design

The design freeze remains binding:

- history is project-first and turn-first, not session-first;
- default recall and search target `UserTurn`, not raw session rows;
- UI, TUI, CLI, and API must remain projections of one canonical model;
- delegated child sessions and automation runs must stay distinguishable from
  ordinary human-authored turn hits;
- richer browse modes may reveal more context, but they must not silently
  redefine what the primary object of recall is.

In practice, that means:

- `project` remains the first browse anchor;
- `turn` remains the default search result object;
- `session` remains a drill-down and context container, not the default global
  browsing unit;
- `subagent` language in operator surfaces should resolve to the canonical R23
  distinctions: transcript-primary `child session` versus evidence-only
  `automation run`.

## Operator Jobs This Slice Should Improve

The relevant jobs are:

1. scan a store quickly to find the right project or recent workstream;
2. expand one row into enough metadata to decide whether it is the right thing;
3. pivot from a recovered turn into its enclosing session and nearby turns;
4. see whether a turn or session spawned child work without confusing that work
   for ordinary user input;
5. compare compact versus expanded views without abandoning the current CLI/TUI
   workflow.

## Mapping `ls` Metaphors Onto CCHistory

The repository should borrow the **progressive disclosure** idea from `ls`, not
its filesystem ontology.

### Metaphor mapping

| Unix-style metaphor | CCHistory meaning | Intended use |
| --- | --- | --- |
| compact listing | low-noise project / turn / session discovery | fast scanning |
| long listing | richer metadata for each row | decide what to open next |
| tree view | explicit project → session → turn or parent → child-work hierarchy | understand structure and lineage |
| hidden/extra details | non-default context that is valuable but noisy when always shown | progressive expansion |
| exact path drill-down | stable `show` / detail view for one chosen object | bounded deep inspection |

### What should *not* map one-to-one

Some `ls` ideas should **not** transfer literally:

- there is no equivalent of filesystem dotfiles that should be shown by default
  when the user asks for "all"; instead, the meaningful analogue is
  operator-useful extra context such as linkage state, source mix, workspace,
  or related-work counts;
- tree mode must not turn the product into a raw session browser; the top-level
  tree root is still project-centric or turn-anchored, not a flat dump of all
  sessions on disk;
- related child sessions and automation runs are not siblings of `UserTurn`
  search hits; they are context attached to a turn or session detail path.

## Browse Contract

### 1. Compact mode stays default

Compact mode should optimize for scan speed.

For CLI `ls` or TUI default browse panes, compact rows should emphasize:

- object label (`project name`, `session title/workspace hint`, or short turn
  text);
- one recency signal;
- one or two count or provenance cues when they materially disambiguate rows.

Compact mode should remain the everyday entry surface.

### 2. Long mode adds operator-decision metadata

Long mode is the true analogue of `ls -l` / `ls -la`: it should expose the
extra fields an operator needs when deciding whether to drill in, compare
similar rows, or understand lineage.

Long mode should **not** simply dump every known field. It should add only the
metadata that changes the operator's next action.

### 3. Tree mode explains hierarchy, not exhaustiveness

Tree mode should make parent/child structure obvious:

- project → recent sessions → turns;
- session → nearby turns → related child sessions / automation summary;
- project or turn detail → child-work summary where the relation is relevant.

Tree mode exists to show structure and drill-down affordances, not to exhaustively
render every raw artifact.

### 4. Extra-context mode means "show more relevant context"

The closest truthful analogue to `ls -a` is **show more relevant-but-noisy
context**. That may include:

- candidate vs committed linkage state;
- source mix or source platform;
- workspace / cwd hints;
- whether the selected session has child sessions or automation runs;
- search-context snippets or why a row matched.

It does **not** mean exposing hidden internal raw artifacts by default.

## Metadata Contract By Object Type

### Project rows

Compact project rows should prefer:

- project name;
- last activity time;
- turn count or recent activity count.

Long project rows should additionally expose:

- source mix or dominant sources;
- committed / candidate / unlinked mix when relevant;
- number of recent sessions represented by the visible turns;
- whether related child-session activity exists within the recent window.

Tree project views should expand into:

- recent sessions grouped under the project;
- recent turns under each visible session group;
- child-session summary counts on the relevant turn or session branch.

### Session rows

Compact session rows should prefer:

- title or workspace basename;
- recency;
- source / platform cue.

Long session rows should additionally expose:

- full workspace or cwd hint;
- project association;
- turn count;
- child-session count and automation-run count when non-zero;
- any distinguishing relation to a parent session if this is delegated work.

Tree session views should expand into:

- session header;
- selected or recent turns beneath it;
- grouped related work beneath the session, separated into `Child Sessions` and
  `Automation Runs` when present.

### Turn rows

Compact turn rows should prefer:

- canonical turn text preview;
- project cue;
- recency.

Long turn rows should additionally expose:

- source platform;
- session title or workspace hint;
- linkage state when non-default or important;
- related-work summary, for example `2 child sessions` or `1 automation run`;
- stronger match context for search results.

Tree turn views should expand into:

- the recovered turn;
- bounded nearby session context;
- related child sessions or automation summary as attached context, not as peer
  search hits.

### Subagent / related-work rows

Operator language may say "subagent," but the canonical browse contract must
preserve the R23 split:

- transcript-primary delegated work appears as `Child Sessions`;
- evidence-only scheduled or automation companions appear as `Automation Runs`.

Compact summaries should stay aggregated, such as:

- `Related Work: 2 child sessions, 1 automation run`

Expanded views may then list:

- child session label / agent cue / recency / workspace hint;
- automation job or run cue where the evidence supports it.

These rows should never be presented as ordinary top-level turn hits in default
search results.

## Search-To-Browse Transition Contract

The search result object stays `UserTurn`.

What changes in this objective is the **quality of the pivot after recovery**.
A strong search-to-browse flow should allow:

1. recover the matching turn in compact results;
2. expand into a richer result row or detail preview that shows why it matched;
3. pivot from that turn into its project, session, and nearby-turn context;
4. reveal any attached child-session or automation summary without confusing it
   for the original hit.

### Search surfaces should therefore support

- better match snippets or context cues in expanded search results;
- one-step pivots from a search hit into the enclosing project or session view;
- a bounded local tree under the selected hit, such as current turn + adjacent
  turns + related-work summary;
- preservation of the current default: search still returns turns first.

### Search surfaces should not do this

- return child sessions or automation runs as the default global search result
  type;
- flatten delegated prompts into parent-session user input;
- force operators into JSON just to answer "what session was this from?" or
  "did this spawn child work?"

## CLI Contract Recommendations

The CLI should keep one reusable read surface rather than growing many ad hoc
commands.

Recommended direction:

- keep `ls`, `tree`, `show`, and `search` as the main operator verbs;
- add flags or stable output modes rather than KR-specific commands;
- make long-format browsing available wherever compact listing already exists;
- let `tree` become the main hierarchy-focused surface instead of inventing a
  second tree-like command family;
- let `show` remain the bounded deep-inspection surface.

A likely truthful operator model is:

- `ls ...` = compact listing by default, optional long metadata view;
- `tree ...` = explicit hierarchy and grouped context;
- `show ...` = one object in detail, including related-work context;
- `search ...` = turn-first discovery with optional richer preview or direct
  pivot cues.

## TUI Contract Recommendations

The TUI should preserve the current keyboard-first three-pane model, but become
more rewarding when the operator lingers on one row.

Recommended direction:

- keep the existing browse/search mode split;
- use richer detail-pane summaries as the first expansion layer;
- add stronger visual grouping or tree cues inside the detail pane or turn pane
  before introducing radically new panes;
- expose related child work as grouped summaries and expandable sections,
  rather than as a new top-level browse mode;
- keep non-interactive snapshots aligned with the same contract so scripts and
  logs can still benefit from richer browse states.

## Implementation Shape For The Next KR

This note intentionally stops before concrete flag names or UI keybindings, but
it narrows the implementation direction:

1. first add a truthful long-format and hierarchy contract to CLI browse/search
   surfaces;
2. then add TUI expansion states and snapshot parity that follow the same
   metadata rules;
3. finally add regressions and guide updates that prove compact, long, tree,
   and related-work flows stay aligned.

## Acceptance Mapping To `R24-KR1`

This note satisfies the current `R24-KR1` tasks by:

- defining the compact / long / tree-style browse contract for CLI and TUI;
- naming the exact metadata that becomes more valuable in expanded views for
  projects, sessions, turns, and child work;
- defining search-to-browse transitions that keep default results `UserTurn`-
  first while still surfacing session and subagent context truthfully.
