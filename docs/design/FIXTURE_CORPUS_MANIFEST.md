# Fixture Corpus Manifest
The current fixture corpus is organized by source family shape and parser risk, without copying sensitive real-session content into the repository.

> Source-of-truth semantics remain frozen in `HIGH_LEVEL_DESIGN_FREEZE.md`.
>
> This manifest records shape coverage only. It does not embed private transcripts, prompts, or tool payloads from sampled local sessions.

# Coverage Model
Each fixture corresponds to one representative source shape or one explicit parser failure mode.

- One fixture should represent the happy-path shape for each supported local source family.
- One fixture should represent a malformed or forward-compatible unknown-content shape for each supported local source family.
- Fixture names should describe the structural case, not the original user intent.
- Real sampled sessions may inform fixture design, but repository fixtures must stay synthetic and redactable.

# Source Families
The current fixture set covers all eleven registered adapters across both `local_coding_agent` and `conversational_export` families.

| Source family | Happy-path structural coverage | Malformed / edge coverage | Current repository location |
| --- | --- | --- | --- |
| `Codex` | `session_meta`, `turn_context`, message, tool call, tool result, unsupported content item | truncated JSONL record, unknown fragment, opaque meta atom | `packages/source-adapters/src/index.test.ts`, `platforms/codex.test.ts` |
| `Claude Code` | cwd/workspace signals, text items, `tool_use`, `tool_result`, relation hints | unsupported content item preserved as unknown fragment + loss audit | `packages/source-adapters/src/index.test.ts`, `platforms/claude.test.ts` |
| `Factory Droid` | `session_start`, message items, sidecar model/workspace metadata, partial tool results | missing-field partial tool result and title/model sidecar coverage | `packages/source-adapters/src/index.test.ts`, `platforms/factory-droid.test.ts` |
| `AMP` | root thread metadata, message array, tool edges, workspace evidence | malformed root JSON preserved as raw record + unknown fragment | `platforms/amp.test.ts` |
| `Cursor` | SQLite VSCode state DB, chat sessions, workspace path extraction | Windows-style path handling | `platforms/cursor.test.ts`, `mock_data/` |
| `Antigravity` | brain task artifacts, trajectory state DB, live seed extraction | cron-trigger automation evidence not classified as user turns | `platforms/antigravity.test.ts`, `core/discovery.test.ts` |
| `Gemini` | export JSON session, message pairs, workspace signal | nested directory discovery | `platforms/gemini.test.ts`, `core/discovery.test.ts` |
| `OpenClaw` | agents/sessions JSONL layout, cron automation vs user-turn boundary | real-archive sanitized fixtures | `platforms/openclaw.test.ts`, `mock_data/` |
| `OpenCode` | storage session/message/part tree, workspace JSON | multi-session tree, config-only roots excluded | `platforms/opencode.test.ts`, `mock_data/` |
| `LobeChat` | exported JSON bundle with messages, single and multi-conversation array | non-JSON files excluded by matchesSourceFile | `platforms/lobechat.test.ts`, `core/discovery.test.ts` |
| `CodeBuddy` | JSONL transcript with `type:user`/`assistant`, skipRun echoes, empty siblings | empty user messages excluded, skipRun audit emitted | `platforms/codebuddy.test.ts` |

# Sampled Shape Rules
Real local samples should be mined only for structure and parser invariants, not for content.

- Record stable field names, ordering quirks, and nesting patterns.
- Record which fields are optional, repeated, renamed, or source-version-dependent.
- Record where project evidence originates, such as cwd, repo metadata, or source-native ids.
- Record failure signatures, such as malformed JSON, unsupported content arrays, or partial tool results.
- Do not store raw secrets, long prompts, or identifiable conversation content in the fixture corpus.

# Next Additions
The next fixture work should target breadth of sampled shapes rather than larger synthetic transcripts.

1. Add one manifest row per real sampled parser shape version when a source format changes.
2. Split happy-path fixtures from malformed fixtures into clearly named groups.
3. Add parser notes for any source-family field that must stop at the fragment boundary.
4. Add fixture cases that exercise manual project overrides, replay diffs, and masked content.
