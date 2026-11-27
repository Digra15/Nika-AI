export type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
  constructor(private readonly scope: string) {}

  private format(level: LogLevel, message: string): string {
    const ts = new Date().toISOString();
    return `[${ts}] [${level.toUpperCase()}] [${this.scope}] ${message}`;
  }

  debug(message: string, meta?: unknown): void {
    if (meta !== undefined) {
      console.debug(this.format("debug", message), meta);
    } else {
      console.debug(this.format("debug", message));
    }
  }

  info(message: string, meta?: unknown): void {
    if (meta !== undefined) {
      console.info(this.format("info", message), meta);
    } else {
      console.info(this.format("info", message));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (meta !== undefined) {
      console.warn(this.format("warn", message), meta);
    } else {
      console.warn(this.format("warn", message));
    }
  }

  error(message: string, meta?: unknown): void {
    if (meta !== undefined) {
      console.error(this.format("error", message), meta);
    } else {
      console.error(this.format("error", message));
    }
  }
}
