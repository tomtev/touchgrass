import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { stat } from "fs/promises";
import { readdirSync, readFileSync } from "fs";
import { basename, resolve, join } from "path";
import { paths } from "../config/paths";

function detectSenderSession(): { id: string; name: string } | null {
  const cwd = process.cwd();
  try {
    for (const f of readdirSync(paths.sessionsDir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = readFileSync(join(paths.sessionsDir, f), "utf-8");
        const m = JSON.parse(data) as { id: string; cwd: string; pid: number; name?: string; command: string };
        if (m.cwd === cwd && m.pid) {
          try { process.kill(m.pid, 0); } catch { continue; }
          const name = m.name || `${basename(m.cwd)} | ${m.command.split(/\s+/)[0]}`;
          return { id: m.id, name };
        }
      } catch {}
    }
  } catch {}
  return null;
}

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

async function resolveFile(filePath: string): Promise<string> {
  const absPath = resolve(process.cwd(), filePath);
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
  return absPath;
}

/**
 * tg send — send a message or file to the session's linked channel(s)
 */
export async function runSend(): Promise<void> {
  const args = process.argv.slice(3);

  if (args.length < 2) {
    console.error('Usage: touchgrass send <session_id> "text"');
    console.error('       touchgrass send <session_id> --file <path> ["caption"]');
    console.error('Examples:');
    console.error('  touchgrass send r-abc123 "hello world"');
    console.error('  touchgrass send r-abc123 --file ./report.pdf');
    console.error('  touchgrass send r-abc123 --file ./img.png "here is the screenshot"');
    process.exit(1);
  }

  const sessionArg = args[0];
  let text = "";
  let filePath = "";

  // Parse: <session> --file <path> ["caption"] or <session> "text"
  if (args[1] === "--file") {
    if (args.length < 3) {
      console.error('Usage: touchgrass send <session_id> --file <path> ["caption"]');
      process.exit(1);
    }
    filePath = args[2];
    text = args.slice(3).join(" ");
  } else {
    text = args.slice(1).join(" ");
  }

  if (!sessionArg || (!text && !filePath)) {
    console.error("Missing session_id or message.");
    process.exit(1);
  }

  await ensureDaemon();
  const sessionId = await resolveSessionId(sessionArg);

  if (filePath) {
    const absPath = await resolveFile(filePath);
    await daemonRequest(`/remote/${sessionId}/send-file`, "POST", {
      filePath: absPath,
      caption: text || basename(absPath),
    });
    console.log(`Sent file to channel: ${absPath}`);
  } else {
    await daemonRequest(`/remote/${sessionId}/send-message`, "POST", { text });
    console.log(`Sent to channel: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`);
  }
}

/**
 * tg write — write text into the session's terminal (PTY stdin)
 */
export async function runWrite(): Promise<void> {
  const args = process.argv.slice(3);

  if (args.length < 2) {
    console.error('Usage: touchgrass office chat <session_id> "text"');
    console.error('       touchgrass office chat <session_id> --file <path>');
    console.error('Examples:');
    console.error('  touchgrass office chat r-abc123 "do the thing"');
    console.error('  touchgrass office chat r-abc123 --file ./notes.md');
    process.exit(1);
  }

  const sessionArg = args[0];
  let text = "";
  let filePath = "";

  if (args[1] === "--file") {
    if (args.length < 3) {
      console.error('Usage: touchgrass office chat <session_id> --file <path>');
      process.exit(1);
    }
    filePath = args[2];
  } else {
    text = args.slice(1).join(" ");
  }

  if (!sessionArg || (!text && !filePath)) {
    console.error("Missing session_id or input.");
    process.exit(1);
  }

  await ensureDaemon();
  const sessionId = await resolveSessionId(sessionArg);

  // Detect sender session from cwd
  const senderInfo = detectSenderSession();
  const fromLabel = senderInfo
    ? `${senderInfo.name} (${senderInfo.id}) in office`
    : `cli`;
  const tag = `\n[sent from ${fromLabel} session_id="${sessionId}"]`;

  if (filePath) {
    const absPath = await resolveFile(filePath);
    await daemonRequest(`/remote/${sessionId}/send-input`, "POST", { text: `@${absPath}${tag}` });
    console.log(`Wrote file path to terminal: @${absPath}`);
  } else {
    await daemonRequest(`/remote/${sessionId}/send-input`, "POST", { text: `${text}${tag}` });
    console.log(`Wrote to terminal: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`);
  }
}
