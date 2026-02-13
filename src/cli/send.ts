import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { stat } from "fs/promises";
import { basename, resolve } from "path";

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
  const args = process.argv.slice(3);

  if (args.length < 2) {
    console.error('Usage: tg send <session_id> <message>');
    console.error('       tg send <session_id> --file <path>');
    console.error('       tg send --file <session_id> <path>');
    console.error('Examples:');
    console.error('  tg send r-abc123 "hello world"');
    console.error('  tg send r-abc123 --file ./notes.md');
    process.exit(1);
  }

  let sessionArg = "";
  let payload = "";
  let fileMode = false;

  if (args[0] === "--file") {
    if (args.length !== 3) {
      console.error('Usage: tg send --file <session_id> <path>');
      process.exit(1);
    }
    sessionArg = args[1];
    payload = args[2];
    fileMode = true;
  } else if (args[1] === "--file") {
    if (args.length !== 3) {
      console.error('Usage: tg send <session_id> --file <path>');
      process.exit(1);
    }
    sessionArg = args[0];
    payload = args[2];
    fileMode = true;
  } else {
    sessionArg = args[0];
    payload = args.slice(1).join(" ");
  }

  if (!sessionArg || !payload) {
    console.error("Missing session_id or input.");
    process.exit(1);
  }

  if (fileMode) {
    const absPath = resolve(process.cwd(), payload);
    let fileStat;
    try {
      fileStat = await stat(absPath);
    } catch {
      console.error(`File not found: ${absPath}`);
      process.exit(1);
    }
    if (!fileStat.isFile()) {
      console.error(`Not a file: ${absPath}`);
      process.exit(1);
    }
    payload = absPath;
  }

  await ensureDaemon();
  const sessionId = await resolveSessionId(sessionArg);

  if (fileMode) {
    await daemonRequest(`/remote/${sessionId}/send-file`, "POST", {
      filePath: payload,
      caption: basename(payload),
    });
    console.log(`Sent file to channel(s) for ${sessionId}: ${payload}`);
  } else {
    await daemonRequest(`/remote/${sessionId}/send-input`, "POST", { text: payload });
    console.log(`Sent to ${sessionId}`);
  }
}
