import process from "node:process";

const SQLITE_EXPERIMENTAL_WARNING_TEXT = "SQLite is an experimental feature and might change at any time";
const SHOW_RUNTIME_WARNINGS_ENV = "CCHISTORY_SHOW_RUNTIME_WARNINGS";

/**
 * Installs a process.emitWarning filter that suppresses the Node.js SQLite
 * experimental-feature warning. Call this once at the top of any entrypoint
 * that uses node:sqlite, before any dynamic imports that trigger the warning.
 *
 * The filter is idempotent: calling it multiple times is safe.
 * Set CCHISTORY_SHOW_RUNTIME_WARNINGS=1 to disable the filter and see all warnings.
 */
export function installRuntimeWarningFilter(): void {
  if (process.env[SHOW_RUNTIME_WARNINGS_ENV] === "1") {
    return;
  }

  const currentEmitWarning = process.emitWarning as typeof process.emitWarning & {
    __cchistoryRuntimeFilterInstalled?: boolean;
  };
  if (currentEmitWarning.__cchistoryRuntimeFilterInstalled) {
    return;
  }

  const originalEmitWarning = process.emitWarning.bind(process);
  const filteredEmitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning.message;
    if (message.includes(SQLITE_EXPERIMENTAL_WARNING_TEXT)) {
      return;
    }
    return (originalEmitWarning as (...values: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning & { __cchistoryRuntimeFilterInstalled?: boolean };

  filteredEmitWarning.__cchistoryRuntimeFilterInstalled = true;
  process.emitWarning = filteredEmitWarning;
}
