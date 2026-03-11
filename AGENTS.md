# Repository Guidelines

## Source Of Truth
`HIGH_LEVEL_DESIGN_FREEZE.md` is the authoritative definition of product scope and architecture. Read it before changing docs, code, or data models. Contributions must preserve the frozen invariants there: project-first history, `UserTurn` as the primary object, evidence-preserving ingestion, and UI/API as projections of one canonical model.

## Repository Scope
This repository currently contains three different classes of material.

- Root docs: the current project definition and decision surface.
- `frontend_demo/`: an imported UI/UX reference. It is useful for interaction ideas, but it is not the product, not the canonical frontend, and must not define architecture or domain semantics.
- `archive/`: the previous MVP and historical documents. Use it as reference material only, especially for known source parsing and ingestion patterns. Do not treat archived routes, schemas, or UX as the baseline for new work.

## Build, Test, And Development Commands
There is no single repository-wide build target yet. Use commands only for the layer you are inspecting.

- `cd frontend_demo && pnpm dev`: view the reference UI locally.
- `cd frontend_demo && pnpm build`: verify the imported demo still builds.
- `cd apps/web && pnpm dev`: run the product web UI on `0.0.0.0:8085` for remote review.
- `pnpm restart:web`: restart the product web dev server on `0.0.0.0:8085` and refresh the pid/log files.
- `cd archive/legacy/server && pytest`: validate legacy parser or ingestion behavior when mining reference code.
- `cd archive/legacy/server && python -m ruff check cchistory tests`: lint archived Python reference code.
- `cd archive/legacy/web && pnpm test`: compare old MVP frontend behavior if needed.

## Web Runtime Workflow
When a user is actively reviewing `apps/web` UI changes, keep the dev server reachable on `0.0.0.0:8085`. After meaningful web code changes that need live verification, restart the web dev server with `pnpm restart:web` unless the user explicitly says not to.

## Browser Automation Policy
Browser automation for this repository must use the wrapped skill entrypoint or MCP only.

- Always use the Playwright skill wrapper at `/Users/alex_m4/.codex/skills/playwright/scripts/playwright_cli.sh` when driving a browser from the terminal.
- MCP-based browser automation is also allowed when available and appropriate.
- Do not invoke `npx playwright`, `playwright-cli`, `node <cached-playwright-cli>`, or any Playwright binary/script from npm cache, global installs, or ad hoc filesystem locations.
- Do not bypass the wrapper by calling Playwright packages from `~/.npm`, `node_modules/.bin`, `/tmp`, or any non-skill directory.
- If the wrapped skill is broken or blocked, stop and fix the wrapped skill or ask the user; do not work around it with a different Playwright entrypoint.

## Memory And Build Constraints
> This host is memory-constrained. Assume 4 GB RAM and only 3G RAM is usable (avoid OOM) unless a user states otherwise.
>
> Workspace-wide `pnpm install`, workspace-wide `pnpm build`, and parallel multi-package compilation are not acceptable default actions on this machine.

- Never run `pnpm install` at the repository root unless the user explicitly asks for it and the memory tradeoff is acknowledged first.
- Never run `pnpm build` at the repository root as a default verification step.
- Prefer one package at a time with `pnpm --filter <package> ...`.
- Prefer typecheck, targeted tests, or focused probes over full Next.js production builds.
- When a web build is necessary, run it alone and cap Node memory, for example `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`.
- Do not launch multiple TypeScript, Vite, or Next.js build processes in parallel on this host.
- If a dependency install is necessary, keep it scoped to the smallest package set that can answer the question or validate the change.

## Coding Style & Naming Conventions
When adding new material, keep changes small and map them back to the design freeze. Reuse domain terms exactly as defined there, including `UserTurn`, `ProjectIdentity`, `MaskTemplate`, `KnowledgeArtifact`, `candidate`, `committed`, and `unlinked`. New source work may borrow parser ideas from `archive/`, but source-specific quirks must stop at the capture/parse boundary and must not leak into product semantics.

## Testing Guidelines
Test the layer you actually changed. Design-only edits should cite the affected sections in `HIGH_LEVEL_DESIGN_FREEZE.md`. Reference-code work should run only the relevant legacy tests and clearly state that the result validates historical code, not the future implementation.

## Commit & Pull Request Guidelines
Use short Conventional Commit subjects such as `feat:` and `docs:`. PRs should state whether the change affects the frozen design, the imported UI reference, or archived parser research. List commands run, and for UI exploration changes include screenshots labeled as demo/reference output.

## Response Structuring Protocol
Apply this protocol to any non-trivial explanation, review, design note, or decision memo. The goal is to preserve global context, separate dimensions cleanly, and avoid fragmented answers.

- Start with a global model of the question. Identify the main dimensions before writing, and keep terminology and referents consistent across the full response.
- Organize by logic, not by narration. When a request contains multiple dimensions, give each dimension its own top-level section using `#` headings. Do not structure the answer as a running timeline of what was checked or done.
- Anchor each section with a verdict sentence. The first line under each top-level heading should be one bold sentence stating the conclusion for that section.
- Choose visualization by content type instead of defaulting to paragraphs:
  - comparisons, tradeoffs, feature matrices, and multi-attribute summaries should use Markdown tables;
  - procedures, execution paths, and priority order should use numbered lists;
  - concepts, causes, and structural explanations should use bullet lists;
  - use diagrams, pseudocode, or other structured formats when they communicate more clearly than prose.
- Isolate constraints physically. Put warnings, assumptions, environment limits, version notes, and prerequisites in blockquotes using `>`.
- Remove conversational filler and meta-output. Avoid phrases that narrate the answering process or comment on the answer itself.
- Keep each item dense and direct. Prefer short factual statements over decorative language, but do not compress away necessary context.
- Avoid ambiguous pronouns or shifting references. If two entities can be confused, name them explicitly instead of relying on `it`, `this`, or similar shorthand.
