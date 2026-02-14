import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";

async function resolveSessionId(partial: string): Promise<string> {
  const res = await daemonRequest("/status");
  const sessions = res.sessions as Array<{ id: string; command: string; state: string }>;
  if (!sessions || sessions.length === 0) {
    throw new Error("No active sessions.");
  }

  const exact = sessions.find((s) => s.id === partial);
  if (exact) return exact.id;

  const matches = sessions.filter((s) => s.id.includes(partial));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous session ID "${partial}" — matches: ${matches.map((s) => s.id).join(", ")}`
    );
  }

  throw new Error(
    `No session matching "${partial}". Active sessions: ${sessions.map((s) => s.id).join(", ")}`
  );
}

export async function runStopOrKill(): Promise<void> {
  const action = process.argv[2];
  const sessionArg = (process.argv[3] || "").trim();

  if ((action !== "stop" && action !== "kill") || !sessionArg) {
    console.error("Usage: tg stop <session_id>");
    console.error("       tg kill <session_id>");
    process.exit(1);
  }

  await ensureDaemon();
  const sessionId = await resolveSessionId(sessionArg);
  const res = await daemonRequest(`/session/${sessionId}/${action}`, "POST");
  const mode = (res.mode as string) || "local";

  if (action === "stop") {
    console.log(
      mode === "remote"
        ? `Sent stop request to remote session ${sessionId}`
        : `Sent SIGTERM to session ${sessionId}`
    );
    return;
  }

  console.log(
    mode === "remote"
      ? `Sent kill request to remote session ${sessionId}`
      : `Sent SIGKILL to session ${sessionId}`
  );
}
