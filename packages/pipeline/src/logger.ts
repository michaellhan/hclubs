import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level: string = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({ level, base: { app: "hci-pipeline" }, timestamp: pino.stdTimeFunctions.isoTime });
}

/** Silent logger for tests. */
export const silentLogger: Logger = pino({ level: "silent" });
