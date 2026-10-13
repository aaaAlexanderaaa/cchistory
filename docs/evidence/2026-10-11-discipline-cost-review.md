---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-11
subject: docs/contracts/development-discipline.md
---

# Project discipline refresh independent engineering-cost review

## Scope and independence

- Contract/design revision: the 2026-10-11 target
  `docs/contracts/development-discipline.md`, SHA-256
  `0759ee9c731aa0de363f8cf7309bb7d75eb07e8a282bb87cea7dd56f2eb1ef0a`, and
  `docs/plans/2026-10-11-project-discipline-refresh.md`, SHA-256
  `d508de061c263b633a7eff41c04d3bd9c3abcf0ee427152e945f22eb12e92fe3`.
- Original request supplied to this reviewer: on 2026-10-11,
  “项目纪律也更新一下，参考../template-project”. The accepted implementation
  scope is recorded separately in R47 and the proposal, rather than attributed
  verbatim to that request.
- Reviewer/context identity: `/root/discipline_cost_review`, a separately
  dispatched agent context that did not author the proposal or implementation.
- Assigned lens: engineering cost, maintenance, extensibility, and dependency
  guard scope.
- Independence required and achieved: yes for this design lens. This context
  inspected the governing files, source template, existing verifier, and local
  baseline directly. It is not the separate synthesis or completion evaluator.
  Shared repository inputs and the inherited model remain common dependencies;
  no model variation or independent external acquisition is claimed.
- Work bound: one design review and, if requested, one corrective recheck. Only
  this report was written. No product/store/git mutation, dependency install,
  build, persistent service, external call, or billed-resource probe was used.

## Inputs

- Frozen semantics and architecture: `HIGH_LEVEL_DESIGN_FREEZE.md`, especially
  §§4.1, 9.3, 9.5, 10.4, 11, 12, 16, and 17; `ARCHITECTURE.md`, including
  dependency direction, ownership, and architecture enforcement.
- Current governance: root `AGENTS.md`, `PIPELINE.md`, `docs/README.md`,
  `docs/contracts/repository-governance.md`, `docs-policy.json`, and R47 in
  `BACKLOG.md`. The July governance migration remains a target with its own
  outstanding evidence; this review does not close it.
- Proposal: target development-discipline contract and complete-end-state plan
  identified above; `docs/templates/independent-review.md` supplies this form.
- Existing guard: `architecture-rules.json`,
  `scripts/verify-architecture-boundaries.mjs`,
  `scripts/verify-architecture-boundaries.test.mjs`,
  `scripts/verify-lite-boundaries.mjs`, and root `package.json`.
- Source template: clean checkout `../template-project` at HEAD
  `1099ddc6568af5bb2e4a1d080dfc315653cbff58`; its root `AGENTS.md` and applicable
  current sections of `docs/contracts/development-discipline.md`,
  `agent-execution-discipline.md`, `documentation-harness.md`, and
  `project-adoption.md`. Relevant rules cover single ownership, smallest routes,
  conditional concerns, valid evidence reuse, separate scale axes, declared
  mechanical scope, staged existing-project adoption, and transfer value before
  tooling. Source approval labels are not CCHistory acceptance evidence.
- Local baseline: CCHistory HEAD `36d209ec878020d80861884a07dfc8217be4461a`,
  branch `master`, with substantial pre-existing product changes and untracked
  files. This is a working-tree review, not a clean-commit or branch-compliance
  claim.

Read-only observations:

- `node scripts/verify-architecture-boundaries.mjs` exits 1 with exactly three
  matches: harmless `apps/tui` comments at line 4 of
  `apps/lite-tui/src/colors.ts`, `input.ts`, and `state.ts`. Removing or rewriting
  those comments would preserve the checker's wrong mechanism.
- `require.resolve('typescript')` resolves the existing TypeScript 5.9.3
  dependency. No new parser package or installation is needed.
- An in-memory TypeScript `SourceFile` probe parses static type imports,
  re-exports, import-equals, import types, template-literal dynamic import,
  escaped require literals, computed import, require aliasing, `module.require`,
  and `require.resolve` without syntax diagnostics. Merely checking parse
  success cannot establish that a visitor inspected all these forms.
- The existing Lite verifier walks workspace manifest dependencies and checks
  quoted package strings. It remains useful domain evidence, but is not a
  resolver for arbitrary relative, computed, or aliased runtime loads.

## Findings

| Finding | Severity | Evidence | Required action |
|---|---|---|---|
| Adoption has a coherent, economical owner map | PASS | Contract scope and concern table; plan owner/gap table; existing Node/pnpm gates | Preserve this scope. No new Python harness, autonomy charter, or copied concern-contract collection is needed. |
| Records and scale checks are proportionate | PASS | Contract explicitly avoids per-edit concern records, empty effect ledgers, and universal 100/1,000 counts; reuse requires identity, criteria, dependency, and freshness validity | Carry these rules into live entrypoints and templates without adding routine-only records or fixed-count gates. |
| Syntax-aware repair is necessary and can reuse an existing dependency | Required cutover evidence; no preimplementation defect | Baseline three comment failures; TypeScript already installed; plan explicitly names module forms and negative fixtures | Demonstrate comment/ordinary-text acceptance and actual forbidden-reference rejection. Cover import/export, type and import-equals forms, decoded escaped literals, literal require and dynamic import, and unsupported nonliteral direct loads. Reject parser/configuration failure rather than returning a clean dependency result. |
| Relative paths and containment must be checked separately from package spelling | Required cutover evidence; already in plan | Manifest currently names `@cchistory/storage`, while `../../../packages/storage/src/index.js` can name the same owner without that string; existing scanner has vacuity and symlink guards | Normalize paths from each importing file into declared forbidden owner roots, including `..` segments, re-export/type/dynamic forms, subpaths, and path-segment boundaries. Preserve include-root and nested-symlink rejection, repository escapes, vacuous rules, and invalid-mode diagnostics. Do not assume a package-name substring covers an owner path. |
| Supported syntax needs an honest limit | Required scope statement at cutover | Alias calls, `module.require`, `require.resolve`, `createRequire` aliases, and computed loads are distinct syntax; the Lite verifier is not a universal runtime resolver | State which direct forms are recognized or explicitly rejected and which alias/data-flow/resolver cases remain outside scope. Do not claim full runtime-graph proof from the generic guard. Extend an owning domain verifier if a future dependency mechanism needs that proof. |
| Avoid repeating parse and I/O work for every forbidden pattern | Preference | Existing verifier rereads each matching file per pattern; AST parsing increases that repeated cost | Prefer reading/parsing each rule-file once and comparing extracted references against the rule. A streaming or short-lived SourceFile visitor is sufficient; a TypeScript Program/typechecker is unnecessary for the stated syntactic claim. No benchmark threshold is required for this small guard without a demonstrated cost mechanism. |

No required correction to the proposal was identified before implementation.
The required rows are delivery obligations and scope limits for the proposed
repair, not evidence that the unimplemented guard already meets them.

## Trade-offs and residual risk

- Recommended approach: adopt practices at CCHistory's existing owners, reconcile
  the live entrypoints/templates together, retain the Node scripts and profile
  boundaries, and use the installed language parser for declared module syntax.
  Keep the generic guard and domain verifiers complementary.
- Rejected alternative and reason: copying the sibling's Python/TOML harness or
  extensive contract stock would create a second toolchain and competing owners
  without solving an unmet CCHistory boundary. Stripping harmless comments would
  hide the current false positive while leaving the dependency rule unsound.
- Literal syntax checking is deliberately cheaper than full module resolution.
  Bare package exports, tsconfig aliases, loader aliases, runtime construction,
  `eval`, and host-specific resolution require explicitly bounded claims. Do not
  add speculative data-flow machinery simply to advertise universal coverage.
- Fail-closed direct nonliteral loading can reject an otherwise legitimate
  plugin pattern. If such a pattern becomes required, reconcile the owning
  boundary and verifier rather than suppressing its diagnostic globally.
- A reduced record burden is sound only while concern activation remains
  normative and required independent review cannot be downgraded for lack of
  resources. This cutover correctly uses the pre-existing independent gate.
- Retained evidence can reduce later effort only when a matching task retrieves
  and applies it under still-valid conditions. This review proves neither future
  adoption nor measured acceleration. Scale probes should test a named growth,
  accumulation, or concurrency mechanism; no mandatory item count is added.

## Limitations

- Design review only: live governance and the syntax-aware guard have not been
  changed or validated by this context. The root implementer owns meaningful
  positive/negative fixtures, current domain gates, and scoped diff inspection.
- In-memory AST probes establish parsing/visitor risks, not implemented guard
  behavior. No fixture suite or build was run by this reviewer.
- Relevant source rules were inspected directly; template source anchors remain
  reported provenance where their original human conversations are unavailable.
- This review does not establish sustained agent behavior, arbitrary JavaScript
  dependency resolution, product performance, Full/Lite runtime parity, or
  completion of unrelated storage, manual-service, or July governance work.
- The live working tree may change after the identified proposal hashes. A
  material change to the relevant contract, guard scope, or owner map invalidates
  the affected judgment and should receive the bounded corrective recheck.

## Verdict

`PASS` — engineering/maintenance **design** lens. The scoped proposal is the
smallest coherent adoption, and its required guard/evidence obligations are
credible without an added toolchain or universal scale test.

This verdict permits implementation under the required separate synthesis. It
does not close R47, pass an unimplemented checker, or replace fresh completion
evaluation. No additional human approval is requested by this lens.
