import { isAbsolute, join } from "path";
import { homedir } from "os";

const configuredDir = process.env.TOUCHGRASS_HOME?.trim();
const isTestRuntime = process.env.NODE_ENV === "test";
const defaultDir = isTestRuntime
  ? join(process.cwd(), ".touchgrass-test")
  : join(homedir(), ".touchgrass");
const TG_DIR = configuredDir
  ? (isAbsolute(configuredDir) ? configuredDir : join(process.cwd(), configuredDir))
  : defaultDir;
export const CONTROL_HOST = "127.0.0.1";

export const paths = {
  dir: TG_DIR,
  config: join(TG_DIR, "config.json"),
  pidFile: join(TG_DIR, "daemon.pid"),
  daemonLock: join(TG_DIR, "daemon.lock"),
  socket: join(TG_DIR, "daemon.sock"),
  controlPortFile: join(TG_DIR, "daemon.port"),
  authToken: join(TG_DIR, "daemon.auth"),
  logsDir: join(TG_DIR, "logs"),
  logFile: join(TG_DIR, "logs", "daemon.log"),
  sessionsDir: join(TG_DIR, "sessions"),
  uploadsDir: join(TG_DIR, "uploads"),
  hooksDir: join(TG_DIR, "hooks"),
  statusBoardsFile: join(TG_DIR, "status-boards.json"),
  officesDir: join(TG_DIR, "offices"),
};

export function useTcpControlServer(): boolean {
  return process.platform === "win32";
}

export async function ensureDirs(): Promise<void> {
  const { mkdir, chmod } = await import("fs/promises");
  const secureDirs = [paths.dir, paths.logsDir, paths.sessionsDir, paths.uploadsDir, paths.hooksDir, paths.officesDir];

  for (const dir of secureDirs) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => {});
  }
}
