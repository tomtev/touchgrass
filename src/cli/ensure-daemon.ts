import { readPidFile, isDaemonRunning } from "../daemon/lifecycle";
import { daemonRequest } from "./client";
import { statSync, readdirSync } from "fs";
import { join, dirname } from "path";

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
    ? [scriptArg, "__daemon__"]
    : ["__daemon__"];

  const proc = Bun.spawn([execPath, ...args], {
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env },
  });

  proc.unref();

  // Poll until socket responds (20 × 250ms = 5s max)
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
        await shutdownDaemon();
        await spawnDaemon();
        return;
      }

      // Daemon is current
      return;
    } catch {
      // Socket not responding — restart
    }
  }

  await spawnDaemon();
}
