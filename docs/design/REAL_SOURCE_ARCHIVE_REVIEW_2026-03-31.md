# Real Source Archive Review 2026-03-31

## Status

- Source archive: `.realdata/config_dots_20260331_212353.tar.gz`
- Extracted review root: `.realdata/config_dots_20260331_212353/`
- Purpose: Phase 1 real-data structure review from a headless host export of
  dot-file roots
- Safety rule: this archive contains real data and must not be copied directly
  into `mock_data/`; any fixture work must produce fully anonymized structural
  derivatives only
- Repeatable verifier: `pnpm run verify:real-archive-probes` re-checks the Gemini, Cursor chat-store, CodeBuddy, and OpenCode structure assumptions this review promoted into active backlog work

## Coverage Summary

The extracted archive provides transcript-bearing or likely transcript-bearing
evidence for multiple sources already in or near the current product surface.
It does not currently provide OpenClaw or LobeHub/LobeChat transcript data.

| Source / candidate | Observed roots | Evidence count | Notes |
| --- | --- | ---: | --- |
| `codex` | `.codex/sessions/**` | 194 files | Existing stable adapter still has a large real corpus for future regression hardening. |
| `claude_code` | `.claude/projects/**/*.jsonl` | 33 files | Existing stable adapter still has a real corpus for fixture expansion if needed. |
| `factory_droid` | `.factory/sessions/**/*.jsonl` + `*.settings.json` | 85 transcript + 85 sidecar | Confirms transcript + sidecar pairing at scale. |
| `gemini` | `.gemini/tmp/<hash>/chats/*.json` + `logs.json` | 293 chat JSON files | Real archive contains a large Gemini corpus but no observed `.project_root` or `projects.json` companions. |
| `opencode` | `.local/share/opencode/storage/**` | 1 session + 10 messages + 44 parts | Real layout differs from the current provisional assumptions. |
| `cursor` CLI candidate | `.cursor/chats/**/store.db` | 4 SQLite stores | At review time the `cursor` adapter did not scan this layout; follow-up objective `R13` now adds an experimental metadata/readable-fragment intake slice under the `cursor` platform. |
| `codebuddy` candidate at review time | `.codebuddy/projects/**/*.jsonl` | 9 files | Some files are empty; non-empty files contain transcript-shaped JSONL rows. Later backlog work turned this reviewed candidate into `R14` intake work and then a `stable` adapter via `R16`. |
| `openclaw` | not observed | 0 | Still blocked on real sample acquisition. |
| `lobechat` / `lobehub` | not observed | 0 | Still blocked on real sample acquisition. |

## Structure Findings

### OpenCode

Observed real roots are centered under `.local/share/opencode/storage/`, not
the earlier provisional `~/.local/share/opencode/project` transcript root.

Observed files in this archive:

- `storage/project/global.json`
- `storage/session/global/*.json`
- `storage/message/<session-id>/*.json`
- `storage/part/<message-id>/*.json`
- `storage/session_diff/*.json`
- `storage/todo/*.json`
- auxiliary state under `.local/state/opencode/` and `.config/opencode/`

Representative key shapes confirm a multi-layer structure:

- session JSON: `directory`, `id`, `projectID`, `summary`, `time`, `title`,
  `version`
- message JSON: `agent`, `id`, `model`, `role`, `sessionID`, `summary`, `time`
- part JSON: `id`, `messageID`, `sessionID`, `text`, `type`
- project JSON: `id`, `time`, `worktree`

Implications:

- current `packages/source-adapters/src/platforms/opencode.ts` root candidates
  and file matcher are no longer truthful enough for real-world stabilization
- parser work must verify whether `session_diff` and `todo` are derivation-
  critical evidence, evidence-only companions, or ignorable noise
- fixture work must cover the real `storage/session/global` layout and the
  message/part indirection rather than only the earlier assumed session shape

### Gemini CLI

The archive contains many Gemini session files under `.gemini/tmp/<hash>/chats`
with sibling `logs.json` files. Representative session JSON keys are:

- `lastUpdated`
- `messages`
- `projectHash`
- `sessionId`
- `startTime`

Representative `logs.json` items contain:

- `message`
- `messageId`
- `sessionId`
- `timestamp`
- `type`

Implications:

- current Gemini support must be re-checked against a real corpus where the
  archive does not include `.project_root` or `projects.json`
- parser and fixture work must explicitly cover the missing-companion case,
  rather than assuming those evidence files are always present
- mock-data should add scale-representative Gemini scenarios derived from this
  corpus once full anonymization is in place

Archive-review closure for backlog task `R12-KR1/review real Gemini bundle
structure and missing-companion cases`:

- confirmed transcript-bearing layout: `.gemini/tmp/<hash>/chats/*.json`
- confirmed sibling activity log: `.gemini/tmp/<hash>/logs.json`
- confirmed absence in this archive: no observed `.gemini/tmp/<hash>/.project_root`,
  no observed `.gemini/history/<hash>/.project_root`, and no observed
  `.gemini/projects.json` companion usable for these sessions
- conclusion: missing companion metadata is a real supported case that must be
  fixture-covered and parser-safe rather than treated as corruption

### Cursor CLI / chat-store candidate

The archive includes `.cursor/chats/<workspace-hash>/<agent-id>/store.db`
SQLite databases. Representative schema review showed:

- table `meta(key TEXT, value TEXT)`
- table `blobs(id TEXT, data BLOB)`

This is not the `state.vscdb` or `agent-transcripts/*.jsonl` layout currently
covered by the `cursor` adapter.

Implications:

- the current `cursor` adapter should not be assumed to cover Cursor CLI/chat
  storage just because it already supports Cursor editor-state sources
- phase-1 design work must decide whether this belongs under the existing
  `cursor` platform or a new source platform while preserving frozen canonical
  semantics
- any future parser work will need blob-decoding and workspace/session identity
  rules backed by real fixtures

Archive-review closure for backlog task `R12-KR2/inspect Cursor chat-store
schema and blob/meta encoding from real samples`:

- `meta.value` appears to hold encoded session metadata rather than plain text
  transcript rows
- `blobs.data` stores binary payloads keyed by opaque blob ids, so message and
  attachment recovery depends on an explicit blob-decoding rule
- current evidence is enough to justify a dedicated ownership decision, but not
  enough to claim that the existing `cursor` adapter already supports this
  source family variant

### CodeBuddy and Other Candidates

The archive includes `.codebuddy/projects/<workspace>/*.jsonl` plus logs and
local-storage files. Non-empty transcript rows use keys such as:

- `content`
- `id`
- `providerData`
- `role`
- `type`
- optional `status`

The same archive also includes `.kiro`, `.happy`, `.roo`, `.zai`, and related
config/runtime roots, but this review has not yet confirmed which of those are
transcript-bearing versus config-only.

Implications:

- at the time of this 2026-03-31 archive review, `codebuddy` was a plausible
  future adapter candidate and should enter the canonical intake workflow
  rather than ad hoc parser experimentation; later backlog work did exactly
  that and eventually promoted it to `stable`
- the other roots need a transcript-vs-config classification pass before any
  adapter proposal is made

Current transcript-vs-config classification from the archive review:

| Root | Current classification | Evidence basis | Backlog consequence |
| --- | --- | --- | --- |
| `.codebuddy` | transcript-bearing candidate at review time | non-empty `projects/**/*.jsonl` rows with `role`, `content`, and `providerData` | this archive evidence justified future-source intake work, which later became `R14` and then `R16` |
| `.kiro` | not yet justified | settings and CLI config only in the reviewed archive slice | do not create adapter objective yet |
| `.happy` | not yet justified | settings, keys, temp hooks; no reviewed transcript corpus yet | do not create adapter objective yet |
| `.roo` | config/reference only in this review | rules-mode XML assets rather than conversation evidence | do not create adapter objective yet |
| `.zai` | not yet justified | root observed but no reviewed transcript-bearing files recorded | do not create adapter objective yet |

## Repeatable Probe Command

The archive assumptions in this note are now guarded by `pnpm run verify:real-archive-probes`. The command fails if the checked Gemini, Cursor chat-store, CodeBuddy, or OpenCode structures drift away from the review basis captured here, so future sessions do not need to rely on one-off shell probes or memory of the 2026-03-31 archive walkthrough.

## Backlog Decisions From This Review

- `R1` should no longer treat OpenCode and OpenClaw as one uniformly blocked
  slice: OpenCode now has executable real-data follow-up work, while OpenClaw
  remains blocked on sample acquisition.
- A new objective should harden experimental or not-yet-registered sources
  backed by this archive, starting with Gemini real-data validation, Cursor CLI
  classification, and new-tool intake for CodeBuddy and similar roots.
- A separate objective should introduce a canonical TUI as a projection of the
  same canonical model used by CLI, API, and web.

