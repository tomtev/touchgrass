import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";

async function resolveSessionId(partial: string): Promise<string> {
  const res = await daemonRequest("/status");
  const sessions = res.sessions as Array<{ id: string; command: string; state: string }>;
  if (!sessions || sessions.length === 0) {
    throw new Error("No active sessions.");
  }

  // Exact match first
  const exact = sessions.find((s) => s.id === partial);
  if (exact) return exact.id;

  // Substring match
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

export async function runSend(): Promise<void> {
  const sessionArg = process.argv[3];
  const message = process.argv.slice(4).join(" ");

  if (!sessionArg || !message) {
    console.error('Usage: tg send <session_id> <message>');
    console.error('Example: tg send r-abc123 "hello world"');
    process.exit(1);
  }

  await ensureDaemon();
  const sessionId = await resolveSessionId(sessionArg);

  await daemonRequest(`/remote/${sessionId}/send-input`, "POST", { text: message });
  console.log(`Sent to ${sessionId}`);
}
