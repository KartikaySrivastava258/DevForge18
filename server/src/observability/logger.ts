/**
 * Minimal structured (JSON-lines) logger. Each line is one JSON object so
 * logs can be parsed by any log pipeline. Never pass request bodies,
 * cookies, passwords or tokens to the logger; keys that look sensitive are
 * redacted as a second line of defence.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const SENSITIVE_KEY = /pass(word)?|token|secret|cookie|authorization|session/i;

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) out[key] = "[redacted]";
    else if (value instanceof Error) out[key] = { name: value.name, message: value.message, stack: value.stack };
    else out[key] = value;
  }
  return out;
}

export function createLogger(
  minLevel: LogLevel,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  const log = (level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void => {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...redact(fields) }));
  };
  return {
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
