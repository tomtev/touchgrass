import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";

type ResumableTool = "claude" | "codex" | "pi" | "kimi";

interface ActiveSession {
  id: string;
  command: string;
  state: string;
}

interface RestartCliArgs {
  sessionIdPartial: string | null;
}

function cleanToken(token: string | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim().replace(/^['"`]+|['"`]+$/g, "");
  return trimmed || null;
}

function detectTool(command: string): ResumableTool | null {
  const head = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (head === "claude" || head === "codex" || head === "pi" || head === "kimi") return head;
  return null;
}

function extractResumeRef(tool: ResumableTool, command: string): string | null {
  if (tool === "pi") {
    return cleanToken(command.match(/(?:^|\s)--session(?:=|\s+)([^\s]+)/i)?.[1]);
  }
  if (tool === "kimi") {
    return cleanToken(command.match(/(?:^|\s)(?:--session|-S)(?:=|\s+)([^\s]+)/i)?.[1]);
  }
  return cleanToken(
    command.match(/\bresume\s+([^\s]+)/i)?.[1] ||
    command.match(/\b--resume(?:=|\s+)([^\s]+)/i)?.[1]
  );
}

function parseRestartArgs(argv: string[]): RestartCliArgs {
  let sessionIdPartial: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option for touchgrass restart: ${arg}`);
    }
    if (sessionIdPartial) {
      throw new Error("Only one session ID may be provided.");
    }
    sessionIdPartial = arg.trim();
  }

  return { sessionIdPartial };
}

function resolveSessionTarget(
  sessions: ActiveSession[],
  partial: string | null
): ActiveSession {
  if (sessions.length === 0) {
    throw new Error("No active sessions.");
  }

  if (!partial) {
    if (sessions.length === 1) return sessions[0];
    throw new Error(
      `Multiple sessions are active. Provide one: ${sessions.map((s) => s.id).join(", ")}`
    );
  }

  const exact = sessions.find((s) => s.id === partial);
  if (exact) return exact;

  const matches = sessions.filter((s) => s.id.includes(partial));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Ambiguous session ID "${partial}" — matches: ${matches.map((s) => s.id).join(", ")}`);
  }

  throw new Error(`No session matching "${partial}". Active sessions: ${sessions.map((s) => s.id).join(", ")}`);
}

export async function runRestart(): Promise<void> {
  let parsed: RestartCliArgs;
  try {
    parsed = parseRestartArgs(process.argv.slice(3));
  } catch (e) {
    console.error((e as Error).message);
    console.error("Usage: touchgrass restart [tg_session_id]");
    process.exit(1);
    return;
  }

  await ensureDaemon();
  const status = await daemonRequest("/status");
  const sessions = (status.sessions as ActiveSession[] | undefined) || [];
  const target = resolveSessionTarget(sessions, parsed.sessionIdPartial);

  let sessionRef: string | null = null;
  const tool = detectTool(target.command);
  if (tool) {
    sessionRef = extractResumeRef(tool, target.command);
  }

  if (!sessionRef) {
    console.error(
      "Could not infer a tool session ID from the current command. Run touchgrass resume first, then touchgrass restart."
    );
    process.exit(1);
  }

  await daemonRequest(`/session/${target.id}/restart`, "POST");
  console.log(`Requested restart for touchgrass session ${target.id} using tool session ${sessionRef}`);
}

export const __restartTestUtils = {
  parseRestartArgs,
  detectTool,
  extractResumeRef,
  resolveSessionTarget,
};
