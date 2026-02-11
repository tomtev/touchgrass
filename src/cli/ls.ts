import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { paths } from "../config/paths";
import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";

interface SessionManifest {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  jsonlFile: string | null;
  startedAt: string;
}

function readManifests(): Map<string, SessionManifest> {
  const manifests = new Map<string, SessionManifest>();
  try {
    for (const f of readdirSync(paths.sessionsDir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = readFileSync(join(paths.sessionsDir, f), "utf-8");
        const m = JSON.parse(data) as SessionManifest;
        manifests.set(m.id, m);
      } catch {}
    }
  } catch {}
  return manifests;
}

export async function runLs(): Promise<void> {
  type SessionEntry = { id: string; command: string; state: string };
  // Try daemon first for live session info
  let daemonSessions = null as SessionEntry[] | null;
  try {
    await ensureDaemon();
    const res = await daemonRequest("/status");
    daemonSessions = res.sessions as SessionEntry[];
  } catch {}

  const manifests = readManifests();

  if ((!daemonSessions || daemonSessions.length === 0) && manifests.size === 0) {
    console.log("No active sessions.");
    return;
  }

  console.log("Active sessions:\n");

  if (daemonSessions && daemonSessions.length > 0) {
    for (const s of daemonSessions) {
      const m = manifests.get(s.id);
      const cwd = m?.cwd ? `  ${m.cwd}` : "";
      console.log(`  ${s.id}  ${s.state.padEnd(8)}  ${s.command}${cwd}`);
    }
  } else {
    // Fallback: show manifests if daemon is unreachable
    for (const m of manifests.values()) {
      console.log(`  ${m.id}  ${"unknown".padEnd(8)}  ${m.command}  ${m.cwd}`);
    }
  }
}
