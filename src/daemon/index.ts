import { loadConfig, invalidateCache, saveConfig } from "../config/store";
import {
  addLinkedGroup,
  getAllLinkedGroups,
  getAllPairedUsers,
  getChatMuted,
  getChatOutputMode,
  getChatThinkingEnabled,
  getTelegramBotToken,
  isLinkedGroup,
  removeLinkedGroup,
  setChatOutputMode,
  type OutputMode,
} from "../config/schema";
import { TelegramApi } from "../channels/telegram/api";
import { logger } from "./logger";
import {
  acquireDaemonLock,
  installSignalHandlers,
  onShutdown,
  removeAuthToken,
  removeControlPortFile,
  removeDaemonLock,
  removePidFile,
  removeSocket,
  writePidFile,
} from "./lifecycle";
import { startControlServer, type ChannelInfo, type ConfigChannelSummary, type ConfigChannelDetails } from "./control-server";
import { routeMessage } from "../bot/command-router";
import { buildResumePickerPage } from "../bot/handlers/resume";
import type { BackgroundJobSessionSummary } from "../bot/handlers/background-jobs";
import { SessionManager } from "../session/manager";
import { formatSimpleToolResult, formatToolCall } from "./tool-display";
import { paths } from "../config/paths";
import { generatePairingCode } from "../security/pairing";
import { isUserPaired } from "../security/allowlist";
import { rotateDaemonAuthToken } from "../security/daemon-auth";
import { createChannel } from "../channel/factory";
import type { Formatter } from "../channel/formatter";
import type { Channel, ChannelChatId, ChannelUserId } from "../channel/types";
import { getChannelName, getChannelType, getRootChatIdNumber, parseChannelAddress } from "../channel/id";
import type { AskQuestion, PendingFilePickerOption } from "../session/manager";
import { chmod, open, readFile, stat, writeFile } from "fs/promises";
import { basename, join } from "path";

const DAEMON_STARTED_AT = Date.now();

/** Format a session label for messages: "claude (myproject)" or just "claude" */
function sessionLabel(command: string, cwd: string): string {
  const tool = command.split(" ")[0];
  const folder = cwd.split("/").pop();
  return folder ? `${tool} (${folder})` : tool;
}

type BackgroundJobStatus = "running" | "completed" | "failed" | "killed";

interface BackgroundJobState {
  taskId: string;
  status: BackgroundJobStatus;
  command?: string;
  outputFile?: string;
  summary?: string;
  urls?: string[];
  updatedAt: number;
}

interface BackgroundJobEvent {
  taskId: string;
  status: string;
  command?: string;
  outputFile?: string;
  summary?: string;
  urls?: string[];
}

interface PersistedStatusBoardEntry {
  chatId: string;
  boardKey: string;
  messageId: string;
  pinned: boolean;
  updatedAt: number;
}

interface SessionManifest {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  jsonlFile: string | null;
  startedAt: string;
}

export async function startDaemon(): Promise<void> {
  await logger.info("Daemon starting", { pid: process.pid });

  const lockAcquired = await acquireDaemonLock();
  if (!lockAcquired) {
    await logger.info("Daemon already active; skipping duplicate start", { pid: process.pid });
    process.exit(0);
  }

  let config = await loadConfig();
  async function refreshConfig() {
    invalidateCache();
    config = await loadConfig();
  }

  installSignalHandlers();
  await writePidFile();
  const daemonAuthToken = await rotateDaemonAuthToken();

  const sessionManager = new SessionManager(config.settings);

  // Create channel instances from config
  const configuredChannels = Object.entries(config.channels);
  const channels: Array<{ name: string; type: string; channel: Channel }> = [];
  const channelByName = new Map<string, Channel>();
  const defaultChannelByType = new Map<string, Channel>();
  for (const [name, cfg] of configuredChannels) {
    const channel = createChannel(name, cfg);
    channels.push({ name, type: cfg.type, channel });
    channelByName.set(name, channel);
    if (!defaultChannelByType.has(cfg.type)) {
      defaultChannelByType.set(cfg.type, channel);
    }
  }

  if (channels.length === 0) {
    await logger.error("No channels configured. Run `tg setup` first.");
    console.error("No channels configured. Run `tg setup` first.");
    process.exit(1);
  }

  const getChannelForType = (type: string): Channel | null => defaultChannelByType.get(type) || null;
  const getChannelForChat = (chatId: ChannelChatId): Channel | null => {
    const channelName = getChannelName(chatId);
    if (channelName) {
      const scoped = channelByName.get(channelName);
      if (scoped) return scoped;
    }
    return getChannelForType(getChannelType(chatId));
  };
  const getFormatterForChat = (chatId: ChannelChatId): Formatter => {
    return getChannelForChat(chatId)?.fmt || channels[0].channel.fmt;
  };
  const getOutputModeForChat = (chatId: ChannelChatId) => getChatOutputMode(config, chatId);
  const isChatMutedForChat = (chatId: ChannelChatId): boolean => {
    return getChatMuted(config, chatId);
  };
  const isThinkingEnabledForChat = (chatId: ChannelChatId): boolean => {
    return getChatThinkingEnabled(config, chatId);
  };
  const sendToChat = (chatId: ChannelChatId, content: string): void => {
    const channel = getChannelForChat(chatId);
    if (!channel) return;
    channel.send(chatId, content).catch(() => {});
  };
  const syncCommandMenuForChat = (chatId: ChannelChatId, userId: ChannelUserId): void => {
    const channel = getChannelForChat(chatId);
    if (!channel?.syncCommandMenu) return;
    void (async () => {
      const rootChatId = getRootChatIdNumber(chatId);
      const isGroup = typeof rootChatId === "number" && Number.isFinite(rootChatId) && rootChatId < 0;
      await channel.syncCommandMenu?.({
        userId,
        chatId,
        isPaired: isUserPaired(config, userId),
        isGroup,
        isLinkedGroup: isGroup ? isLinkedGroup(config, chatId) : false,
        hasActiveSession: !!sessionManager.getAttachedRemote(chatId),
      });
    })().catch(async (error: unknown) => {
      await logger.debug("Failed to sync command menu from daemon lifecycle", {
        chatId,
        userId,
        error: (error as Error)?.message ?? String(error),
      });
    });
  };
  const setTypingForChat = (chatId: ChannelChatId, active: boolean): void => {
    const channel = getChannelForChat(chatId);
    if (!channel) return;
    channel.setTyping(chatId, active);
  };
  const syncKnownCommandMenus = (): void => {
    const pairedUsers = getAllPairedUsers(config);
    const linkedGroups = getAllLinkedGroups(config);
    for (const user of pairedUsers) {
      const parsedUser = parseChannelAddress(user.userId);
      const userType = parsedUser.type;
      const userChannelName = parsedUser.channelName;
      syncCommandMenuForChat(user.userId, user.userId);
      for (const group of linkedGroups) {
        const parsedGroup = parseChannelAddress(group.chatId);
        if (parsedGroup.type !== userType) continue;
        const sameScope = parsedGroup.channelName === userChannelName;
        if ((parsedGroup.channelName || userChannelName) && !sameScope) continue;
        syncCommandMenuForChat(group.chatId, user.userId);
      }
    }
  };
  const sendPollToChat = async (
    chatId: ChannelChatId,
    question: string,
    options: string[],
    multiSelect: boolean
  ): Promise<{ pollId: string; messageId: string } | null> => {
    const channel = getChannelForChat(chatId);
    if (!channel?.sendPoll) return null;
    return channel.sendPoll(chatId, question, options, multiSelect);
  };
  const closePollForChat = (chatId: ChannelChatId, messageId: string): void => {
    const channel = getChannelForChat(chatId);
    if (!channel?.closePoll) return;
    channel.closePoll(chatId, messageId).catch(() => {});
  };
  const reconnectNoticeBySession = new Map<string, number>();
  const RECONNECT_NOTICE_COOLDOWN_MS = 30_000;
  const backgroundJobsBySession = new Map<string, Map<string, BackgroundJobState>>();
  const persistedStatusBoards = new Map<string, PersistedStatusBoardEntry>();
  const backgroundJobAnnouncements = new Map<string, BackgroundJobStatus>();
  const backgroundBoardKey = (sessionId: string) => `background-jobs:${sessionId}`;
  const statusBoardMapKey = (chatId: string, boardKey: string) => `${chatId}::${boardKey}`;
  const backgroundAnnouncementKey = (sessionId: string, taskId: string) => `${sessionId}::${taskId}`;
  const sessionIdFromBoardKey = (boardKey: string): string | null => {
    if (!boardKey.startsWith("background-jobs:")) return null;
    return boardKey.slice("background-jobs:".length) || null;
  };
  const BACKGROUND_RECONCILE_INTERVAL_MS = 30_000;
  const BACKGROUND_BOARD_STALE_MS = 5 * 60_000;
  const STATUS_BOARD_STORE_PATH = paths.statusBoardsFile;
  let persistStatusBoardsTimer: ReturnType<typeof setTimeout> | null = null;
  let reconcilingBackgroundState = false;

  const normalizeBackgroundStatus = (status: string): BackgroundJobStatus | null => {
    const value = status.toLowerCase();
    if (value === "running" || value === "started" || value === "start") return "running";
    if (value === "completed" || value === "done" || value === "success") return "completed";
    if (value === "failed" || value === "error") return "failed";
    if (
      value === "killed" ||
      value === "stopped" ||
      value === "terminated" ||
      value === "cancelled" ||
      value === "canceled"
    ) {
      return "killed";
    }
    return null;
  };

  const extractTaskNotificationTag = (content: string, tag: string): string | undefined => {
    const match = content.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return match?.[1]?.trim() || undefined;
  };

  const extractUrls = (text: string): string[] => {
    if (!text) return [];
    const matches = text.match(/https?:\/\/[^\s<>)\]}]+/gi) || [];
    const deduped = new Set<string>();
    for (const raw of matches) {
      const url = raw.replace(/^[('"`]+|[),.;!?'"`]+$/g, "");
      if (!url) continue;
      deduped.add(url);
      if (deduped.size >= 5) break;
    }
    return Array.from(deduped);
  };

  const inferUrlsFromCommand = (command?: string): string[] => {
    if (!command) return [];
    const urls = new Set<string>();
    const directMatches = extractUrls(command);
    for (const url of directMatches) urls.add(url);

    const portPatterns: RegExp[] = [
      /(?:localhost|127\.0\.0\.1):(\d{2,5})/gi,
      /\.listen\((\d{2,5})\)/gi,
      /--port(?:=|\s+)(\d{2,5})/gi,
      /-p(?:=|\s+)(\d{2,5})/gi,
    ];
    for (const pattern of portPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(command)) !== null) {
        const port = Number(match[1]);
        if (!Number.isFinite(port) || port < 1 || port > 65535) continue;
        urls.add(`http://localhost:${port}`);
      }
    }
    return Array.from(urls).slice(0, 5);
  };

  const extractStoppedTaskFromText = (text: string): { taskId: string; command?: string } | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const taskId = typeof parsed.task_id === "string"
        ? parsed.task_id
        : typeof parsed.taskId === "string"
        ? parsed.taskId
        : "";
      const command = typeof parsed.command === "string" ? parsed.command : undefined;
      const message = typeof parsed.message === "string" ? parsed.message : "";
      const status = typeof parsed.status === "string" ? parsed.status.toLowerCase() : "";
      const stoppedByStatus = status === "killed" || status === "stopped" || status === "terminated" || status === "cancelled" || status === "canceled";
      const stoppedByMessage = /stopped task|killed task|terminated task|cancelled task|canceled task/i.test(message);
      if (taskId && (stoppedByStatus || stoppedByMessage)) {
        return { taskId, command };
      }
    } catch {
      // Not JSON payload.
    }

    const stoppedId = trimmed.match(/Successfully stopped task:\s*([A-Za-z0-9_-]+)/i)?.[1];
    if (!stoppedId) return null;
    const command = trimmed.match(/Successfully stopped task:\s*[A-Za-z0-9_-]+\s*\(([\s\S]+)\)/i)?.[1];
    return { taskId: stoppedId, command };
  };

  const mergeUrls = (base?: string[], incoming?: string[]): string[] | undefined => {
    const merged = new Set<string>();
    for (const url of base || []) merged.add(url);
    for (const url of incoming || []) merged.add(url);
    if (merged.size === 0) return undefined;
    return Array.from(merged).slice(0, 5);
  };

  type ResumableTool = "claude" | "codex" | "pi" | "kimi";

  const cleanResumeRef = (token: string | undefined): string | null => {
    if (!token) return null;
    const trimmed = token.trim().replace(/^['"`]+|['"`]+$/g, "");
    return trimmed || null;
  };

  const getSessionTool = (command: string): string => {
    return command.trim().split(/\s+/)[0] || "";
  };

  const detectResumableTool = (command: string): ResumableTool | null => {
    const tool = getSessionTool(command).toLowerCase();
    if (tool === "claude" || tool === "codex" || tool === "pi" || tool === "kimi") return tool;
    return null;
  };

  const extractResumeRefFromCommand = (tool: ResumableTool, command: string): string | null => {
    if (tool === "pi") {
      return cleanResumeRef(command.match(/(?:^|\s)--session(?:=|\s+)([^\s]+)/i)?.[1]);
    }
    if (tool === "kimi") {
      return cleanResumeRef(command.match(/(?:^|\s)(?:--session|-S)(?:=|\s+)([^\s]+)/i)?.[1]);
    }
    return cleanResumeRef(
      command.match(/\bresume\s+([^\s]+)/i)?.[1] ||
      command.match(/\b--resume(?:=|\s+)([^\s]+)/i)?.[1]
    );
  };

  const supportsBackgroundTracking = (command: string): boolean => {
    const tool = getSessionTool(command);
    return tool === "claude" || tool === "codex";
  };

  const normalizeCodexSessionId = (value: unknown): string | undefined => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return String(Math.trunc(value));
    }
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed;
  };

  const detectCodexExitStatus = (output: string): BackgroundJobStatus | null => {
    const codeMatch = output.match(/Process exited with code\s+(-?\d+)/i);
    if (codeMatch) {
      const code = Number(codeMatch[1]);
      if (Number.isFinite(code) && code === 0) return "completed";
      return "failed";
    }
    if (/(stdin is closed for this session|session not found|no such session)/i.test(output)) {
      return "killed";
    }
    return null;
  };

  const persistStatusBoardsNow = async (): Promise<void> => {
    try {
      const jobs: Record<string, BackgroundJobState[]> = {};
      for (const [sessionId, jobMap] of backgroundJobsBySession) {
        jobs[sessionId] = Array.from(jobMap.values());
      }
      const payload = {
        version: 1,
        boards: Array.from(persistedStatusBoards.values()),
        jobs,
      };
      await writeFile(STATUS_BOARD_STORE_PATH, JSON.stringify(payload, null, 2) + "\n", {
        encoding: "utf-8",
        mode: 0o600,
      });
      await chmod(STATUS_BOARD_STORE_PATH, 0o600).catch(() => {});
    } catch (e) {
      await logger.error("Failed to persist status board registry", { error: (e as Error).message });
    }
  };

  const schedulePersistStatusBoards = (): void => {
    if (persistStatusBoardsTimer) return;
    persistStatusBoardsTimer = setTimeout(async () => {
      persistStatusBoardsTimer = null;
      await persistStatusBoardsNow();
    }, 250);
  };

  const setPersistedStatusBoard = (
    chatId: string,
    boardKey: string,
    messageId: string,
    pinned: boolean
  ): void => {
    persistedStatusBoards.set(statusBoardMapKey(chatId, boardKey), {
      chatId,
      boardKey,
      messageId,
      pinned,
      updatedAt: Date.now(),
    });
    schedulePersistStatusBoards();
  };

  const removePersistedStatusBoard = (chatId: string, boardKey: string): void => {
    persistedStatusBoards.delete(statusBoardMapKey(chatId, boardKey));
    schedulePersistStatusBoards();
  };

  const loadPersistedStatusBoards = async (): Promise<void> => {
    try {
      const raw = await readFile(STATUS_BOARD_STORE_PATH, "utf-8");
      const parsed = JSON.parse(raw) as {
        boards?: PersistedStatusBoardEntry[];
        jobs?: Record<string, BackgroundJobState[]>;
      } | null;
      const boards = Array.isArray(parsed?.boards) ? parsed.boards : [];
      for (const entry of boards) {
        if (!entry || typeof entry !== "object") continue;
        if (typeof entry.chatId !== "string" || !entry.chatId) continue;
        if (typeof entry.boardKey !== "string" || !entry.boardKey) continue;
        if (typeof entry.messageId !== "string" || !entry.messageId) continue;
        persistedStatusBoards.set(statusBoardMapKey(entry.chatId, entry.boardKey), {
          chatId: entry.chatId,
          boardKey: entry.boardKey,
          messageId: entry.messageId,
          pinned: entry.pinned === true,
          updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
        });
      }
      const jobs = parsed?.jobs && typeof parsed.jobs === "object" ? parsed.jobs : {};
      for (const [sessionId, list] of Object.entries(jobs)) {
        if (!sessionId || !Array.isArray(list)) continue;
        const jobMap = new Map<string, BackgroundJobState>();
        for (const rawJob of list) {
          if (!rawJob || typeof rawJob !== "object") continue;
          const taskId = typeof rawJob.taskId === "string" ? rawJob.taskId : "";
          const status = normalizeBackgroundStatus(String(rawJob.status || ""));
          if (!taskId || status !== "running") continue;
          const command = typeof rawJob.command === "string" ? rawJob.command : undefined;
          const urls = Array.isArray(rawJob.urls)
            ? rawJob.urls.filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u))
            : undefined;
          const mergedUrls = mergeUrls(urls && urls.length > 0 ? urls.slice(0, 5) : undefined, inferUrlsFromCommand(command));
          jobMap.set(taskId, {
            taskId,
            status,
            command,
            outputFile: typeof rawJob.outputFile === "string" ? rawJob.outputFile : undefined,
            summary: typeof rawJob.summary === "string" ? rawJob.summary : undefined,
            urls: mergedUrls,
            updatedAt: typeof rawJob.updatedAt === "number" ? rawJob.updatedAt : Date.now(),
          });
        }
        if (jobMap.size > 0) {
          backgroundJobsBySession.set(sessionId, jobMap);
        }
      }
    } catch {
      // No persisted registry yet (or malformed file) — continue with an empty set.
    }
  };

  const readTail = async (filePath: string, maxBytes: number): Promise<string> => {
    const stats = await stat(filePath);
    const size = stats.size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length <= 0) return "";
    const fd = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buffer, 0, length, start);
      return buffer.toString("utf-8", 0, bytesRead);
    } finally {
      await fd.close();
    }
  };

  const readSessionManifest = async (sessionId: string): Promise<SessionManifest | null> => {
    const manifestPath = join(paths.sessionsDir, `${sessionId}.json`);
    try {
      const raw = await readFile(manifestPath, "utf-8");
      const parsed = JSON.parse(raw) as SessionManifest;
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const readStoppedClaudeTasks = async (
    jsonlFile: string,
    taskIds: Set<string>
  ): Promise<Set<string>> => {
    const stopped = new Set<string>();
    if (!jsonlFile || taskIds.size === 0) return stopped;
    try {
      const tail = await readTail(jsonlFile, 300_000);
      const lines = tail.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (msg.type === "queue-operation" && msg.operation === "enqueue") {
            const content = typeof msg.content === "string" ? msg.content : "";
            if (!content.includes("<task-notification>")) continue;
            const taskId = extractTaskNotificationTag(content, "task-id");
            const status = (extractTaskNotificationTag(content, "status") || "").toLowerCase();
            if (!taskId || !taskIds.has(taskId)) continue;
            if (status === "completed" || status === "failed" || status === "killed" || status === "stopped") {
              stopped.add(taskId);
            }
            continue;
          }

          if (msg.type !== "user") continue;
          const rootToolUseResult = msg.toolUseResult as Record<string, unknown> | undefined;
          const rootStoppedTaskId = typeof rootToolUseResult?.task_id === "string" ? rootToolUseResult.task_id : "";
          const rootStopMessage = typeof rootToolUseResult?.message === "string" ? rootToolUseResult.message : "";
          if (
            rootStoppedTaskId &&
            taskIds.has(rootStoppedTaskId) &&
            /stopped task|killed task|terminated task|cancelled task|canceled task/i.test(rootStopMessage)
          ) {
            stopped.add(rootStoppedTaskId);
            continue;
          }

          const message = msg.message as Record<string, unknown> | undefined;
          if (!message?.content || !Array.isArray(message.content)) continue;
          for (const block of message.content as Array<Record<string, unknown>>) {
            if (block.type !== "tool_result") continue;
            let text = "";
            const content = block.content;
            if (typeof content === "string") text = content;
            else if (Array.isArray(content)) {
              text = (content as Array<{ type: string; text?: string }>)
                .filter((segment) => segment.type === "text")
                .map((segment) => segment.text ?? "")
                .join("\n");
            }
            const stoppedTask = extractStoppedTaskFromText(text);
            if (!stoppedTask?.taskId || !taskIds.has(stoppedTask.taskId)) continue;
            stopped.add(stoppedTask.taskId);
          }
        } catch {
          // Skip malformed JSON lines.
        }
      }
    } catch {
      // JSONL may not exist yet.
    }
    return stopped;
  };

  const readRunningClaudeTasks = async (
    jsonlFile: string
  ): Promise<Map<string, BackgroundJobState>> => {
    const running = new Map<string, BackgroundJobState>();
    const toolUseIdToInput = new Map<string, Record<string, unknown>>();
    if (!jsonlFile) return running;
    try {
      const tail = await readTail(jsonlFile, 500_000);
      const lines = tail.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          const ts = typeof msg.timestamp === "string"
            ? Date.parse(msg.timestamp)
            : Date.now();
          const updatedAt = Number.isFinite(ts) ? ts : Date.now();

          if (msg.type === "assistant") {
            const m = msg.message as Record<string, unknown> | undefined;
            if (m?.content && Array.isArray(m.content)) {
              for (const block of m.content as Array<Record<string, unknown>>) {
                if (block.type !== "tool_use") continue;
                const toolUseId = typeof block.id === "string" ? block.id : "";
                const input = (block.input as Record<string, unknown> | undefined) || undefined;
                if (!toolUseId || !input) continue;
                toolUseIdToInput.set(toolUseId, input);
                if (toolUseIdToInput.size > 2000) {
                  const firstKey = toolUseIdToInput.keys().next().value as string | undefined;
                  if (firstKey) toolUseIdToInput.delete(firstKey);
                }
              }
            }
            continue;
          }

          if (msg.type === "user") {
            const rootToolUseResult = msg.toolUseResult as Record<string, unknown> | undefined;
            const rootBackgroundTaskId = typeof rootToolUseResult?.backgroundTaskId === "string"
              ? rootToolUseResult.backgroundTaskId
              : undefined;
            const m = msg.message as Record<string, unknown> | undefined;
            if (!m?.content || !Array.isArray(m.content)) continue;
            for (const block of m.content as Array<Record<string, unknown>>) {
              if (block.type !== "tool_result") continue;
              let text = "";
              const c = block.content;
              if (typeof c === "string") text = c;
              else if (Array.isArray(c)) {
                text = (c as Array<{ type: string; text?: string }>)
                  .filter((seg) => seg.type === "text")
                  .map((seg) => seg.text ?? "")
                  .join("\n");
              }
              const trimmedText = text.trim();
              if (!trimmedText) continue;
              const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
              const commandInput = toolUseId ? toolUseIdToInput.get(toolUseId) : undefined;
              const command = typeof commandInput?.command === "string" ? commandInput.command : undefined;
              const stoppedTask = extractStoppedTaskFromText(trimmedText);
              if (stoppedTask?.taskId) {
                running.delete(stoppedTask.taskId);
                continue;
              }
              const startedIdFromText = trimmedText.match(/Command running in background with ID:\s*([A-Za-z0-9_-]+)/i)?.[1];
              const taskId = startedIdFromText || rootBackgroundTaskId;
              if (!taskId) continue;
              const outputFile = trimmedText.match(/Output is being written to:\s*([^\s]+)/i)?.[1];
              const urls = mergeUrls(extractUrls(trimmedText), inferUrlsFromCommand(command));
              const existing = running.get(taskId);
              running.set(taskId, {
                taskId,
                status: "running",
                command: command || existing?.command,
                outputFile: outputFile || existing?.outputFile,
                summary: existing?.summary,
                urls: mergeUrls(existing?.urls, urls),
                updatedAt: Math.max(updatedAt, existing?.updatedAt ?? 0),
              });
            }
            continue;
          }

          if (msg.type !== "queue-operation" || msg.operation !== "enqueue") continue;
          const content = typeof msg.content === "string" ? msg.content : "";
          if (!content.includes("<task-notification>")) continue;
          const taskId = extractTaskNotificationTag(content, "task-id");
          const statusRaw = (extractTaskNotificationTag(content, "status") || "").toLowerCase();
          if (!taskId || !statusRaw) continue;
          if (statusRaw === "completed" || statusRaw === "failed" || statusRaw === "killed" || statusRaw === "stopped") {
            running.delete(taskId);
            continue;
          }
          if (statusRaw === "running" || statusRaw === "started" || statusRaw === "start") {
            const summary = extractTaskNotificationTag(content, "summary");
            const outputFile = extractTaskNotificationTag(content, "output-file");
            const commandMatch = summary?.match(/Background command \"([\s\S]+?)\" was/i);
            const command = commandMatch?.[1];
            const urls = mergeUrls(extractUrls(content), inferUrlsFromCommand(command));
            const existing = running.get(taskId);
            running.set(taskId, {
              taskId,
              status: "running",
              command: command || existing?.command,
              outputFile: outputFile || existing?.outputFile,
              summary: summary || existing?.summary,
              urls: mergeUrls(existing?.urls, urls),
              updatedAt: Math.max(updatedAt, existing?.updatedAt ?? 0),
            });
          }
        } catch {
          // Ignore malformed lines in tail snapshots.
        }
      }
    } catch {
      // JSONL may not exist yet.
    }
    return running;
  };

  const readStoppedCodexTasks = async (
    jsonlFile: string,
    taskIds: Set<string>
  ): Promise<Set<string>> => {
    const stopped = new Set<string>();
    if (!jsonlFile || taskIds.size === 0) return stopped;

    const callIdToName = new Map<string, string>();
    const callIdToInput = new Map<string, Record<string, unknown>>();
    const rememberCall = (callId: string, name: string, input: Record<string, unknown>) => {
      callIdToName.set(callId, name);
      callIdToInput.set(callId, input);
      if (callIdToName.size > 2000) {
        const first = callIdToName.keys().next().value as string | undefined;
        if (first) {
          callIdToName.delete(first);
          callIdToInput.delete(first);
        }
      }
    };

    try {
      const tail = await readTail(jsonlFile, 500_000);
      const lines = tail.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (msg.type !== "response_item") continue;
          const payload = msg.payload as Record<string, unknown> | undefined;
          if (!payload) continue;

          if (payload.type === "function_call" && typeof payload.name === "string") {
            const callId = typeof payload.call_id === "string" ? payload.call_id : "";
            if (!callId) continue;
            let input: Record<string, unknown> = {};
            if (typeof payload.arguments === "string") {
              try {
                input = JSON.parse(payload.arguments) as Record<string, unknown>;
              } catch {
                input = {};
              }
            }
            rememberCall(callId, payload.name, input);
            continue;
          }

          if (payload.type !== "function_call_output" && payload.type !== "custom_tool_call_output") continue;
          const callId = typeof payload.call_id === "string" ? payload.call_id : "";
          if (!callId) continue;
          const input = callIdToInput.get(callId);
          const output = typeof payload.output === "string" ? payload.output : "";
          const trimmedOutput = output.trim();
          if (!trimmedOutput) continue;

          const sessionIdFromOutput = trimmedOutput.match(/Process running with session ID\s*([0-9]+)/i)?.[1];
          const sessionIdFromInput = normalizeCodexSessionId(input?.session_id);
          const sessionId = sessionIdFromOutput || sessionIdFromInput;
          if (!sessionId || !taskIds.has(sessionId)) continue;

          const exitStatus = detectCodexExitStatus(trimmedOutput);
          if (exitStatus) {
            stopped.add(sessionId);
          }
        } catch {
          // Skip malformed JSON lines.
        }
      }
    } catch {
      // JSONL may not exist yet.
    }
    return stopped;
  };

  const readRunningCodexTasks = async (
    jsonlFile: string
  ): Promise<Map<string, BackgroundJobState>> => {
    const running = new Map<string, BackgroundJobState>();
    if (!jsonlFile) return running;

    const callIdToName = new Map<string, string>();
    const callIdToInput = new Map<string, Record<string, unknown>>();
    const sessionIdToCommand = new Map<string, string>();
    const rememberCall = (callId: string, name: string, input: Record<string, unknown>) => {
      callIdToName.set(callId, name);
      callIdToInput.set(callId, input);
      if (callIdToName.size > 2000) {
        const first = callIdToName.keys().next().value as string | undefined;
        if (first) {
          callIdToName.delete(first);
          callIdToInput.delete(first);
        }
      }
    };

    try {
      const tail = await readTail(jsonlFile, 500_000);
      const lines = tail.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          const ts = typeof msg.timestamp === "string"
            ? Date.parse(msg.timestamp)
            : Date.now();
          const updatedAt = Number.isFinite(ts) ? ts : Date.now();

          if (msg.type !== "response_item") continue;
          const payload = msg.payload as Record<string, unknown> | undefined;
          if (!payload) continue;

          if (payload.type === "function_call" && typeof payload.name === "string") {
            const callId = typeof payload.call_id === "string" ? payload.call_id : "";
            if (!callId) continue;
            let input: Record<string, unknown> = {};
            if (typeof payload.arguments === "string") {
              try {
                input = JSON.parse(payload.arguments) as Record<string, unknown>;
              } catch {
                input = {};
              }
            }
            rememberCall(callId, payload.name, input);
            continue;
          }

          if (payload.type !== "function_call_output" && payload.type !== "custom_tool_call_output") continue;
          const callId = typeof payload.call_id === "string" ? payload.call_id : "";
          if (!callId) continue;
          const toolName = callIdToName.get(callId) ?? "";
          const input = callIdToInput.get(callId);
          const output = typeof payload.output === "string" ? payload.output : "";
          const trimmedOutput = output.trim();
          if (!trimmedOutput) continue;

          const sessionIdFromOutput = trimmedOutput.match(/Process running with session ID\s*([0-9]+)/i)?.[1];
          const sessionIdFromInput = normalizeCodexSessionId(input?.session_id);
          const sessionId = sessionIdFromOutput || sessionIdFromInput;
          const commandFromInput = typeof input?.cmd === "string" ? input.cmd : undefined;
          if (sessionId && commandFromInput && toolName === "exec_command") {
            sessionIdToCommand.set(sessionId, commandFromInput);
          }
          const command = (sessionId && sessionIdToCommand.get(sessionId)) || commandFromInput;

          if (sessionIdFromOutput && sessionId) {
            const existing = running.get(sessionId);
            running.set(sessionId, {
              taskId: sessionId,
              status: "running",
              command: command || existing?.command,
              summary: existing?.summary,
              outputFile: existing?.outputFile,
              urls: mergeUrls(
                existing?.urls,
                mergeUrls(extractUrls(trimmedOutput), inferUrlsFromCommand(command || existing?.command))
              ),
              updatedAt: Math.max(updatedAt, existing?.updatedAt ?? 0),
            });
          }

          if (sessionId) {
            const exitStatus = detectCodexExitStatus(trimmedOutput);
            if (exitStatus) {
              running.delete(sessionId);
              sessionIdToCommand.delete(sessionId);
            }
          }
        } catch {
          // Skip malformed JSON lines.
        }
      }
    } catch {
      // JSONL may not exist yet.
    }

    return running;
  };

  const hydrateBackgroundJobsFromLogs = async (sessionIds: string[]): Promise<void> => {
    for (const sessionId of sessionIds) {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) continue;
      const tool = getSessionTool(remote.command);
      if (tool !== "claude" && tool !== "codex") continue;
      const manifest = await readSessionManifest(sessionId);
      if (!manifest?.jsonlFile) continue;
      const runningFromLog = tool === "claude"
        ? await readRunningClaudeTasks(manifest.jsonlFile)
        : await readRunningCodexTasks(manifest.jsonlFile);
      if (runningFromLog.size === 0) continue;
      const existing = backgroundJobsBySession.get(sessionId) || new Map<string, BackgroundJobState>();
      let changed = false;
      for (const [taskId, snapshot] of runningFromLog) {
        const prior = existing.get(taskId);
        if (prior) continue;
        existing.set(taskId, snapshot);
        changed = true;
      }
      if (changed) {
        backgroundJobsBySession.set(sessionId, existing);
      }
    }
  };

  const getBackgroundTargets = (sessionId: string): Set<ChannelChatId> => {
    const targets = new Set<ChannelChatId>();
    const remote = sessionManager.getRemote(sessionId);
    if (!remote) return targets;
    const targetChat = sessionManager.getBoundChat(sessionId);
    if (targetChat) {
      targets.add(targetChat);
      return targets;
    }
    // Fallback to owner DM only if this session is actually attached there.
    const attachedInOwnerDm = sessionManager.getAttachedRemote(remote.chatId);
    if (attachedInOwnerDm?.id === sessionId) {
      targets.add(remote.chatId);
    }
    return targets;
  };

  const listBackgroundJobsForUserChat = async (
    userId: ChannelUserId,
    chatId: ChannelChatId
  ): Promise<BackgroundJobSessionSummary[]> => {
    const attachedId = sessionManager.getAttachedRemote(chatId)?.id;
    const userRemoteIds = sessionManager.listRemotesForUser(userId).map((remote) => remote.id);
    const candidateIds = attachedId ? [attachedId] : userRemoteIds;
    const candidates = new Set<string>(candidateIds);

    const buildRows = (): BackgroundJobSessionSummary[] => {
      const rows: BackgroundJobSessionSummary[] = [];
      for (const sessionId of candidates) {
        const remote = sessionManager.getRemote(sessionId);
        if (!remote) continue;
        if (!supportsBackgroundTracking(remote.command)) continue;
        const jobs = backgroundJobsBySession.get(sessionId);
        if (!jobs || jobs.size === 0) continue;
        rows.push({
          sessionId,
          command: remote.command,
          cwd: remote.cwd,
          jobs: Array.from(jobs.values())
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((job) => ({
              taskId: job.taskId,
              command: job.command,
              urls: mergeUrls(job.urls, inferUrlsFromCommand(job.command)),
              updatedAt: job.updatedAt,
            })),
        });
      }
      return rows;
    };

    let rows = buildRows();
    if (rows.length > 0) {
      for (const sessionId of candidateIds) {
        const remote = sessionManager.getRemote(sessionId);
        const tool = remote ? getSessionTool(remote.command) : "";
        if (tool !== "claude" && tool !== "codex") continue;
        const jobs = backgroundJobsBySession.get(sessionId);
        if (!jobs || jobs.size === 0) continue;
        const manifest = await readSessionManifest(sessionId);
        if (!manifest?.jsonlFile) continue;
        const stopped = tool === "claude"
          ? await readStoppedClaudeTasks(manifest.jsonlFile, new Set(jobs.keys()))
          : await readStoppedCodexTasks(manifest.jsonlFile, new Set(jobs.keys()));
        if (stopped.size === 0) continue;
        for (const taskId of stopped) jobs.delete(taskId);
        if (jobs.size === 0) {
          backgroundJobsBySession.delete(sessionId);
        }
      }
      rows = buildRows();
    }
    const sessionsNeedingHydration = candidateIds.filter((sessionId) => {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return false;
      if (!supportsBackgroundTracking(remote.command)) return false;
      const jobs = backgroundJobsBySession.get(sessionId);
      return !jobs || jobs.size === 0;
    });

    if (sessionsNeedingHydration.length > 0) {
      await hydrateBackgroundJobsFromLogs(sessionsNeedingHydration);
      rows = buildRows();
    }

    rows.sort((a, b) => {
      // Prefer the currently attached session in this chat if it has jobs.
      if (attachedId && a.sessionId === attachedId && b.sessionId !== attachedId) return -1;
      if (attachedId && b.sessionId === attachedId && a.sessionId !== attachedId) return 1;
      const aLatest = a.jobs[0]?.updatedAt || 0;
      const bLatest = b.jobs[0]?.updatedAt || 0;
      return bLatest - aLatest;
    });

    return rows;
  };

  const announceBackgroundJobEvent = (
    sessionId: string,
    status: BackgroundJobStatus,
    job: {
      taskId: string;
      command?: string;
      summary?: string;
      urls?: string[];
    }
  ): void => {
    const dedupeKey = backgroundAnnouncementKey(sessionId, job.taskId);
    const previousStatus = backgroundJobAnnouncements.get(dedupeKey);
    if (previousStatus === status) return;
    backgroundJobAnnouncements.set(dedupeKey, status);

    const remote = sessionManager.getRemote(sessionId);
    const tool = remote ? getSessionTool(remote.command) : "";
    const noun = tool === "codex" ? "Background terminal" : "Background job";

    const emoji = status === "running"
      ? "🟢"
      : status === "completed"
      ? "✅"
      : status === "failed"
      ? "❌"
      : "🛑";
    const label = status === "running"
      ? `${noun} started`
      : status === "completed"
      ? `${noun} completed`
      : status === "failed"
      ? `${noun} failed`
      : `${noun} stopped`;

    for (const chatId of getBackgroundTargets(sessionId)) {
      if (isChatMutedForChat(chatId)) continue;
      const fmt = getFormatterForChat(chatId);
      const lines: string[] = [
        `${fmt.escape(emoji)} ${fmt.bold(fmt.escape(label))}`,
        `${fmt.code(fmt.escape(job.taskId))} ${fmt.escape("—")} ${fmt.escape((job.command || noun.toLowerCase()).trim())}`,
      ];
      if (job.summary && status !== "running") {
        const trimmed = job.summary.trim();
        if (trimmed) lines.push(fmt.escape(trimmed.length > 280 ? `${trimmed.slice(0, 277)}...` : trimmed));
      }
      const url = job.urls?.find((candidate) => /^https?:\/\//i.test(candidate));
      if (url) lines.push(`↳ ${fmt.link(fmt.escape(url), url)}`);
      sendToChat(chatId, lines.join("\n"));
    }
  };

  const renderBackgroundBoard = (chatId: ChannelChatId, jobs: BackgroundJobState[]): string => {
    const fmt = getFormatterForChat(chatId);
    const header = `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(`Background jobs (${jobs.length} running)`))}`;
    const lines: string[] = [];
    for (const job of jobs.slice(0, 8)) {
      const command = (job.command || "running").trim();
      lines.push(`• ${fmt.code(fmt.escape(job.taskId))} ${fmt.escape("—")} ${fmt.escape(command)}`);
      const url = job.urls?.[0];
      if (url && /^https?:\/\//i.test(url)) {
        lines.push(`  ↳ ${fmt.link(fmt.escape(url), url)}`);
      }
    }
    if (jobs.length > 8) {
      lines.push(fmt.escape(`+${jobs.length - 8} more`));
    }
    return [header, ...lines].join("\n");
  };

  const refreshBackgroundBoards = async (sessionId: string): Promise<void> => {
    const board = backgroundJobsBySession.get(sessionId);
    const jobs = board ? Array.from(board.values()) : [];
    const targets = getBackgroundTargets(sessionId);
    const key = backgroundBoardKey(sessionId);
    const entriesForSession = Array.from(persistedStatusBoards.values()).filter((e) => e.boardKey === key);

    // Clear stale boards if the chat is no longer a target for this session.
    for (const entry of entriesForSession) {
      if (targets.has(entry.chatId)) continue;
      const channel = getChannelForChat(entry.chatId);
      try {
        await channel?.clearStatusBoard?.(entry.chatId, key, {
          unpin: true,
          messageId: entry.messageId,
          pinned: entry.pinned,
        });
      } catch {}
      removePersistedStatusBoard(entry.chatId, key);
    }

    for (const chatId of targets) {
      const channel = getChannelForChat(chatId);
      if (!channel) continue;
      const persisted = persistedStatusBoards.get(statusBoardMapKey(chatId, key));
      if (jobs.length === 0) {
        try {
          await channel.clearStatusBoard?.(chatId, key, {
            unpin: true,
            messageId: persisted?.messageId,
            pinned: persisted?.pinned,
          });
        } catch {}
        removePersistedStatusBoard(chatId, key);
        continue;
      }
      if (!channel.upsertStatusBoard) continue;
      const html = renderBackgroundBoard(chatId, jobs);
      try {
        const result = await channel.upsertStatusBoard(chatId, key, html, {
          pin: false,
          messageId: persisted?.messageId,
          pinned: persisted?.pinned,
        });
        const messageId = result?.messageId || persisted?.messageId;
        const pinned = result?.pinned ?? persisted?.pinned ?? false;
        if (messageId) {
          setPersistedStatusBoard(chatId, key, messageId, pinned);
        }
      } catch {}
    }
    if (jobs.length === 0) {
      backgroundJobsBySession.delete(sessionId);
    }
  };

  const clearBackgroundBoards = async (sessionId: string): Promise<void> => {
    const key = backgroundBoardKey(sessionId);
    const entriesForSession = Array.from(persistedStatusBoards.values()).filter((e) => e.boardKey === key);
    for (const entry of entriesForSession) {
      const channel = getChannelForChat(entry.chatId);
      try {
        await channel?.clearStatusBoard?.(entry.chatId, key, {
          unpin: true,
          messageId: entry.messageId,
          pinned: entry.pinned,
        });
      } catch {}
      removePersistedStatusBoard(entry.chatId, key);
    }
    // Also clear from currently bound targets in case a board wasn't persisted yet.
    for (const chatId of getBackgroundTargets(sessionId)) {
      const channel = getChannelForChat(chatId);
      try {
        await channel?.clearStatusBoard?.(chatId, key, { unpin: true });
      } catch {}
      removePersistedStatusBoard(chatId, key);
    }
    backgroundJobsBySession.delete(sessionId);
    for (const entryKey of Array.from(backgroundJobAnnouncements.keys())) {
      if (entryKey.startsWith(`${sessionId}::`)) {
        backgroundJobAnnouncements.delete(entryKey);
      }
    }
  };

  // Auto-stop timer: shut down when all sessions disconnect
  const AUTO_STOP_DELAY = 30_000;
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelAutoStop() {
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }
  }

  function scheduleAutoStop() {
    cancelAutoStop();
    autoStopTimer = setTimeout(async () => {
      if (sessionManager.remoteCount() === 0) {
        await logger.info("No active sessions, auto-stopping daemon");
        for (const { channel } of channels) channel.stopReceiving();
        sessionManager.killAll();
        await removeAuthToken();
        await removePidFile();
        await removeDaemonLock();
        await removeSocket();
        await removeControlPortFile();
        process.exit(0);
      }
    }, AUTO_STOP_DELAY);
  }

  const cleanupStalePersistedBoards = async (): Promise<void> => {
    const now = Date.now();
    const entries = Array.from(persistedStatusBoards.values());
    for (const entry of entries) {
      const sessionId = sessionIdFromBoardKey(entry.boardKey);
      if (sessionId && sessionManager.getRemote(sessionId)) continue;
      if (now - entry.updatedAt < BACKGROUND_BOARD_STALE_MS) continue;
      const channel = getChannelForChat(entry.chatId);
      try {
        await channel?.clearStatusBoard?.(entry.chatId, entry.boardKey, {
          unpin: true,
          messageId: entry.messageId,
          pinned: entry.pinned,
        });
      } catch {}
      removePersistedStatusBoard(entry.chatId, entry.boardKey);
    }
  };

  const reconcileBackgroundState = async (): Promise<void> => {
    if (reconcilingBackgroundState) return;
    reconcilingBackgroundState = true;
    try {
      for (const sessionId of backgroundJobsBySession.keys()) {
        const remote = sessionManager.getRemote(sessionId);
        if (!remote) {
          const hasPersistedBoard = Array.from(persistedStatusBoards.values()).some(
            (entry) => sessionIdFromBoardKey(entry.boardKey) === sessionId
          );
          if (!hasPersistedBoard) {
            backgroundJobsBySession.delete(sessionId);
          }
          continue;
        }

        // Periodically confirm stop events from JSONL in case a watcher event was missed.
        const tool = getSessionTool(remote.command);
        if (tool === "claude" || tool === "codex") {
          const jobs = backgroundJobsBySession.get(sessionId);
          const runningTaskIds = new Set(Array.from(jobs?.keys() || []));
          if (runningTaskIds.size > 0) {
            const manifest = await readSessionManifest(sessionId);
            if (manifest?.jsonlFile) {
              const stopped = tool === "claude"
                ? await readStoppedClaudeTasks(manifest.jsonlFile, runningTaskIds)
                : await readStoppedCodexTasks(manifest.jsonlFile, runningTaskIds);
              if (stopped.size > 0 && jobs) {
                for (const taskId of stopped) jobs.delete(taskId);
              }
            }
          }
        }

        await refreshBackgroundBoards(sessionId);
      }

      await cleanupStalePersistedBoards();
    } finally {
      reconcilingBackgroundState = false;
    }
  };

  await loadPersistedStatusBoards();
  void cleanupStalePersistedBoards();
  const backgroundBoardRefreshTimer = setInterval(() => {
    void reconcileBackgroundState();
  }, BACKGROUND_RECONCILE_INTERVAL_MS);
  void reconcileBackgroundState();

  // Wire dead chat detection — clean up subscriptions and linked groups when sends fail permanently
  for (const { channel } of channels) {
    if ("onDeadChat" in channel) {
      channel.onDeadChat = async (deadChatId, error) => {
        await logger.info("Dead chat detected", { chatId: deadChatId, error: error.message });
        // Unsubscribe dead chat from all sessions
        for (const session of sessionManager.list()) {
          sessionManager.unsubscribeGroup(session.id, deadChatId);
        }
        // Detach from any bound session
        sessionManager.detach(deadChatId);
        // Drop persisted status boards for dead chats.
        for (const entry of Array.from(persistedStatusBoards.values())) {
          if (entry.chatId === deadChatId) {
            removePersistedStatusBoard(entry.chatId, entry.boardKey);
          }
        }
        // Remove from linked groups config
        await refreshConfig();
        if (removeLinkedGroup(config, deadChatId, getChannelName(deadChatId))) {
          await saveConfig(config);
        }
      };
    }
  }

  // --- Poll / AskUserQuestion support ---

  async function sendNextPoll(sessionId: string) {
    const pending = sessionManager.getPendingQuestions(sessionId);
    if (!pending) return;
    const idx = pending.currentIndex;
    if (idx >= pending.questions.length) {
      // All questions answered — press Enter on "Submit answers" screen, then cleanup
      const remote = sessionManager.getRemote(sessionId);
      if (remote) {
        remote.inputQueue.push("\x1b[POLL_SUBMIT]");
      }
      sessionManager.clearPendingQuestions(sessionId);
      return;
    }

    const q = pending.questions[idx];
    // Build options for poll (max 10 real options to keep UI manageable across channels)
    const optionLabels = q.options.slice(0, 9).map((o) => o.label);
    optionLabels.push("Other (type a reply)");

    try {
      const questionText = q.question.length > 300 ? q.question.slice(0, 297) + "..." : q.question;
      const sent = await sendPollToChat(
        pending.chatId,
        questionText,
        optionLabels,
        q.multiSelect
      );
      if (!sent) return;
      const { pollId, messageId } = sent;
      sessionManager.registerPoll(pollId, {
        sessionId,
        chatId: pending.chatId,
        messageId,
        questionIndex: idx,
        totalQuestions: pending.questions.length,
        multiSelect: q.multiSelect,
        optionCount: optionLabels.length - 1, // exclude "Other"
      });
    } catch (e) {
      await logger.error("Failed to send poll", { sessionId, error: (e as Error).message });
      sessionManager.clearPendingQuestions(sessionId);
    }
  }

  function buildFilePickerPage(
    files: string[],
    query: string,
    page: number,
    selectedMentions: string[],
    pageSize: number
  ): {
    page: number;
    totalPages: number;
    options: PendingFilePickerOption[];
    optionLabels: string[];
    title: string;
  } {
    const totalPages = Math.max(1, Math.ceil(files.length / pageSize));
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const start = currentPage * pageSize;
    const visible = files.slice(start, start + pageSize);
    const selected = new Set(selectedMentions);

    const options: PendingFilePickerOption[] = visible.map((path) => ({
      kind: "toggle",
      mention: `@${path}`,
    }));
    const optionLabels: string[] = visible.map((path) => {
      const isDir = path.endsWith("/");
      const mention = `@${path}`;
      return `${selected.has(mention) ? "✅" : "☑️"} ${isDir ? "📁 " : ""}${mention}`;
    });

    if (totalPages > 1 && currentPage > 0) {
      options.push({ kind: "prev" });
      optionLabels.push("⬅️ Prev");
    }
    if (totalPages > 1 && currentPage < totalPages - 1) {
      options.push({ kind: "next" });
      optionLabels.push("➡️ Next");
    }
    if (selected.size > 0) {
      options.push({ kind: "clear" });
      optionLabels.push("🧹 Clear selected");
    }
    options.push({ kind: "cancel" });
    optionLabels.push("❌ Cancel");

    const q = query.trim();
    const title = q
      ? `Pick paths (${q}) ${currentPage + 1}/${totalPages} • selected ${selected.size}`
      : `Pick paths ${currentPage + 1}/${totalPages} • selected ${selected.size}`;

    return { page: currentPage, totalPages, options, optionLabels, title };
  }

  function handlePollAnswer(answer: { pollId: string; userId: ChannelUserId; optionIds: number[] }) {
    const filePicker = sessionManager.getFilePickerByPollId(answer.pollId);
    if (filePicker) {
      if (!isUserPaired(config, answer.userId)) {
        logger.warn("Ignoring file picker answer from unpaired user", { userId: answer.userId, pollId: answer.pollId });
        return;
      }
      if (filePicker.ownerUserId !== answer.userId) {
        logger.warn("Ignoring file picker answer from non-owner", {
          userId: answer.userId,
          pollId: answer.pollId,
          ownerUserId: filePicker.ownerUserId,
        });
        return;
      }

      closePollForChat(filePicker.chatId, filePicker.messageId);
      sessionManager.removeFilePicker(answer.pollId);

      const selectedIdx = answer.optionIds[0];
      if (!Number.isFinite(selectedIdx)) return;
      if (selectedIdx < 0 || selectedIdx >= filePicker.options.length) return;
      const selected = filePicker.options[selectedIdx];

      if (selected.kind === "cancel") {
        const pickerFmt = getFormatterForChat(filePicker.chatId);
        sendToChat(filePicker.chatId, `${pickerFmt.escape("📎")} File picker canceled.`);
        return;
      }

      if (selected.kind === "clear") {
        sessionManager.setPendingFileMentions(
          filePicker.sessionId,
          filePicker.chatId,
          filePicker.ownerUserId,
          []
        );
        const nextPage = buildFilePickerPage(
          filePicker.files,
          filePicker.query,
          filePicker.page,
          [],
          filePicker.pageSize
        );
        sendPollToChat(filePicker.chatId, nextPage.title, nextPage.optionLabels, false)
          .then((sent) => {
            if (!sent) return;
            sessionManager.registerFilePicker({
              pollId: sent.pollId,
              messageId: sent.messageId,
              chatId: filePicker.chatId,
              ownerUserId: filePicker.ownerUserId,
              sessionId: filePicker.sessionId,
              files: filePicker.files,
              query: filePicker.query,
              page: nextPage.page,
              pageSize: filePicker.pageSize,
              totalPages: nextPage.totalPages,
              selectedMentions: [],
              options: nextPage.options,
            });
          })
          .catch(() => {});
        return;
      }

      let nextSelected = filePicker.selectedMentions.slice();
      let targetPage = filePicker.page;
      if (selected.kind === "toggle") {
        if (nextSelected.includes(selected.mention)) {
          nextSelected = nextSelected.filter((m) => m !== selected.mention);
        } else {
          nextSelected.push(selected.mention);
        }
      } else if (selected.kind === "next") {
        targetPage = filePicker.page + 1;
      } else if (selected.kind === "prev") {
        targetPage = filePicker.page - 1;
      }

      if (selected.kind === "toggle") {
        sessionManager.setPendingFileMentions(
          filePicker.sessionId,
          filePicker.chatId,
          filePicker.ownerUserId,
          nextSelected
        );
      }

      const nextPage = buildFilePickerPage(
        filePicker.files,
        filePicker.query,
        targetPage,
        nextSelected,
        filePicker.pageSize
      );

      sendPollToChat(filePicker.chatId, nextPage.title, nextPage.optionLabels, false)
        .then((sent) => {
          if (!sent) return;
          sessionManager.registerFilePicker({
            pollId: sent.pollId,
            messageId: sent.messageId,
            chatId: filePicker.chatId,
            ownerUserId: filePicker.ownerUserId,
            sessionId: filePicker.sessionId,
            files: filePicker.files,
            query: filePicker.query,
            page: nextPage.page,
            pageSize: filePicker.pageSize,
            totalPages: nextPage.totalPages,
            selectedMentions: nextSelected,
            options: nextPage.options,
          });
        })
        .catch(() => {});
      return;
    }

    const resumePicker = sessionManager.getResumePickerByPollId(answer.pollId);
    if (resumePicker) {
      if (!isUserPaired(config, answer.userId)) {
        logger.warn("Ignoring resume picker answer from unpaired user", { userId: answer.userId, pollId: answer.pollId });
        return;
      }
      if (resumePicker.ownerUserId !== answer.userId) {
        logger.warn("Ignoring resume picker answer from non-owner", {
          userId: answer.userId,
          pollId: answer.pollId,
          ownerUserId: resumePicker.ownerUserId,
        });
        return;
      }

      closePollForChat(resumePicker.chatId, resumePicker.messageId);
      sessionManager.removeResumePicker(answer.pollId);

      const selectedIdx = answer.optionIds[0];
      if (!Number.isFinite(selectedIdx)) return;
      if (selectedIdx < 0 || selectedIdx >= resumePicker.options.length) return;
      const selected = resumePicker.options[selectedIdx];

      if (selected.kind === "more") {
        const nextPage = buildResumePickerPage(
          resumePicker.sessions,
          selected.nextOffset
        );
        sendPollToChat(resumePicker.chatId, nextPage.title, nextPage.optionLabels, false)
          .then((sent) => {
            if (!sent) return;
            sessionManager.registerResumePicker({
              pollId: sent.pollId,
              messageId: sent.messageId,
              chatId: resumePicker.chatId,
              ownerUserId: resumePicker.ownerUserId,
              sessionId: resumePicker.sessionId,
              tool: resumePicker.tool,
              sessions: resumePicker.sessions,
              offset: nextPage.offset,
              options: nextPage.options,
            });
          })
          .catch(() => {});
        return;
      }

      const remote = sessionManager.getRemote(resumePicker.sessionId);
      if (!remote) {
        const pickerFmt = getFormatterForChat(resumePicker.chatId);
        sendToChat(resumePicker.chatId, `${pickerFmt.escape("⛳️")} Session is no longer active.`);
        return;
      }

      if (!sessionManager.requestRemoteResume(remote.id, selected.sessionRef)) {
        const pickerFmt = getFormatterForChat(resumePicker.chatId);
        sendToChat(resumePicker.chatId, `${pickerFmt.escape("⛳️")} Could not request resume on current session.`);
        return;
      }

      const pickerFmt = getFormatterForChat(resumePicker.chatId);
      sendToChat(
        resumePicker.chatId,
        `${pickerFmt.escape("⛳️")} Switching to ${pickerFmt.code(pickerFmt.escape(selected.label))}...`
      );
      return;
    }

    const outputModePicker = sessionManager.getOutputModePickerByPollId(answer.pollId);
    if (outputModePicker) {
      if (!isUserPaired(config, answer.userId)) {
        logger.warn("Ignoring output-mode picker answer from unpaired user", { userId: answer.userId, pollId: answer.pollId });
        return;
      }
      if (outputModePicker.ownerUserId !== answer.userId) {
        logger.warn("Ignoring output-mode picker answer from non-owner", {
          userId: answer.userId,
          pollId: answer.pollId,
          ownerUserId: outputModePicker.ownerUserId,
        });
        return;
      }

      closePollForChat(outputModePicker.chatId, outputModePicker.messageId);
      sessionManager.removeOutputModePicker(answer.pollId);

      const selectedIdx = answer.optionIds[0];
      if (!Number.isFinite(selectedIdx)) return;
      if (selectedIdx < 0 || selectedIdx >= outputModePicker.options.length) return;
      const selectedMode = outputModePicker.options[selectedIdx] as OutputMode;
      const changed = setChatOutputMode(config, outputModePicker.chatId, selectedMode);
      if (changed) {
        saveConfig(config).catch(() => {});
      }
      const selectedModeLabel = selectedMode === "compact" ? "simple" : selectedMode;
      const pickerFmt = getFormatterForChat(outputModePicker.chatId);
      sendToChat(
        outputModePicker.chatId,
        `${pickerFmt.escape("⛳️")} Output mode is now ${pickerFmt.code(pickerFmt.escape(selectedModeLabel))} for this chat.`
      );
      return;
    }

    const poll = sessionManager.getPollByPollId(answer.pollId);
    if (!poll) return;
    if (!isUserPaired(config, answer.userId)) {
      logger.warn("Ignoring poll answer from unpaired user", { userId: answer.userId, pollId: answer.pollId });
      return;
    }

    const remote = sessionManager.getRemote(poll.sessionId);
    if (!remote) return;
    if (remote.ownerUserId !== answer.userId) {
      logger.warn("Ignoring poll answer from non-owner", {
        userId: answer.userId,
        sessionId: poll.sessionId,
        ownerUserId: remote.ownerUserId,
      });
      return;
    }

    // Close the poll
    closePollForChat(poll.chatId, poll.messageId);
    sessionManager.removePoll(answer.pollId);

    const otherIdx = poll.optionCount; // "Other" is the last option
    const selectedOther = answer.optionIds.includes(otherIdx);

    if (selectedOther) {
      // User chose "Other" — push marker, wait for text message
      remote.inputQueue.push("\x1b[POLL_OTHER]");
      // Don't advance to next question; text handler will do that
      sessionManager.clearPendingQuestions(poll.sessionId);
    } else {
      // Encode selected options
      const encoded = `\x1b[POLL:${answer.optionIds.join(",")}:${poll.multiSelect ? "1" : "0"}]`;
      remote.inputQueue.push(encoded);

      // For multi-select, need to navigate Down to "Next"/"Submit" and press Enter
      // (single-select Enter already advances automatically)
      // Encode last cursor position and option count so CLI can calculate Downs needed
      if (poll.multiSelect) {
        const lastPos = answer.optionIds.length > 0 ? Math.max(...answer.optionIds) : 0;
        remote.inputQueue.push(`\x1b[POLL_NEXT:${lastPos}:${poll.optionCount}]`);
      }

      // Record answer and advance
      const pending = sessionManager.getPendingQuestions(poll.sessionId);
      if (pending) {
        pending.answers.push(answer.optionIds);
        pending.currentIndex++;
        sendNextPoll(poll.sessionId);
      }
    }
  }

  // Wire poll answer handler on all channels that support it
  for (const { channel } of channels) {
    if ("onPollAnswer" in channel) {
      channel.onPollAnswer = handlePollAnswer;
    }
  }

  // Reap orphaned remote sessions whose CLI crashed without calling /exit
  const REAP_INTERVAL = 60_000;
  const REAP_MAX_AGE = 30_000;
  const reaperTimer = setInterval(async () => {
    const reaped = sessionManager.reapStaleRemotes(REAP_MAX_AGE);
    for (const remote of reaped) {
      reconnectNoticeBySession.delete(remote.id);
      await clearBackgroundBoards(remote.id);
      await logger.info("Reaped stale remote session", { id: remote.id, command: remote.command });
      const fmt = getFormatterForChat(remote.chatId);
      const msg = `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(sessionLabel(remote.command, remote.cwd)))} disconnected (CLI stopped responding)`;
      sendToChat(remote.chatId, msg);
      syncCommandMenuForChat(remote.chatId, remote.ownerUserId);
      if (remote.boundChatId && remote.boundChatId !== remote.chatId) {
        syncCommandMenuForChat(remote.boundChatId, remote.ownerUserId);
      }
    }
    if (reaped.length > 0 && sessionManager.remoteCount() === 0) {
      scheduleAutoStop();
    }
  }, REAP_INTERVAL);

  onShutdown(async () => {
    clearInterval(reaperTimer);
    clearInterval(backgroundBoardRefreshTimer);
    if (persistStatusBoardsTimer) {
      clearTimeout(persistStatusBoardsTimer);
      persistStatusBoardsTimer = null;
    }
    await persistStatusBoardsNow();
    cancelAutoStop();
    for (const { channel } of channels) channel.stopReceiving();
    sessionManager.killAll();
  });

  await startControlServer({
    authToken: daemonAuthToken,
    startedAt: DAEMON_STARTED_AT,
    getStatus() {
      return {
        pid: process.pid,
        uptime: process.uptime(),
        sessions: sessionManager.list().map((s) => ({
          id: s.id,
          command: s.command,
          state: s.state,
          createdAt: s.createdAt,
        })),
      };
    },
    getInputNeeded() {
      return sessionManager.getInputNeeded();
    },
    async shutdown() {
      cancelAutoStop();
      clearInterval(backgroundBoardRefreshTimer);
      if (persistStatusBoardsTimer) {
        clearTimeout(persistStatusBoardsTimer);
        persistStatusBoardsTimer = null;
      }
      await persistStatusBoardsNow();
      for (const { channel } of channels) channel.stopReceiving();
      sessionManager.killAll();
      await removeAuthToken();
      await removePidFile();
      await removeDaemonLock();
      await removeSocket();
      await removeControlPortFile();
      process.exit(0);
    },
    generatePairingCode() {
      return generatePairingCode();
    },
    async getChannels(): Promise<ChannelInfo[]> {
      await refreshConfig();
      const pairedUsers = getAllPairedUsers(config);
      const results: ChannelInfo[] = [];

      // DM channels: one per paired user per bot
      for (const user of pairedUsers) {
        const dmChatId = user.userId;
        const channel = getChannelForChat(dmChatId);
        let title = "DM";
        if (channel?.getBotName) {
          try { title = await channel.getBotName(); } catch {}
        }
        const bound = sessionManager.getAttachedRemote(dmChatId);
        results.push({
          chatId: dmChatId,
          title,
          type: "dm",
          busy: !!bound,
          busyLabel: bound ? sessionLabel(bound.command, bound.cwd) : null,
        });
      }

      // Linked groups and topics
      const rawGroups = getAllLinkedGroups(config);
      for (const g of rawGroups) {
        const isTopic = parseChannelAddress(g.chatId).threadPart !== undefined;
        const bound = sessionManager.getAttachedRemote(g.chatId);
        results.push({
          chatId: g.chatId,
          title: g.title || g.chatId,
          type: isTopic ? "topic" : "group",
          busy: !!bound,
          busyLabel: bound ? sessionLabel(bound.command, bound.cwd) : null,
        });
      }

      return results;
    },
    async registerRemote(command: string, chatId: ChannelChatId, ownerUserId: ChannelUserId, cwd: string, existingId?: string, subscribedGroups?: string[]): Promise<{ sessionId: string; dmBusy: boolean; dmBusyLabel?: string; linkedGroups: Array<{ chatId: string; title?: string }>; allLinkedGroups: Array<{ chatId: string; title?: string; busyLabel?: string }> }> {
      cancelAutoStop();
      const isReconnect = !!existingId && !sessionManager.getRemote(existingId);
      const remote = sessionManager.registerRemote(command, chatId, ownerUserId, cwd, existingId);
      const remoteAddress = parseChannelAddress(remote.chatId);
      const remoteType = remoteAddress.type;
      const remoteChannelName = remoteAddress.channelName;

      // Restore group subscriptions (e.g. after daemon restart, CLI re-registers with saved groups)
      if (subscribedGroups) {
        for (const groupId of subscribedGroups) {
          sessionManager.subscribeGroup(remote.id, groupId);
        }
      }

      if (isReconnect) {
        const now = Date.now();
        const lastNoticeAt = reconnectNoticeBySession.get(remote.id) ?? 0;
        if (now - lastNoticeAt >= RECONNECT_NOTICE_COOLDOWN_MS) {
          reconnectNoticeBySession.set(remote.id, now);
          const label = sessionLabel(command, cwd);
          const fmt = getFormatterForChat(chatId);
          sendToChat(chatId, `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(label))} reconnected after daemon restart. Messages sent during restart may have been lost.`);
        }
      }

      const existingBound = sessionManager.getAttachedRemote(chatId);
      const dmBusy = !!existingBound && existingBound.id !== remote.id;
      const dmBusyLabel = dmBusy && existingBound ? sessionLabel(existingBound.command, existingBound.cwd) : undefined;

      await refreshConfig();
      const rawGroups = getAllLinkedGroups(config).filter((g) => {
        const parsedGroup = parseChannelAddress(g.chatId);
        if (parsedGroup.type !== remoteType) return false;
        if (remoteChannelName || parsedGroup.channelName) {
          return parsedGroup.channelName === remoteChannelName;
        }
        return true;
      });

      // Validate groups still exist, remove dead ones
      const validGroups: Array<{ chatId: string; title?: string }> = [];
      for (const g of rawGroups) {
        const groupChannel = getChannelForChat(g.chatId);
        if (groupChannel?.validateChat) {
          const alive = await groupChannel.validateChat(g.chatId);
          if (alive) {
            validGroups.push({ chatId: g.chatId, title: g.title });
          } else {
            await logger.info("Removing inaccessible linked group", { chatId: g.chatId, title: g.title });
            removeLinkedGroup(config, g.chatId, remoteChannelName);
            await saveConfig(config);
          }
        } else {
          validGroups.push({ chatId: g.chatId, title: g.title });
        }
      }

      const allLinkedGroups = validGroups.map((g) => {
        const bound = sessionManager.getAttachedRemote(g.chatId);
        const busyLabel = bound && bound.id !== remote.id ? sessionLabel(bound.command, bound.cwd) : undefined;
        return { chatId: g.chatId, title: g.title, busyLabel };
      });
      const linkedGroups = allLinkedGroups.filter((g) => !g.busyLabel);

      syncCommandMenuForChat(chatId, ownerUserId);

      return { sessionId: remote.id, dmBusy, dmBusyLabel, linkedGroups, allLinkedGroups };
    },
    async bindChat(sessionId: string, chatId: ChannelChatId): Promise<{ ok: boolean; error?: string }> {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return { ok: false, error: "Session not found" };
      const isOwnerDm = remote.chatId === chatId;
      await refreshConfig();
      const isLinkedTarget = isLinkedGroup(config, chatId);
      if (!isOwnerDm && !isLinkedTarget) return { ok: false, error: "Group is not linked" };

      // Validate the chat still exists
      const targetChannel = getChannelForChat(chatId);
      if (!isOwnerDm && targetChannel?.validateChat) {
        const alive = await targetChannel.validateChat(chatId);
        if (!alive) {
          removeLinkedGroup(config, chatId, getChannelName(chatId));
          await saveConfig(config);
          return { ok: false, error: "Group no longer exists or bot was removed from it" };
        }
      }

      // Disconnect old session from this channel if taken
      const oldRemote = sessionManager.getAttachedRemote(chatId);
      if (oldRemote && oldRemote.id !== sessionId) {
        sessionManager.detach(chatId);
        syncCommandMenuForChat(chatId, oldRemote.ownerUserId);
        const fmt = getFormatterForChat(chatId);
        sendToChat(chatId, `${fmt.escape("🔄")} ${fmt.bold(fmt.escape(sessionLabel(oldRemote.command, oldRemote.cwd)))} disconnected`);
      }

      // Remove auto-attached DM if binding to a different chat
      if (remote.chatId !== chatId) {
        sessionManager.detach(remote.chatId);
        syncCommandMenuForChat(remote.chatId, remote.ownerUserId);
      }
      sessionManager.attach(chatId, sessionId);
      syncCommandMenuForChat(chatId, remote.ownerUserId);
      if (isLinkedTarget) {
        sessionManager.subscribeGroup(sessionId, chatId);
      }
      const fmt = getFormatterForChat(chatId);
      sendToChat(chatId, `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(sessionLabel(remote.command, remote.cwd)))} connected`);
      return { ok: true };
    },
    canUserAccessSession(userId: ChannelUserId, sessionId: string): boolean {
      return sessionManager.canUserAccessSession(userId, sessionId);
    },
    drainRemoteInput(sessionId: string): string[] {
      return sessionManager.drainRemoteInput(sessionId);
    },
    drainRemoteControl(sessionId: string) {
      return sessionManager.drainRemoteControl(sessionId);
    },
    pushRemoteInput(sessionId: string, text: string): boolean {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return false;
      remote.inputQueue.push(text);
      return true;
    },
    hasRemote(sessionId: string): boolean {
      return !!sessionManager.getRemote(sessionId);
    },
    endRemote(sessionId: string, exitCode: number | null): void {
      const remote = sessionManager.getRemote(sessionId);
      if (remote) {
        reconnectNoticeBySession.delete(sessionId);
        const status = exitCode === 0 ? "disconnected" : `disconnected (code ${exitCode ?? "unknown"})`;
        void clearBackgroundBoards(sessionId);
        const boundChat = sessionManager.getBoundChat(sessionId);
        if (boundChat) {
          const fmt = getFormatterForChat(boundChat);
          const msg = `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(sessionLabel(remote.command, remote.cwd)))} ${fmt.escape(status)}`;
          sendToChat(boundChat, msg);
        }
        sessionManager.removeRemote(sessionId);
        syncCommandMenuForChat(remote.chatId, remote.ownerUserId);
        if (boundChat && boundChat !== remote.chatId) {
          syncCommandMenuForChat(boundChat, remote.ownerUserId);
        }
      }

      if (sessionManager.remoteCount() === 0) {
        scheduleAutoStop();
      }
    },
    getSubscribedGroups(sessionId: string): string[] {
      return sessionManager.getSubscribedGroups(sessionId);
    },
    getBoundChat(sessionId: string): string | null {
      return sessionManager.getBoundChat(sessionId);
    },
    async sendFileToSession(sessionId: string, filePath: string, caption?: string): Promise<{ ok: boolean; error?: string }> {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return { ok: false, error: "Session not found" };

      let fileStats;
      try {
        fileStats = await stat(filePath);
      } catch {
        return { ok: false, error: `File not found: ${filePath}` };
      }
      if (!fileStats.isFile()) return { ok: false, error: `Not a file: ${filePath}` };
      if (fileStats.size <= 0) return { ok: false, error: "File is empty" };
      if (fileStats.size > 50 * 1024 * 1024) return { ok: false, error: "File exceeds 50MB channel upload limit" };

      const targets = new Set<ChannelChatId>();
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      if (targetChat) targets.add(targetChat);
      for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
        targets.add(groupChatId);
      }
      if (targets.size === 0) return { ok: false, error: "No bound channel for this session" };

      const finalCaption = (caption && caption.trim()) || basename(filePath);
      for (const cid of targets) {
        const channel = getChannelForChat(cid);
        if (!channel?.sendDocument) {
          return { ok: false, error: `Channel ${cid.split(":")[0]} does not support file sending` };
        }
        await channel.sendDocument(cid, filePath, finalCaption);
      }
      return { ok: true };
    },
    stopSessionById(sessionId: string): { ok: boolean; error?: string } {
      if (sessionManager.requestRemoteStop(sessionId)) {
        return { ok: true };
      }
      return { ok: false, error: "Session not found or already exited" };
    },
    killSessionById(sessionId: string): { ok: boolean; error?: string } {
      if (sessionManager.requestRemoteKill(sessionId)) {
        return { ok: true };
      }
      return { ok: false, error: "Session not found or already exited" };
    },
    restartSessionById(sessionId: string, sessionRef?: string): { ok: boolean; error?: string; sessionRef?: string } {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) {
        return { ok: false, error: "Session not found or already exited" };
      }

      let resolvedSessionRef = cleanResumeRef(sessionRef);
      if (!resolvedSessionRef) {
        const tool = detectResumableTool(remote.command);
        if (!tool) {
          return { ok: false, error: "Current session command does not support resume restart" };
        }
        resolvedSessionRef = extractResumeRefFromCommand(tool, remote.command);
        if (!resolvedSessionRef) {
          return { ok: false, error: "Could not infer resume session ID; pass --session <tool_session_id>" };
        }
      }

      if (!sessionManager.requestRemoteResume(sessionId, resolvedSessionRef)) {
        return { ok: false, error: "Session not found or already exited" };
      }
      return { ok: true, sessionRef: resolvedSessionRef };
    },
    handleToolCall(sessionId: string, name: string, input: Record<string, unknown>): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targets = new Set<ChannelChatId>();
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      if (targetChat) targets.add(targetChat);
      for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
        targets.add(groupChatId);
      }
      if (targets.size === 0) return;

      for (const cid of targets) {
        if (isChatMutedForChat(cid)) continue;
        const outputMode = getOutputModeForChat(cid);
        const fmt = getFormatterForChat(cid);
        const detailMode = outputMode === "verbose" ? "verbose" : "simple";
        const html = formatToolCall(fmt, name, input, detailMode, remote.cwd);
        if (!html) continue;
        sendToChat(cid, html);
        // Re-assert typing for channels that support typing state.
        setTypingForChat(cid, true);
      }
    },
    handleTyping(sessionId: string, active: boolean): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;

      const targets = new Set<ChannelChatId>();
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      if (targetChat) targets.add(targetChat);
      for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
        targets.add(groupChatId);
      }
      if (targets.size === 0) return;

      for (const cid of targets) {
        if (isChatMutedForChat(cid)) {
          if (!active) setTypingForChat(cid, false);
          continue;
        }
        setTypingForChat(cid, active);
      }
    },
    handleApprovalNeeded(sessionId: string, name: string, input: Record<string, unknown>, promptText?: string, pollOptions?: string[]): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targetChat = sessionManager.getBoundChat(sessionId);
      if (!targetChat) return;
      // Use the prompt text from Claude Code's terminal if available
      let question: string;
      if (promptText) {
        question = promptText.slice(0, 300);
      } else {
        const detail = (input.command as string) || (input.file_path as string)
          || (input.pattern as string) || (input.query as string)
          || (input.url as string) || (input.description as string) || "";
        const label = detail.length > 200 ? detail.slice(0, 200) + "..." : detail;
        question = (label ? `${name}: ${label}` : name).slice(0, 300);
      }
      const options = pollOptions && pollOptions.length >= 2 ? pollOptions : ["Yes", "Yes, don't ask again", "No"];
      sendPollToChat(targetChat, question, options, false).then(
        (sent) => {
          if (!sent) return;
          const { pollId, messageId } = sent;
          sessionManager.registerPoll(pollId, {
            sessionId,
            chatId: targetChat,
            messageId,
            questionIndex: 0,
            totalQuestions: 1,
            multiSelect: false,
            optionCount: 3,
          });
        }
      ).catch((e) => {
        logger.error("Failed to send tool approval poll", { sessionId, error: (e as Error).message });
      });
    },
    handleThinking(sessionId: string, text: string): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targets = new Set<ChannelChatId>();
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      if (targetChat) targets.add(targetChat);
      for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
        targets.add(groupChatId);
      }
      if (targets.size === 0) return;

      const truncated = text.length > 1000 ? text.slice(0, 1000) + "..." : text;
      for (const cid of targets) {
        if (isChatMutedForChat(cid)) continue;
        if (!isThinkingEnabledForChat(cid)) continue;
        const outputMode = getOutputModeForChat(cid);
        const fmt = getFormatterForChat(cid);
        if (outputMode === "verbose") {
          sendToChat(cid, `${fmt.bold("Thinking")}\n${fmt.italic(fmt.fromMarkdown(truncated))}`);
        } else {
          const compact = truncated.length > 220 ? `${truncated.slice(0, 220)}...` : truncated;
          sendToChat(cid, `${fmt.escape("💭")} ${fmt.italic(fmt.fromMarkdown(compact))}`);
        }
      }
    },
    handleAssistantText(sessionId: string, text: string): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;

      const targets = new Set<ChannelChatId>();
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      if (targetChat) targets.add(targetChat);
      for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
        targets.add(groupChatId);
      }
      if (targets.size === 0) return;

      for (const cid of targets) {
        if (isChatMutedForChat(cid)) {
          setTypingForChat(cid, false);
          continue;
        }
        const fmt = getFormatterForChat(cid);
        setTypingForChat(cid, false);
        sendToChat(cid, fmt.fromMarkdown(text));
      }
    },
    handleToolResult(sessionId: string, toolName: string, content: string, isError = false): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targets = new Set<ChannelChatId>();
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      if (targetChat) targets.add(targetChat);
      for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
        targets.add(groupChatId);
      }
      if (targets.size === 0) return;

      for (const cid of targets) {
        if (isChatMutedForChat(cid)) continue;
        const outputMode = getOutputModeForChat(cid);
        const fmt = getFormatterForChat(cid);
        if (outputMode === "verbose") {
          const maxLen = 1500;
          const truncated = content.length > maxLen ? content.slice(0, maxLen) + "\n..." : content;
          const label = isError
            ? `${toolName || "Tool"} error`
            : ((toolName === "Bash" || toolName === "bash" || toolName === "exec_command") ? "Output" : `${toolName} result`);
          sendToChat(cid, `${fmt.bold(fmt.escape(label))}\n${fmt.pre(fmt.escape(truncated))}`);
        } else {
          const summary = formatSimpleToolResult(fmt, toolName, content, isError);
          if (!summary) continue;
          sendToChat(cid, summary);
        }
        if (!isError) setTypingForChat(cid, true);
      }
    },
    handleBackgroundJob(
      sessionId: string,
      event: BackgroundJobEvent
    ): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const status = normalizeBackgroundStatus(event.status);
      if (!status) return;
      if (!event.taskId) return;

      if (status === "running") {
        const sessionJobs = backgroundJobsBySession.get(sessionId) || new Map<string, BackgroundJobState>();
        const existing = sessionJobs.get(event.taskId);
        const mergedUrls = mergeUrls(
          existing?.urls,
          mergeUrls(event.urls, inferUrlsFromCommand(event.command || existing?.command))
        );
        sessionJobs.set(event.taskId, {
          taskId: event.taskId,
          status,
          command: event.command || existing?.command,
          outputFile: event.outputFile || existing?.outputFile,
          summary: event.summary || existing?.summary,
          urls: mergedUrls,
          updatedAt: Date.now(),
        });
        backgroundJobsBySession.set(sessionId, sessionJobs);
        if (!existing) {
          announceBackgroundJobEvent(sessionId, status, {
            taskId: event.taskId,
            command: event.command,
            summary: event.summary,
            urls: mergedUrls,
          });
        }
      } else {
        const sessionJobs = backgroundJobsBySession.get(sessionId);
        const existing = sessionJobs?.get(event.taskId);
        sessionJobs?.delete(event.taskId);
        if (sessionJobs && sessionJobs.size === 0) {
          backgroundJobsBySession.delete(sessionId);
        }
        announceBackgroundJobEvent(sessionId, status, {
          taskId: event.taskId,
          command: event.command || existing?.command,
          summary: event.summary || existing?.summary,
          urls: mergeUrls(
            existing?.urls,
            mergeUrls(event.urls, inferUrlsFromCommand(event.command || existing?.command))
          ),
        });
      }

      void refreshBackgroundBoards(sessionId);
    },
    handleQuestion(sessionId: string, questions: unknown[]): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      // Parse raw questions into AskQuestion format
      const parsed: AskQuestion[] = questions.map((q: unknown) => {
        const raw = q as Record<string, unknown>;
        const options = ((raw.options as Array<Record<string, unknown>>) || []).map((o) => ({
          label: (o.label as string) || "",
          description: o.description as string | undefined,
        }));
        return {
          question: (raw.question as string) || "",
          options,
          multiSelect: (raw.multiSelect as boolean) || false,
        };
      });
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      sessionManager.setPendingQuestions(sessionId, parsed, targetChat);
      sendNextPoll(sessionId);
    },
    // --- Config channel management ---
    async getConfigChannels(): Promise<ConfigChannelSummary[]> {
      await refreshConfig();
      const results: ConfigChannelSummary[] = [];
      for (const [name, ch] of Object.entries(config.channels)) {
        let botUsername: string | undefined;
        let botFirstName: string | undefined;
        if (ch.type === "telegram") {
          const token = getTelegramBotToken(config, name);
          if (token) {
            try {
              const me = await new TelegramApi(token).getMe();
              botUsername = me.username;
              botFirstName = me.first_name;
            } catch {}
          }
        }
        results.push({
          name,
          type: ch.type,
          botUsername,
          botFirstName,
          pairedUserCount: ch.pairedUsers.length,
          linkedGroupCount: (ch.linkedGroups || []).length,
        });
      }
      return results;
    },
    async getChannelDetails(name: string): Promise<{ ok: boolean; error?: string; channel?: ConfigChannelDetails }> {
      await refreshConfig();
      const ch = config.channels[name];
      if (!ch) return { ok: false, error: "Channel not found" };
      let botUsername: string | undefined;
      if (ch.type === "telegram") {
        const token = getTelegramBotToken(config, name);
        if (token) {
          try {
            const me = await new TelegramApi(token).getMe();
            botUsername = me.username;
          } catch {}
        }
      }
      return {
        ok: true,
        channel: {
          name,
          type: ch.type,
          botUsername,
          pairedUsers: ch.pairedUsers.map((u) => ({ userId: u.userId, username: u.username, pairedAt: u.pairedAt })),
          linkedGroups: (ch.linkedGroups || []).map((g) => ({ chatId: g.chatId, title: g.title, linkedAt: g.linkedAt })),
        },
      };
    },
    async addChannel(name: string, type: string, botToken: string): Promise<{ ok: boolean; error?: string; botUsername?: string; botFirstName?: string; needsRestart?: boolean }> {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
        return { ok: false, error: "Invalid channel name. Must be lowercase alphanumeric, starting with a letter (max 64 chars)" };
      }
      if (type !== "telegram") {
        return { ok: false, error: `Unsupported channel type: ${type}` };
      }
      await refreshConfig();
      if (config.channels[name]) {
        return { ok: false, error: `Channel "${name}" already exists` };
      }
      // Validate bot token
      let botUsername: string | undefined;
      let botFirstName: string | undefined;
      try {
        const me = await new TelegramApi(botToken).getMe();
        botUsername = me.username;
        botFirstName = me.first_name;
      } catch (e) {
        return { ok: false, error: `Invalid bot token: ${(e as Error).message}` };
      }
      config.channels[name] = {
        type,
        credentials: { botToken },
        pairedUsers: [],
        linkedGroups: [],
      };
      await saveConfig(config);
      return { ok: true, botUsername, botFirstName, needsRestart: true };
    },
    async removeChannel(name: string): Promise<{ ok: boolean; error?: string; needsRestart?: boolean }> {
      await refreshConfig();
      const ch = config.channels[name];
      if (!ch) {
        return { ok: false, error: "Channel not found" };
      }
      // Check if any active sessions are using this channel
      const sessions = sessionManager.list();
      for (const s of sessions) {
        const remote = sessionManager.getRemote(s.id);
        if (remote) {
          const parsed = parseChannelAddress(remote.chatId);
          // Match scoped addresses (telegram:botname:123) or unscoped (telegram:123)
          // where the channel is the default for that type
          const usesThisChannel =
            parsed.channelName === name ||
            (!parsed.channelName && parsed.type === ch.type);
          if (usesThisChannel) {
            return { ok: false, error: `Cannot remove channel: active session ${s.id} is using it` };
          }
        }
      }
      delete config.channels[name];
      await saveConfig(config);
      return { ok: true, needsRestart: true };
    },
    async removePairedUser(channelName: string, userId: string): Promise<{ ok: boolean; error?: string }> {
      await refreshConfig();
      const ch = config.channels[channelName];
      if (!ch) return { ok: false, error: "Channel not found" };
      const idx = ch.pairedUsers.findIndex((u) => u.userId === userId);
      if (idx < 0) return { ok: false, error: "Paired user not found" };
      ch.pairedUsers.splice(idx, 1);
      await saveConfig(config);
      return { ok: true };
    },
    async addLinkedGroupApi(channelName: string, chatId: string, title?: string): Promise<{ ok: boolean; error?: string }> {
      await refreshConfig();
      const ch = config.channels[channelName];
      if (!ch) return { ok: false, error: "Channel not found" };
      const added = addLinkedGroup(config, chatId, title, channelName);
      if (!added) return { ok: false, error: "Group already linked or channel type mismatch" };
      await saveConfig(config);
      return { ok: true };
    },
    async removeLinkedGroupApi(channelName: string, chatId: string): Promise<{ ok: boolean; error?: string }> {
      await refreshConfig();
      const ch = config.channels[channelName];
      if (!ch) return { ok: false, error: "Channel not found" };
      const removed = removeLinkedGroup(config, chatId, channelName);
      if (!removed) return { ok: false, error: "Linked group not found" };
      await saveConfig(config);
      return { ok: true };
    },
  });

  // Start receiving on all channels
  for (const { name: channelName, channel } of channels) {
    void channel.startReceiving(async (msg) => {
      await refreshConfig();
      await routeMessage(msg, {
        config,
        channelName,
        sessionManager,
        channel,
        listBackgroundJobs: listBackgroundJobsForUserChat,
      });
    }).catch(async (error: unknown) => {
      await logger.error("Channel receiver stopped", {
        channel: channelName,
        type: channel.type,
        error: (error as Error)?.message ?? String(error),
      });
    });
  }

  syncKnownCommandMenus();

  await logger.info("Daemon started successfully");
}
