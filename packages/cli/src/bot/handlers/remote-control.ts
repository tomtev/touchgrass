import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import type { RemoteSession, RemoteControlPickerOption } from "../../session/manager";
import { readAgentSoul } from "../../daemon/agent-soul";
import { paths } from "../../config/paths";

const RC_BUTTON_LIMIT = 10;
const TAIL_BYTES = 16 * 1024;
const MAX_OPTION_CHARS = 100;

export interface SessionManifest {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  jsonlFile: string | null;
  startedAt: string;
}

export function readManifests(): Map<string, SessionManifest> {
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

function readTailUtf8(filePath: string): string {
  try {
    const { size } = require("fs").statSync(filePath);
    if (size <= 0) return "";
    const readSize = Math.min(size, TAIL_BYTES);
    const offset = Math.max(0, size - readSize);
    const fd = require("fs").openSync(filePath, "r");
    const buffer = Buffer.alloc(readSize);
    try {
      const bytesRead = require("fs").readSync(fd, buffer, 0, readSize, offset);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      require("fs").closeSync(fd);
    }
  } catch {
    return "";
  }
}

function extractLastAssistantText(jsonlFile: string): string | null {
  const tail = readTailUtf8(jsonlFile);
  if (!tail) return null;
  const lines = tail.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const msg = JSON.parse(line) as Record<string, unknown>;
      // Claude format
      if (msg.type === "assistant") {
        const m = msg.message as Record<string, unknown> | undefined;
        if (m?.content && Array.isArray(m.content)) {
          const texts = (m.content as Array<Record<string, unknown>>)
            .filter((b) => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text as string)
            .join(" ")
            .trim();
          if (texts) return texts;
        }
      }
      // PI format
      if (msg.type === "message") {
        const m = msg.message as Record<string, unknown> | undefined;
        if (m?.role === "assistant" && m.content && Array.isArray(m.content)) {
          const texts = (m.content as Array<Record<string, unknown>>)
            .filter((b) => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text as string)
            .join(" ")
            .trim();
          if (texts) return texts;
        }
      }
      // Codex format
      if (msg.type === "event_msg") {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (payload?.type === "agent_message" && typeof payload.message === "string") {
          const text = (payload.message as string).trim();
          if (text) return text;
        }
      }
    } catch {}
  }
  return null;
}

function truncateLabel(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1).trimEnd()}…`;
}

function relativeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function buildSessionLabel(remote: RemoteSession, manifest: SessionManifest | null): Promise<string> {
  const tool = remote.command.split(" ")[0];
  const folder = remote.cwd.split("/").pop() || "";
  let name = tool;
  if (remote.cwd) {
    try {
      const soul = await readAgentSoul(remote.cwd);
      if (soul?.name) name = soul.name;
    } catch {}
  }

  // Build header: "Name — tool (folder)" or "tool (folder)"
  const headerParts = [name];
  if (name !== tool) headerParts.push(tool);
  if (folder) headerParts.push(`(${folder})`);
  const header = headerParts.join(" — ");

  // Add relative start time at the front
  let timePrefix = "";
  if (manifest?.startedAt) {
    const startMs = Date.parse(manifest.startedAt);
    if (!Number.isNaN(startMs)) {
      timePrefix = `${relativeTime(Date.now() - startMs)} · `;
    }
  }

  // Get last message preview with remaining space
  let preview = "";
  const jsonlFile = manifest?.jsonlFile || null;
  if (jsonlFile) {
    const lastText = extractLastAssistantText(jsonlFile);
    if (lastText) {
      const available = MAX_OPTION_CHARS - timePrefix.length - header.length - 3; // 3 for " · "
      if (available > 10) {
        preview = ` · ${truncateLabel(lastText, available)}`;
      }
    }
  }

  return `${timePrefix}${header}${preview}`;
}

export async function handleStartRemoteControl(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const userId = msg.userId;
  const { fmt } = ctx.channel;

  const userSessions = ctx.sessionManager.listRemotesForUser(userId);
  if (userSessions.length === 0) {
    await ctx.channel.send(
      chatId,
      `No active sessions. Start one with ${fmt.code("tg claude")}, ${fmt.code("tg codex")}, ${fmt.code("tg pi")}, or ${fmt.code("tg kimi")}.`
    );
    return;
  }

  if (!ctx.channel.sendPoll) {
    await ctx.channel.send(chatId, "This channel does not support picker buttons.");
    return;
  }

  const manifests = readManifests();

  // Sort by most recent first (startedAt from manifest, fallback to lastSeenAt)
  userSessions.sort((a, b) => {
    const aMs = Date.parse(manifests.get(a.id)?.startedAt || "") || a.lastSeenAt;
    const bMs = Date.parse(manifests.get(b.id)?.startedAt || "") || b.lastSeenAt;
    return bMs - aMs;
  });

  // Build options
  const options: RemoteControlPickerOption[] = [];
  const optionLabels: string[] = [];

  const attached = ctx.sessionManager.getAttachedRemote(chatId);

  // List all user sessions
  for (const remote of userSessions.slice(0, RC_BUTTON_LIMIT)) {
    const manifest = manifests.get(remote.id);
    const label = await buildSessionLabel(remote, manifest || null);
    const isAttached = attached?.id === remote.id;
    const displayLabel = isAttached ? `${label} (connected)` : label;
    // Ensure we don't exceed Telegram's 100-char poll option limit
    const finalLabel = displayLabel.length > MAX_OPTION_CHARS
      ? displayLabel.slice(0, MAX_OPTION_CHARS - 1) + "…"
      : displayLabel;
    options.push({ kind: "session", sessionId: remote.id, label: finalLabel });
    optionLabels.push(finalLabel);
  }

  const title = `⛳️ Select session — ${userSessions.length} active`;

  const sent = await ctx.channel.sendPoll(chatId, title, optionLabels, false);
  ctx.sessionManager.registerRemoteControlPicker({
    pollId: sent.pollId,
    messageId: sent.messageId,
    chatId,
    ownerUserId: userId,
    options,
  });
}

export async function handleStopRemoteControl(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const userId = msg.userId;
  const { fmt } = ctx.channel;

  const attached = ctx.sessionManager.getAttachedRemote(chatId);
  if (!attached || attached.ownerUserId !== userId) {
    await ctx.channel.send(chatId, "No active remote control on this chat.");
    return;
  }

  ctx.sessionManager.detach(chatId);
  await ctx.channel.send(chatId, `${fmt.escape("⛳️")} Remote control disconnected.`);
}
