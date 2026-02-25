import { closeSync, openSync, readSync, readdirSync, statSync, type Dirent } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import { createHash } from "crypto";
import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import type { PendingResumePickerOption, RemoteSession, ResumeSessionCandidate } from "../../session/manager";

const RESUME_BUTTON_LIMIT = 10;
const RESUME_SEARCH_LIMIT = 500;
const RESUME_TAIL_BYTES = 24 * 1024;

export type ResumeTool = "claude" | "codex" | "pi" | "kimi";

function detectTool(command: string): ResumeTool | null {
  const head = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (head === "claude" || head === "codex" || head === "pi" || head === "kimi") return head;
  return null;
}

function normalizeCwd(cwd: string | undefined): string {
  return (cwd || "").trim();
}

function stripJsonl(name: string): string {
  return name.replace(/\.jsonl$/i, "");
}

function truncateMiddle(value: string, max = 20): string {
  if (value.length <= max) return value;
  const left = Math.max(6, Math.floor((max - 1) / 2));
  const right = Math.max(6, max - left - 1);
  return `${value.slice(0, left)}…${value.slice(-right)}`;
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

function normalizePreview(text: string, maxChars = 42): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1).trimEnd()}…`;
}

function readTailUtf8(filePath: string, maxBytes: number = RESUME_TAIL_BYTES): string {
  try {
    const stat = statSync(filePath);
    if (stat.size <= 0) return "";
    const readSize = Math.min(stat.size, maxBytes);
    const offset = Math.max(0, stat.size - readSize);
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(readSize);
    try {
      const bytesRead = readSync(fd, buffer, 0, readSize, offset);
      if (bytesRead <= 0) return "";
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

function parseAssistantTextLine(tool: ResumeTool, line: string): string | null {
  try {
    const msg = JSON.parse(line) as Record<string, unknown>;
    if (tool === "claude" && msg.type === "assistant") {
      const m = msg.message as Record<string, unknown> | undefined;
      if (!m?.content || !Array.isArray(m.content)) return null;
      const texts = (m.content as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join(" ")
        .trim();
      return texts || null;
    }

    if (tool === "pi" && msg.type === "message") {
      const m = msg.message as Record<string, unknown> | undefined;
      if (m?.role !== "assistant") return null;
      if (!m.content || !Array.isArray(m.content)) return null;
      const texts = (m.content as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join(" ")
        .trim();
      return texts || null;
    }

    if (tool === "codex" && msg.type === "event_msg") {
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload || payload.type !== "agent_message") return null;
      const text = typeof payload.message === "string" ? payload.message.trim() : "";
      return text || null;
    }

    if (tool === "kimi") {
      const wire = msg.message as Record<string, unknown> | undefined;
      const type = typeof wire?.type === "string" ? wire.type : "";
      const payload = wire?.payload as Record<string, unknown> | undefined;
      if (type === "TextPart") {
        const text = typeof payload?.text === "string" ? payload.text.trim() : "";
        return text || null;
      }
      if (type === "ContentPart" && payload?.type === "text") {
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        return text || null;
      }
    }
  } catch {}
  return null;
}

function extractLastAssistantPreview(tool: ResumeTool, filePath: string): string | null {
  const tail = readTailUtf8(filePath, RESUME_TAIL_BYTES);
  if (!tail) return null;
  const lines = tail.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const parsed = parseAssistantTextLine(tool, line);
    if (parsed) return normalizePreview(parsed);
  }
  return null;
}

function buildLabel(sessionToken: string, mtimeMs: number, preview: string | null): string {
  const age = `${relativeAge(mtimeMs)} ago`;
  if (preview) return `${age}: ${preview}`;
  return `${age}: ${truncateMiddle(sessionToken)}`;
}

function encodedClaudeDir(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

function encodedPiDir(cwd: string): string {
  return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
}

function encodedKimiDir(cwd: string): string {
  return createHash("md5").update(cwd).digest("hex");
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

function parseKimiSessionId(filePath: string): string {
  const parent = basename(dirname(filePath));
  if (parent && parent !== "." && parent !== "/") return parent;
  return basename(filePath, ".jsonl");
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

function listKimiWireFiles(root: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(root, { withFileTypes: true, encoding: "utf8" });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(root, entry.name, "wire.jsonl");
      try {
        const s = statSync(candidate);
        if (s.isFile()) files.push(candidate);
      } catch {}
    }
  } catch {}
  return files;
}

function toResumeCandidates(tool: ResumeTool, files: string[]): ResumeSessionCandidate[] {
  const mapped = files.map((filePath) => {
    const mtimeMs = safeStatMtime(filePath);
    const preview = extractLastAssistantPreview(tool, filePath);
    if (tool === "pi") {
      const token = parsePiSessionToken(filePath);
      return {
        sessionRef: filePath,
        label: buildLabel(token, mtimeMs, preview),
        mtimeMs,
      } satisfies ResumeSessionCandidate;
    }

    if (tool === "codex") {
      const sessionId = parseCodexSessionId(filePath);
      return {
        sessionRef: sessionId,
        label: buildLabel(sessionId, mtimeMs, preview),
        mtimeMs,
      } satisfies ResumeSessionCandidate;
    }

    if (tool === "kimi") {
      const sessionId = parseKimiSessionId(filePath);
      return {
        sessionRef: sessionId,
        label: buildLabel(sessionId, mtimeMs, preview),
        mtimeMs,
      } satisfies ResumeSessionCandidate;
    }

    const sessionId = stripJsonl(basename(filePath));
    return {
      sessionRef: sessionId,
      label: buildLabel(sessionId, mtimeMs, preview),
      mtimeMs,
    } satisfies ResumeSessionCandidate;
  });

  return mapped
    .filter((item) => item.sessionRef)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function listRecentSessions(tool: ResumeTool, cwd: string): ResumeSessionCandidate[] {
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

  if (tool === "kimi") {
    const dir = join(userHomeDir(), ".kimi", "sessions", encodedKimiDir(cleanCwd));
    return toResumeCandidates(tool, listKimiWireFiles(dir));
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
  extractLastAssistantPreview,
  listRecentSessions,
  normalizePreview,
  parseCodexSessionId,
  parseKimiSessionId,
  parseAssistantTextLine,
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
      `No connected session for this chat. Start with ${fmt.code("touchgrass claude")} (or ${fmt.code("touchgrass codex")}, ${fmt.code("touchgrass pi")}, ${fmt.code("touchgrass kimi")}) and connect this channel first.`
    );
    return;
  }

  const tool = detectTool(remote.command);
  if (!tool) {
    await ctx.channel.send(chatId, "Resume picker currently supports Claude, Codex, PI, and Kimi sessions.");
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
