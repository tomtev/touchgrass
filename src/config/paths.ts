import { join } from "path";
import { homedir } from "os";

const TG_DIR = join(homedir(), ".touchgrass");

export const paths = {
  dir: TG_DIR,
  config: join(TG_DIR, "config.json"),
  pidFile: join(TG_DIR, "daemon.pid"),
  socket: join(TG_DIR, "daemon.sock"),
  logsDir: join(TG_DIR, "logs"),
  logFile: join(TG_DIR, "logs", "daemon.log"),
  sessionsDir: join(TG_DIR, "sessions"),
  uploadsDir: join(TG_DIR, "uploads"),
};

export async function ensureDirs(): Promise<void> {
  const { mkdir } = await import("fs/promises");
  await mkdir(paths.dir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.sessionsDir, { recursive: true });
  await mkdir(paths.uploadsDir, { recursive: true });
}
