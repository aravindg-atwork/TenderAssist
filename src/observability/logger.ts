const SECRET_KEY_FRAGMENTS = [
  'password',
  'pin',
  'token',
  'secret',
  'credential',
  'privatekey',
  'key',
  'apikey',
  'auth',
  'authorization',
  'bearer',
  'cookie',
  'session',
  'otp',
  'passphrase',
];

const MAX_REDACTION_DEPTH = 5;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_REDACTION_DEPTH) return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const isSecret = SECRET_KEY_FRAGMENTS.some((fragment) => key.toLowerCase().includes(fragment));
      out[key] = isSecret ? '[REDACTED]' : redactValue(val, depth + 1, seen);
    }
    return out;
  }

  return value;
}

function redact(fields: LogFields): LogFields {
  const seen = new WeakSet<object>();
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const isSecret = SECRET_KEY_FRAGMENTS.some((fragment) => key.toLowerCase().includes(fragment));
    out[key] = isSecret ? '[REDACTED]' : redactValue(value, 1, seen);
  }
  return out;
}

function write(level: LogLevel, message: string, fields: LogFields): void {
  const entry = {
    ...redact(fields),
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, fields: LogFields = {}) => write('debug', message, fields),
  info: (message: string, fields: LogFields = {}) => write('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => write('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => write('error', message, fields),
};
