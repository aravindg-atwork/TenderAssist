const SECRET_KEY_FRAGMENTS = ['password', 'pin', 'token', 'secret', 'credential', 'privatekey'];

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const isSecret = SECRET_KEY_FRAGMENTS.some((fragment) => key.toLowerCase().includes(fragment));
    out[key] = isSecret ? '[REDACTED]' : value;
  }
  return out;
}

function write(level: LogLevel, message: string, fields: LogFields): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redact(fields),
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, fields: LogFields = {}) => write('debug', message, fields),
  info: (message: string, fields: LogFields = {}) => write('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => write('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => write('error', message, fields),
};
