import { readFile, writeFile, unlink, chmod } from "fs/promises";
import { paths, ensureDirs } from "../config/paths";
import { logger } from "./logger";

export async function writePidFile(): Promise<void> {
  await ensureDirs();
  await writeFile(paths.pidFile, String(process.pid), { encoding: "utf-8", mode: 0o600 });
  await chmod(paths.pidFile, 0o600).catch(() => {});
}

export async function readPidFile(): Promise<number | null> {
  try {
    const raw = await readFile(paths.pidFile, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export async function removePidFile(): Promise<void> {
  try {
    await unlink(paths.pidFile);
  } catch {
    // Ignore if already removed
  }
}

export async function removeSocket(): Promise<void> {
  try {
    await unlink(paths.socket);
  } catch {
    // Ignore if already removed
  }
}

export async function removeControlPortFile(): Promise<void> {
  try {
    await unlink(paths.controlPortFile);
  } catch {
    // Ignore if already removed
  }
}

export async function removeAuthToken(): Promise<void> {
  try {
    await unlink(paths.authToken);
  } catch {
    // Ignore if already removed
  }
}

export function isDaemonRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type ShutdownFn = () => Promise<void> | void;
const shutdownHandlers: ShutdownFn[] = [];

export function onShutdown(fn: ShutdownFn): void {
  shutdownHandlers.push(fn);
}

let shuttingDown = false;

export function installSignalHandlers(): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await logger.info(`Received ${signal}, shutting down...`);
    for (const fn of shutdownHandlers) {
      try {
        await fn();
      } catch (e) {
        await logger.error("Shutdown handler error", e);
      }
    }
    await removePidFile();
    await removeSocket();
    await removeControlPortFile();
    await removeAuthToken();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
