import { readdirSync, statSync, type Dirent } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import type { PendingResumePickerOption, RemoteSession, ResumeSessionCandidate } from "../../session/manager";

const RESUME_BUTTON_LIMIT = 10;
const RESUME_SEARCH_LIMIT = 500;

type ResumeTool = "claude" | "codex" | "pi";

function detectTool(command: string): ResumeTool | null {
  const head = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (head === "claude" || head === "codex" || head === "pi") return head;
  return null;
}

function normalizeCwd(cwd: string | undefined): string {
  return (cwd || "").trim();
}

function stripJsonl(name: string): string {
  return name.replace(/\.jsonl$/i, "");
}

function relativeAge(mtimeMs: number): string {
  const deltaMs = Math.max(0, Date.now() - mtimeMs);
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h`;
  const day = Math.floor(hour / 24);
  return `${day}d`;
}

function truncateMiddle(value: string, max = 28): string {
  if (value.length <= max) return value;
  const left = Math.max(6, Math.floor((max - 1) / 2));
  const right = Math.max(6, max - left - 1);
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function buildLabel(sessionToken: string, mtimeMs: number): string {
  return `${truncateMiddle(sessionToken)} • ${relativeAge(mtimeMs)}`;
}

function encodedClaudeDir(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

function encodedPiDir(cwd: string): string {
  return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
}

function userHomeDir(): string {
  return process.env.HOME || homedir();
}

function parseCodexSessionId(filePath: string): string {
  const base = stripJsonl(basename(filePath));
  const uuid = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (uuid?.[1]) return uuid[1];
  return base;
}

function parsePiSessionToken(filePath: string): string {
  const base = stripJsonl(basename(filePath));
  const parts = base.split("_");
  return parts[parts.length - 1] || base;
}

function safeStatMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function listJsonlFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { encoding: "utf8" })
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function walkCodexJsonl(root: string, maxResults: number): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < maxResults) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: Array<Dirent<string>>;
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }

    // Newest date-like dirs first when possible.
    const sorted = entries.slice().sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of sorted) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(full);
        if (out.length >= maxResults) break;
      }
    }
  }
  return out;
}

function toResumeCandidates(tool: ResumeTool, files: string[]): ResumeSessionCandidate[] {
  const mapped = files.map((filePath) => {
    const mtimeMs = safeStatMtime(filePath);
    if (tool === "pi") {
      const token = parsePiSessionToken(filePath);
      return {
        sessionRef: filePath,
        label: buildLabel(token, mtimeMs),
        mtimeMs,
      } satisfies ResumeSessionCandidate;
    }

    if (tool === "codex") {
      const sessionId = parseCodexSessionId(filePath);
      return {
        sessionRef: sessionId,
        label: buildLabel(sessionId, mtimeMs),
        mtimeMs,
      } satisfies ResumeSessionCandidate;
    }

    const sessionId = stripJsonl(basename(filePath));
    return {
      sessionRef: sessionId,
      label: buildLabel(sessionId, mtimeMs),
      mtimeMs,
    } satisfies ResumeSessionCandidate;
  });

  return mapped
    .filter((item) => item.sessionRef)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function listRecentSessions(tool: ResumeTool, cwd: string): ResumeSessionCandidate[] {
  const cleanCwd = normalizeCwd(cwd);
  if (!cleanCwd) return [];

  if (tool === "claude") {
    const dir = join(userHomeDir(), ".claude", "projects", encodedClaudeDir(cleanCwd));
    return toResumeCandidates(tool, listJsonlFiles(dir));
  }

  if (tool === "pi") {
    const dir = join(userHomeDir(), ".pi", "agent", "sessions", encodedPiDir(cleanCwd));
    return toResumeCandidates(tool, listJsonlFiles(dir));
  }

  const root = join(userHomeDir(), ".codex", "sessions");
  const files = walkCodexJsonl(root, RESUME_SEARCH_LIMIT);
  return toResumeCandidates(tool, files);
}

function resolveTargetRemote(msg: InboundMessage, ctx: RouterContext): RemoteSession | null {
  const attached = ctx.sessionManager.getAttachedRemote(msg.chatId);
  if (attached && attached.ownerUserId === msg.userId) return attached;
  if (attached && attached.ownerUserId !== msg.userId) return null;

  const remotes = ctx.sessionManager.listRemotesForUser(msg.userId);
  if (remotes.length === 1 && !msg.isGroup) return remotes[0];
  return null;
}

export function buildResumePickerPage(
  sessions: ResumeSessionCandidate[],
  offset: number,
  maxButtons: number = RESUME_BUTTON_LIMIT
): {
  offset: number;
  nextOffset: number | null;
  options: PendingResumePickerOption[];
  optionLabels: string[];
  title: string;
} {
  const safeOffset = Math.max(0, Math.min(offset, Math.max(0, sessions.length - 1)));
  const hasMore = safeOffset + maxButtons < sessions.length;
  const visibleCount = hasMore ? maxButtons - 1 : maxButtons;
  const visible = sessions.slice(safeOffset, safeOffset + visibleCount);

  const options: PendingResumePickerOption[] = visible.map((session) => ({
    kind: "session",
    sessionRef: session.sessionRef,
    label: session.label,
  }));
  const optionLabels = visible.map((session) => session.label);

  let nextOffset: number | null = null;
  if (hasMore) {
    nextOffset = safeOffset + visibleCount;
    options.push({ kind: "more", nextOffset });
    optionLabels.push("➡️ More");
  }

  const shownTo = safeOffset + visible.length;
  const title = sessions.length === 0
    ? "Resume session"
    : `Resume session ${safeOffset + 1}-${shownTo} of ${sessions.length}`;

  return {
    offset: safeOffset,
    nextOffset,
    options,
    optionLabels,
    title,
  };
}

export const __resumeTestUtils = {
  buildResumePickerPage,
  detectTool,
  listRecentSessions,
  parseCodexSessionId,
  parsePiSessionToken,
};

export async function handleResumeCommand(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const userId = msg.userId;
  const { fmt } = ctx.channel;

  const remote = resolveTargetRemote(msg, ctx);
  if (!remote) {
    await ctx.channel.send(
      chatId,
      `No connected session for this chat. Start with ${fmt.code("tg claude")} (or ${fmt.code("tg codex")}, ${fmt.code("tg pi")}) and connect this channel first.`
    );
    return;
  }

  const tool = detectTool(remote.command);
  if (!tool) {
    await ctx.channel.send(chatId, "Resume picker currently supports Claude, Codex, and PI sessions.");
    return;
  }

  const sessions = listRecentSessions(tool, remote.cwd);
  if (sessions.length === 0) {
    await ctx.channel.send(chatId, `No recent ${fmt.code(fmt.escape(tool))} sessions found for ${fmt.code(fmt.escape(remote.cwd || "this project"))}.`);
    return;
  }

  if (!ctx.channel.sendPoll) {
    const preview = sessions.slice(0, RESUME_BUTTON_LIMIT).map((s) => fmt.code(fmt.escape(s.label))).join("\n");
    await ctx.channel.send(
      chatId,
      `${fmt.bold("This channel does not support inline picker buttons.")}\n${fmt.bold("Recent sessions:")}\n${preview}`
    );
    return;
  }

  const firstPage = buildResumePickerPage(sessions, 0, RESUME_BUTTON_LIMIT);
  const sent = await ctx.channel.sendPoll(chatId, firstPage.title, firstPage.optionLabels, false);
  ctx.sessionManager.registerResumePicker({
    pollId: sent.pollId,
    messageId: sent.messageId,
    chatId,
    ownerUserId: userId,
    sessionId: remote.id,
    tool,
    sessions,
    offset: firstPage.offset,
    options: firstPage.options,
  });
}
