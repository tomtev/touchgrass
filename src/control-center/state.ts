import { readFile, writeFile, chmod, unlink } from "fs/promises";
import { resolve } from "path";
import { paths, ensureDirs } from "../config/paths";

export interface ControlCenterState {
  pid: number;
  startedAt: string;
  rootDir: string;
  commandPrefix: string[];
  ownerUserId?: string;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeState(raw: unknown): ControlCenterState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const pid = Number(value.pid);
  const startedAt = typeof value.startedAt === "string" ? value.startedAt : "";
  const rootDir = typeof value.rootDir === "string" ? resolve(value.rootDir) : "";
  const commandPrefix = Array.isArray(value.commandPrefix)
    ? value.commandPrefix.filter((part): part is string => typeof part === "string" && part.length > 0)
    : [];
  const ownerUserId = typeof value.ownerUserId === "string" ? value.ownerUserId : undefined;

  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (!startedAt) return null;
  if (!rootDir) return null;
  if (commandPrefix.length === 0) return null;

  return {
    pid,
    startedAt,
    rootDir,
    commandPrefix,
    ownerUserId,
  };
}

export async function saveControlCenterState(state: ControlCenterState): Promise<void> {
  await ensureDirs();
  await writeFile(paths.controlCenterFile, JSON.stringify(state, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  await chmod(paths.controlCenterFile, 0o600).catch(() => {});
}

export async function clearControlCenterState(): Promise<void> {
  await unlink(paths.controlCenterFile).catch(() => {});
}

export async function loadControlCenterState(options?: { cleanupStale?: boolean }): Promise<ControlCenterState | null> {
  try {
    const raw = await readFile(paths.controlCenterFile, "utf-8");
    const parsed = normalizeState(JSON.parse(raw));
    if (!parsed) {
      if (options?.cleanupStale !== false) await clearControlCenterState();
      return null;
    }
    if (!isPidAlive(parsed.pid)) {
      if (options?.cleanupStale !== false) await clearControlCenterState();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildCurrentCliCommandPrefix(): string[] {
  // `process.argv[0]` is the running executable (`tg` binary or `bun`).
  // In dev script mode we also need argv[1] (src/main.ts) to preserve behavior.
  const execPath = process.argv[0] || process.execPath;
  const scriptArg = process.argv[1];
  const isScript = !!scriptArg && (scriptArg.endsWith(".ts") || scriptArg.endsWith(".js"));
  return isScript ? [execPath, scriptArg] : [execPath];
}
