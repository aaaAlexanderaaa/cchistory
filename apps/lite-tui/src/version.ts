/**
 * Lite TUI version.
 *
 * Held as a constant rather than read from `package.json` at runtime: the
 * standalone release artifact ships only `apps/lite-tui/dist`, so there is no
 * manifest beside the entrypoint to read. `index.test.ts` asserts this value
 * matches the package manifest so the two cannot drift.
 */
export const VERSION = "0.3.0";
