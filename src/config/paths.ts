import { join } from "path";
import { homedir } from "os";

const TG_DIR = join(homedir(), ".touchgrass");

export const paths = {
  dir: TG_DIR,
  config: join(TG_DIR, "config.json"),
  pidFile: join(TG_DIR, "daemon.pid"),
  socket: join(TG_DIR, "daemon.sock"),
  authToken: join(TG_DIR, "daemon.auth"),
  logsDir: join(TG_DIR, "logs"),
  logFile: join(TG_DIR, "logs", "daemon.log"),
  sessionsDir: join(TG_DIR, "sessions"),
  uploadsDir: join(TG_DIR, "uploads"),
};

export async function ensureDirs(): Promise<void> {
  const { mkdir, chmod } = await import("fs/promises");
  const secureDirs = [paths.dir, paths.logsDir, paths.sessionsDir, paths.uploadsDir];

  for (const dir of secureDirs) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => {});
  }
}
