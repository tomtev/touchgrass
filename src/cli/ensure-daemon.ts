import { readPidFile, isDaemonRunning } from "../daemon/lifecycle";
import { daemonRequest } from "./client";
import { statSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { paths } from "../config/paths";

function hasActiveSessions(status: Record<string, unknown>): boolean {
  const sessions = status.sessions;
  if (!Array.isArray(sessions)) return false;
  return sessions.some((session) => {
    if (!session || typeof session !== "object") return false;
    const state = (session as { state?: unknown }).state;
    return state === "running" || state === "remote";
  });
}

function shouldRestartDaemonForVersion(
  daemonStartedAt: number | undefined,
  scriptMtime: number,
  status: Record<string, unknown> | null
): boolean {
  if (!daemonStartedAt || !scriptMtime || scriptMtime <= daemonStartedAt) return false;
  // Preserve live sessions. If status is unavailable, default to no restart.
  if (!status) return false;
  if (hasActiveSessions(status)) return false;
  return true;
}

interface DaemonProcess {
  pid: number;
  home?: string;
}

function parseDaemonPidsFromPs(psOutput: string): DaemonProcess[] {
  const daemons = new Map<number, DaemonProcess>();
  for (const rawLine of psOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = parseInt(match[1], 10);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const command = match[2];
    if (!command.includes("__daemon__")) continue;

    const isTouchgrassDaemon =
      /(^|[\/\s])tg(?:\.exe)?\s+__daemon__(\s|$)/i.test(command) ||
      /\btouchgrass\b/i.test(command);
    if (!isTouchgrassDaemon) continue;
    const eqMatch = command.match(/--tg-home=([^\s]+)/);
    const valueMatch = command.match(/--tg-home\s+([^\s]+)/);
    const home = (eqMatch?.[1] || valueMatch?.[1])?.trim();
    daemons.set(pid, { pid, home });
  }
  return Array.from(daemons.values());
}

function listDaemonPidsFromSystem(): DaemonProcess[] {
  if (process.platform === "win32") return [];
  try {
    const out = Bun.spawnSync(["ps", "-axo", "pid=,command="], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (out.exitCode !== 0) return [];
    return parseDaemonPidsFromPs(new TextDecoder().decode(out.stdout));
  } catch {
    return [];
  }
}

function selectDuplicateDaemonPids(primaryPid: number, daemonPids: DaemonProcess[], homeDir: string): number[] {
  if (!Number.isFinite(primaryPid) || primaryPid <= 0) return [];
  const normalizedHome = homeDir.trim();
  if (!normalizedHome) return [];
  const primary = daemonPids.find((d) => d.pid === primaryPid);
  if (!primary) return [];
  if (!primary.home || primary.home !== normalizedHome) return [];
  return daemonPids
    .filter((d) => d.pid !== primaryPid && d.home === normalizedHome)
    .map((d) => d.pid);
}

async function reapDuplicateDaemons(primaryPid: number): Promise<void> {
  if (!Number.isFinite(primaryPid) || primaryPid <= 0) return;
  const duplicatePids = selectDuplicateDaemonPids(primaryPid, listDaemonPidsFromSystem(), paths.dir);
  if (duplicatePids.length === 0) return;

  for (const pid of duplicatePids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  await Bun.sleep(200);

  for (const pid of duplicatePids) {
    if (!isDaemonRunning(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

// Get the newest mtime across all source files as a "code version"
function getCodeMtime(): number {
  try {
    const script = process.argv[1];
    // For compiled binaries, use the binary's own mtime
    if (!script || !script.endsWith(".ts")) {
      const binPath = process.argv[0] || process.execPath;
      return statSync(binPath).mtimeMs;
    }
    // For dev mode, walk src/ directory for newest mtime
    const srcDir = join(dirname(script), "..");
    return newestMtime(join(srcDir, "src"));
  } catch {
    return 0;
  }
}

function newestMtime(dir: string): number {
  let newest = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        newest = Math.max(newest, newestMtime(join(dir, entry.name)));
      } else if (entry.name.endsWith(".ts")) {
        newest = Math.max(newest, statSync(join(dir, entry.name)).mtimeMs);
      }
    }
  } catch {}
  return newest;
}

async function shutdownDaemon(): Promise<void> {
  try {
    await daemonRequest("/shutdown", "POST");
    // Wait for it to exit
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(250);
      const pid = await readPidFile();
      if (!pid || !isDaemonRunning(pid)) return;
    }
  } catch {}
}

async function spawnDaemon(): Promise<void> {
  const execPath = process.execPath;
  // For compiled binaries, process.argv[1] is the user command (e.g. "claude"),
  // not a script path. Only include it if it looks like a script file.
  const scriptArg = process.argv[1];
  const isScript = scriptArg && (scriptArg.endsWith(".ts") || scriptArg.endsWith(".js"));
  const args = isScript
    ? [scriptArg, "__daemon__", "--tg-home", paths.dir]
    : ["__daemon__", "--tg-home", paths.dir];

  const proc = Bun.spawn([execPath, ...args], {
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env },
  });

  proc.unref();

  // Poll until control server responds (20 × 250ms = 5s max)
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(250);
    try {
      await daemonRequest("/health");
      return;
    } catch {
      // Not ready yet
    }
  }

  throw new Error("Daemon failed to start. Check logs: tg logs");
}

export async function ensureDaemon(): Promise<void> {
  const pid = await readPidFile();
  if (pid && isDaemonRunning(pid)) {
    try {
      const res = await daemonRequest("/health");
      const daemonStartedAt = res.startedAt as number | undefined;
      const scriptMtime = getCodeMtime();

      // If code is newer than daemon, restart it
      if (daemonStartedAt && scriptMtime && scriptMtime > daemonStartedAt) {
        let status: Record<string, unknown> | null = null;
        try {
          status = await daemonRequest("/status");
        } catch {
          // Keep current daemon when status cannot be determined.
          return;
        }
        if (shouldRestartDaemonForVersion(daemonStartedAt, scriptMtime, status)) {
          await shutdownDaemon();
          await spawnDaemon();
          return;
        }
      }

      // Daemon is current
      await reapDuplicateDaemons(pid);
      return;
    } catch {
      await reapDuplicateDaemons(pid);
      // Keep existing daemon process to avoid spawning duplicate channel pollers.
      return;
    }
  }

  await spawnDaemon();
}

// Test-only helpers
export const __ensureDaemonTestUtils = {
  hasActiveSessions,
  parseDaemonPidsFromPs,
  shouldRestartDaemonForVersion,
  selectDuplicateDaemonPids,
};
