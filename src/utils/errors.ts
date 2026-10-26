/**
 * Errors that are safe to show to a human. Anything else is treated as a bug
 * and only prints a stack trace when --verbose is active.
 */
export class CliError extends Error {
  readonly exitCode: number;
  readonly hints: string[];

  constructor(message: string, exitCode = 1, hints: string[] = []) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.hints = hints;
  }
}

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
