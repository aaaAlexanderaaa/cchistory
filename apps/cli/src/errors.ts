/**
 * Structured CLI error carrying a semantic exit code.
 *
 * Conventions:
 *   0  success (never thrown; included for completeness)
 *   1  general/unexpected error (default if no exitCode is set)
 *   2  usage error — bad arguments, unknown command, missing required flag
 *   3  store not found at the resolved path
 *   4  validator / verification gate failed (e.g. `migration validate`)
 *   5  command ran but surfaced issues (e.g. doctor found warnings)
 *   64 command declined to run (refused an unsafe operation, e.g. `migration reset` blocking on running markers)
 */
export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

export function usageError(message: string): CliError {
  return new CliError(message, 2);
}

export function storeNotFoundError(message: string): CliError {
  return new CliError(message, 3);
}

export function verificationError(message: string): CliError {
  return new CliError(message, 4);
}

export function issuesFoundError(message: string): CliError {
  return new CliError(message, 5);
}

export function declinedError(message: string): CliError {
  return new CliError(message, 64);
}
