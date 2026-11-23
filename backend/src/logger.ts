export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export type LogSink = (line: string) => void;

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

export const createLogger = (sink: LogSink = stdoutSink): Logger => {
  const emit = (level: string, msg: string, fields: LogFields = {}): void => {
    sink(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
  };
  return {
    info: (msg, fields) => {
      emit('info', msg, fields);
    },
    warn: (msg, fields) => {
      emit('warn', msg, fields);
    },
    error: (msg, fields) => {
      emit('error', msg, fields);
    },
  };
};
