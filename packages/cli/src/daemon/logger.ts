import { appendFile, chmod } from "fs/promises";
import { paths, ensureDirs } from "../config/paths";

export type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  data?: unknown;
}

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await ensureDirs();
    initialized = true;
  }
}

export async function log(level: LogLevel, msg: string, data?: unknown): Promise<void> {
  await ensureInit();
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(data !== undefined ? { data } : {}),
  };
  const line = JSON.stringify(entry) + "\n";
  await appendFile(paths.logFile, line, { encoding: "utf-8", mode: 0o600 });
  await chmod(paths.logFile, 0o600).catch(() => {});
}

export const logger = {
  info: (msg: string, data?: unknown) => log("info", msg, data),
  warn: (msg: string, data?: unknown) => log("warn", msg, data),
  error: (msg: string, data?: unknown) => log("error", msg, data),
  debug: (msg: string, data?: unknown) => log("debug", msg, data),
};
