import {
  TelegramApi,
  type TelegramUpdate,
  type TelegramInlineKeyboardButton,
  type TelegramBotCommandScope,
} from "./api";
import type {
  Channel,
  ChannelChatId,
  CommandMenuContext,
  ClearStatusBoardOptions,
  InboundMessage,
  PollResult,
  PollAnswerHandler,
  StatusBoardResult,
  StatusBoardOptions,
} from "../../channel/types";
import { getRootChatIdNumber, parseChannelAddress } from "../../channel/id";
import { TelegramFormatter } from "./telegram-formatter";
import { escapeHtml, chunkText } from "./formatter";
import { stripAnsi } from "../../utils/ansi";
import { logger } from "../../daemon/logger";
import { paths, ensureDirs } from "../../config/paths";
import { join } from "path";
import { chmod, open, readFile, readdir, stat, unlink } from "fs/promises";
import { createHash } from "crypto";
import type { FileHandle } from "fs/promises";

function toChatId(channelName: string, num: number, threadId?: number): ChannelChatId {
  if (channelName === "telegram") {
    if (threadId && threadId !== 1) return `telegram:${num}:${threadId}`;
    return `telegram:${num}`;
  }
  if (threadId && threadId !== 1) return `telegram:${channelName}:${num}:${threadId}`;
  return `telegram:${channelName}:${num}`;
}

function toUserId(channelName: string, userId: number): string {
  if (channelName === "telegram") return `telegram:${userId}`;
  return `telegram:${channelName}:${userId}`;
}

function fromChatId(chatId: ChannelChatId): { chatId: number; threadId?: number } {
  const parsed = parseChannelAddress(chatId);
  const numChatId = Number(parsed.idPart);
  if (parsed.threadPart !== undefined) {
    return { chatId: numChatId, threadId: Number(parsed.threadPart) };
  }
  return { chatId: numChatId };
}

function actionPollId(): string {
  return `tgp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function actionCallbackData(pollId: string, optionId: number): string {
  return `tgp:${pollId}:${optionId}`;
}

function parseActionCallbackData(data: string | undefined): { pollId: string; optionId: number } | null {
  if (!data) return null;
  const match = data.match(/^tgp:([^:]+):(\d+)$/);
  if (!match) return null;
  const optionId = Number(match[2]);
  if (!Number.isFinite(optionId) || optionId < 0) return null;
  return { pollId: match[1], optionId };
}

interface TelegramBotCommand {
  command: string;
  description: string;
}

const TELEGRAM_COMMANDS = {
  files: { command: "files", description: "Pick repo paths for next message" },
  session: { command: "session", description: "Show current session and resume command" },
  resume: { command: "resume", description: "Pick and resume a previous session" },
  outputMode: { command: "output_mode", description: "Set output mode simple/verbose" },
  thinking: { command: "thinking", description: "Toggle thinking on/off" },
  backgroundJobs: { command: "background_jobs", description: "List running background jobs" },
  skills: { command: "skills", description: "List available agent skills" },
  link: { command: "link", description: "Add this chat as a channel" },
  unlink: { command: "unlink", description: "Remove this chat as a channel" },
  pair: { command: "pair", description: "Pair with code: /pair <code>" },
} as const satisfies Record<string, TelegramBotCommand>;

function parseNumericChannelId(id: string): number | null {
  return getRootChatIdNumber(id);
}

function buildCommandMenu(
  ctx: Pick<CommandMenuContext, "isPaired" | "isGroup" | "isLinkedGroup" | "hasActiveSession">
): TelegramBotCommand[] {
  if (!ctx.isPaired) return [TELEGRAM_COMMANDS.pair];

  if (ctx.isGroup && !ctx.isLinkedGroup) {
    return [TELEGRAM_COMMANDS.link];
  }

  const commands: TelegramBotCommand[] = [];
  if (ctx.hasActiveSession) {
    commands.push(
      TELEGRAM_COMMANDS.session,
      TELEGRAM_COMMANDS.files,
      TELEGRAM_COMMANDS.resume,
      TELEGRAM_COMMANDS.outputMode,
      TELEGRAM_COMMANDS.thinking,
      TELEGRAM_COMMANDS.backgroundJobs,
      TELEGRAM_COMMANDS.skills
    );
  }
  if (ctx.isGroup) {
    // Always show both link and unlink for groups — Telegram command menus are
    // scoped at the group level, not per-topic, so different topics may have
    // different linked states and users need access to both commands.
    commands.push(TELEGRAM_COMMANDS.link, TELEGRAM_COMMANDS.unlink);
  }
  return commands;
}

export const __telegramChannelTestUtils = {
  buildCommandMenu,
};

export class TelegramChannel implements Channel {
  readonly type = "telegram";
  readonly fmt = new TelegramFormatter();
  private readonly channelName: string;
  private api: TelegramApi;
  private running = false;
  private botUsername: string | null = null;
  // Track last message per chat for in-place editing
  private lastMessage: Map<string, { messageId: number; text: string }> = new Map();
  private typingTimers: Map<ChannelChatId, { interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> }> = new Map();
  private readonly uploadTtlMs = 24 * 60 * 60 * 1000;
  // Cache forum topic names: key = "chatId:threadId", value = topic name
  private topicNames: Map<string, string> = new Map();
  private actionPollById: Map<string, { chatId: ChannelChatId; messageId: number }> = new Map();
  private actionPollByMessage: Map<string, string> = new Map();
  private statusBoards: Map<string, { messageId: number; pinned: boolean; html?: string }> = new Map();
  private commandMenuCache: Map<string, string> = new Map();
  private readonly tokenFingerprint: string;
  private pollerLock: { handle: FileHandle; path: string } | null = null;
  onPollAnswer: PollAnswerHandler | null = null;
  onDeadChat: ((chatId: ChannelChatId, error: Error) => void) | null = null;

  constructor(botToken: string, channelName = "telegram") {
    this.api = new TelegramApi(botToken);
    this.channelName = channelName;
    this.tokenFingerprint = createHash("sha256").update(botToken).digest("hex").slice(0, 24);
  }

  private isDeadChatError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return (
      lower.includes("chat not found") ||
      lower.includes("bot was blocked") ||
      lower.includes("forbidden") ||
      lower.includes("group chat was deactivated") ||
      lower.includes("bot was kicked") ||
      lower.includes("chat_write_forbidden") ||
      lower.includes("not enough rights")
    );
  }

  setTyping(chatId: ChannelChatId, active: boolean): void {
    if (active) {
      // Already typing for this chat
      if (this.typingTimers.has(chatId)) return;
      const { chatId: numChatId, threadId } = fromChatId(chatId);
      // Send immediately, then repeat every 4.5s (Telegram expires after 5s)
      this.api.sendChatAction(numChatId, "typing", threadId).catch(() => {});
      const interval = setInterval(() => {
        this.api.sendChatAction(numChatId, "typing", threadId).catch(() => {});
      }, 4500);
      // Auto-clear after 2 minutes to prevent stuck typing indicators
      const timeout = setTimeout(() => this.setTyping(chatId, false), 120_000);
      this.typingTimers.set(chatId, { interval, timeout });
    } else {
      const entry = this.typingTimers.get(chatId);
      if (entry) {
        clearInterval(entry.interval);
        clearTimeout(entry.timeout);
        this.typingTimers.delete(chatId);
      }
    }
  }

  async send(chatId: ChannelChatId, html: string): Promise<void> {
    this.setTyping(chatId, false);
    const { chatId: numChatId, threadId } = fromChatId(chatId);
    try {
      await this.api.sendMessage(numChatId, html, "HTML", threadId);
      this.lastMessage.delete(chatId);
    } catch (e) {
      const err = e as Error;
      await logger.error("Failed to send message", { chatId, error: err.message });
      if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
    }
  }

  async sendOutput(chatId: ChannelChatId, rawOutput: string): Promise<void> {
    this.setTyping(chatId, false);
    const { chatId: numChatId, threadId } = fromChatId(chatId);
    const clean = stripAnsi(rawOutput);
    if (!clean.trim()) return;

    const escaped = escapeHtml(clean);
    const chunks = chunkText(escaped);

    for (const chunk of chunks) {
      const html = `<pre>${chunk}</pre>`;

      // Try to edit last message if it was recent output
      const last = this.lastMessage.get(chatId);
      if (last && chunks.length === 1) {
        const combined = last.text + chunk;
        if (combined.length < 4000) {
          try {
            await this.api.editMessageText(
              numChatId,
              last.messageId,
              `<pre>${combined}</pre>`,
              "HTML",
              threadId
            );
            this.lastMessage.set(chatId, {
              messageId: last.messageId,
              text: combined,
            });
            return;
          } catch {
            // Edit failed (e.g. message too old), send new message
          }
        }
      }

      try {
        const sent = await this.api.sendMessage(numChatId, html, "HTML", threadId);
        this.lastMessage.set(chatId, {
          messageId: sent.message_id,
          text: chunk,
        });
      } catch (e) {
        const err = e as Error;
        await logger.error("Failed to send output", { chatId, error: err.message });
        if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
      }
    }
  }

  async sendDocument(chatId: ChannelChatId, filePath: string, caption?: string): Promise<void> {
    const { chatId: numChatId, threadId } = fromChatId(chatId);
    try {
      await this.api.sendDocument(numChatId, filePath, caption, threadId);
    } catch (e) {
      const err = e as Error;
      await logger.error("Failed to send document", { chatId, filePath, error: err.message });
      if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
    }
  }

  async validateChat(chatId: ChannelChatId): Promise<boolean> {
    const { chatId: numChatId } = fromChatId(chatId);
    try {
      await this.api.getChat(numChatId);
      return true;
    } catch {
      return false;
    }
  }

  clearLastMessage(chatId: ChannelChatId): void {
    this.lastMessage.delete(chatId);
  }

  async sendPoll(
    chatId: ChannelChatId,
    question: string,
    options: string[],
    multiSelect: boolean
  ): Promise<PollResult> {
    const { chatId: numChatId, threadId } = fromChatId(chatId);
    if (!multiSelect) {
      const id = actionPollId();
      const inlineButtons: TelegramInlineKeyboardButton[][] = options.slice(0, 10).map((label, idx) => [
        { text: label.slice(0, 64), callback_data: actionCallbackData(id, idx) },
      ]);
      const sent = await this.api.sendInlineKeyboard(
        numChatId,
        this.fmt.bold(this.fmt.escape(question)),
        inlineButtons,
        threadId
      );
      this.actionPollById.set(id, { chatId, messageId: sent.message_id });
      this.actionPollByMessage.set(`${chatId}:${sent.message_id}`, id);
      return { pollId: id, messageId: String(sent.message_id) };
    }
    const sent = await this.api.sendPoll(numChatId, question, options, multiSelect, false, threadId);
    // Telegram includes poll info in the sent message
    const poll = (sent as unknown as { poll?: { id: string } }).poll;
    return { pollId: poll?.id ?? "", messageId: String(sent.message_id) };
  }

  async closePoll(chatId: ChannelChatId, messageId: string): Promise<void> {
    const actionId = this.actionPollByMessage.get(`${chatId}:${messageId}`);
    if (actionId) {
      this.actionPollByMessage.delete(`${chatId}:${messageId}`);
      this.actionPollById.delete(actionId);
      const { chatId: numChatId } = fromChatId(chatId);
      try {
        await this.api.editMessageReplyMarkup(numChatId, Number(messageId), { inline_keyboard: [] });
      } catch {
        // Ignore if message is no longer editable.
      }
      return;
    }
    const { chatId: numChatId } = fromChatId(chatId);
    try {
      await this.api.stopPoll(numChatId, Number(messageId));
    } catch {
      // Poll may already be closed
    }
  }

  private statusBoardMapKey(chatId: ChannelChatId, boardKey: string): string {
    return `${chatId}::${boardKey}`;
  }

  private isMessageNotModifiedError(error: unknown): boolean {
    const text = (error as Error | undefined)?.message?.toLowerCase?.() || "";
    return text.includes("message is not modified");
  }

  async upsertStatusBoard(
    chatId: ChannelChatId,
    boardKey: string,
    html: string,
    options?: StatusBoardOptions
  ): Promise<StatusBoardResult | void> {
    const key = this.statusBoardMapKey(chatId, boardKey);
    const explicitMessageId = options?.messageId ? Number(options.messageId) : null;
    const existing = this.statusBoards.get(key)
      || (explicitMessageId && Number.isFinite(explicitMessageId)
        ? { messageId: explicitMessageId, pinned: options?.pinned === true }
        : undefined);
    const { chatId: numChatId, threadId } = fromChatId(chatId);

    let messageId = existing?.messageId ?? null;
    let pinned = existing?.pinned ?? options?.pinned ?? false;
    let lastHtml = existing?.html;
    let pinError: string | undefined;

    if (messageId) {
      if (lastHtml === html) {
        this.statusBoards.set(key, { messageId, pinned, html });
        return { messageId: String(messageId), pinned };
      }
      try {
        await this.api.editMessageText(numChatId, messageId, html, "HTML", threadId);
        lastHtml = html;
      } catch (e) {
        if (this.isMessageNotModifiedError(e)) {
          lastHtml = html;
          this.statusBoards.set(key, { messageId, pinned, html: lastHtml });
          return { messageId: String(messageId), pinned };
        }
        // Older Telegram messages can become non-editable; send a fresh status board.
        try {
          const sent = await this.api.sendMessage(numChatId, html, "HTML", threadId);
          if (existing?.pinned) {
            await this.api.unpinChatMessage(numChatId, existing.messageId).catch(() => {});
            pinned = false;
          }
          messageId = sent.message_id;
          lastHtml = html;
        } catch (e) {
          const err = e as Error;
          await logger.error("Failed to upsert status board", { chatId, boardKey, error: err.message });
          if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
          return;
        }
      }
    } else {
      try {
        const sent = await this.api.sendMessage(numChatId, html, "HTML", threadId);
        messageId = sent.message_id;
        lastHtml = html;
      } catch (e) {
        const err = e as Error;
        await logger.error("Failed to send status board", { chatId, boardKey, error: err.message });
        if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
        return;
      }
    }

    if (options?.pin && !pinned && messageId) {
      try {
        await this.api.pinChatMessage(numChatId, messageId, true);
        pinned = true;
      } catch (e) {
        // Pin is optional; keep board updates working even without pin permission.
        pinError = (e as Error).message || "Failed to pin status board";
      }
    }

    if (messageId) {
      this.statusBoards.set(key, { messageId, pinned, html: lastHtml });
      return { messageId: String(messageId), pinned, pinError };
    }
  }

  async clearStatusBoard(
    chatId: ChannelChatId,
    boardKey: string,
    options?: ClearStatusBoardOptions
  ): Promise<StatusBoardResult | void> {
    const key = this.statusBoardMapKey(chatId, boardKey);
    const explicitMessageId = options?.messageId ? Number(options.messageId) : null;
    const existing = this.statusBoards.get(key)
      || (explicitMessageId && Number.isFinite(explicitMessageId)
        ? { messageId: explicitMessageId, pinned: options?.pinned === true }
        : undefined);
    if (!existing) return;
    this.statusBoards.delete(key);

    if (options?.unpin && existing.pinned) {
      const { chatId: numChatId } = fromChatId(chatId);
      try {
        await this.api.unpinChatMessage(numChatId, existing.messageId);
      } catch {
        // Ignore unpin failures (message may already be unpinned/deleted).
      }
    }
    return { messageId: String(existing.messageId), pinned: false };
  }

  // Strip @BotUsername from text (Telegram adds this in groups)
  private stripBotMention(text: string): string {
    if (!this.botUsername) return text;
    const mention = `@${this.botUsername}`;
    // Strip from commands: "/pair@BotName code" → "/pair code"
    // Strip from start of message: "@BotName hello" → "hello"
    let result = text.replace(new RegExp(`@${this.botUsername}\\b`, "gi"), "").trim();
    // Clean up double spaces left behind
    result = result.replace(/  +/g, " ");
    return result;
  }

  private async cleanupOldUploads(): Promise<void> {
    const now = Date.now();
    try {
      await ensureDirs();
      const files = await readdir(paths.uploadsDir);
      for (const fileName of files) {
        const fullPath = join(paths.uploadsDir, fileName);
        try {
          const fileStat = await stat(fullPath);
          if (!fileStat.isFile()) continue;
          if (now - fileStat.mtimeMs > this.uploadTtlMs) {
            await unlink(fullPath);
          } else {
            await chmod(fullPath, 0o600).catch(() => {});
          }
        } catch {
          // Ignore files that disappeared between readdir/stat
        }
      }
    } catch {
      // Ignore cleanup failures
    }
  }

  private pollerLockPath(): string {
    return join(paths.dir, `telegram-poller-${this.tokenFingerprint}.lock`);
  }

  private isProcessRunning(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async acquirePollerLock(): Promise<void> {
    if (this.pollerLock) return;
    await ensureDirs();
    const lockPath = this.pollerLockPath();
    const acquire = async (): Promise<boolean> => {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(`${process.pid}\n`);
        await handle.sync().catch(() => {});
        this.pollerLock = { handle, path: lockPath };
        return true;
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== "EEXIST") throw e;
        return false;
      }
    };

    if (await acquire()) return;

    try {
      const raw = await readFile(lockPath, "utf-8");
      const existingPid = parseInt(raw.trim(), 10);
      if (!this.isProcessRunning(existingPid)) {
        await unlink(lockPath).catch(() => {});
      }
    } catch {
      await unlink(lockPath).catch(() => {});
    }

    if (await acquire()) return;

    const holderText = await readFile(lockPath, "utf-8").catch(() => "");
    const holderPid = Number.parseInt(holderText.trim(), 10);
    const pidHint = Number.isFinite(holderPid) && holderPid > 0 ? ` (pid ${holderPid})` : "";
    throw new Error(`Telegram polling lock is already held${pidHint}.`);
  }

  private async releasePollerLock(): Promise<void> {
    const lock = this.pollerLock;
    this.pollerLock = null;
    if (!lock) return;
    try {
      await lock.handle.close();
    } catch {}
    await unlink(lock.path).catch(() => {});
  }

  private isPollingConflictError(error: unknown): boolean {
    const msg = (error as Error)?.message || String(error);
    const lower = msg.toLowerCase();
    if (!lower.includes("getupdates")) return false;
    return (
      lower.includes("(409)")
      || lower.includes("error_code\":409")
      || lower.includes("terminated by other getupdates request")
    );
  }

  async syncCommandMenu(ctx: CommandMenuContext): Promise<void> {
    const userNum = parseNumericChannelId(ctx.userId);
    if (!userNum) return;
    const { chatId: numChatId } = fromChatId(ctx.chatId);
    const commands = buildCommandMenu(ctx);
    const signature = commands.map((cmd) => cmd.command).join(",");
    const cacheKey = `${numChatId}:${userNum}`;
    if (this.commandMenuCache.get(cacheKey) === signature) return;

    // Telegram does not allow `chat_member` scopes for private chats.
    // Use a per-chat scope for DMs and a chat_member scope for groups/topics.
    const scope: TelegramBotCommandScope = numChatId > 0
      ? {
          type: "chat",
          chat_id: numChatId,
        }
      : {
          type: "chat_member",
          chat_id: numChatId,
          user_id: userNum,
        };

    try {
      await this.api.setMyCommands(commands, scope, 5000);
      this.commandMenuCache.set(cacheKey, signature);
    } catch (e) {
      await logger.debug("Failed to sync Telegram command menu", {
        chatId: ctx.chatId,
        userId: ctx.userId,
        error: (e as Error).message,
      });
    }
  }

  async startReceiving(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    await this.acquirePollerLock();
    try {
      // Validate bot and register commands
      try {
        await this.cleanupOldUploads();
        const me = await this.api.getMe();
        this.botUsername = me.username || null;
        await logger.info("Bot connected", { username: me.username, id: me.id });
      } catch (e) {
        await logger.error("Failed to connect to Telegram", { error: (e as Error).message });
        throw e;
      }
      try {
        // Clear broad command scopes from older versions so chat_member menus control visibility.
        await this.api.setMyCommands([], { type: "all_private_chats" }, 5000);
        await this.api.setMyCommands([], { type: "all_group_chats" }, 5000);
        await this.api.setMyCommands([], { type: "all_chat_administrators" }, 5000);
        await this.api.setMyCommands([TELEGRAM_COMMANDS.pair], undefined, 5000);
      } catch (e) {
        await logger.debug("Failed to initialize Telegram command menus", {
          error: (e as Error).message,
        });
      }

      this.running = true;
      let offset: number | undefined;

      while (this.running) {
        try {
          const updates = await this.api.getUpdates(offset, 30);

          for (const update of updates) {
            offset = update.update_id + 1;

            if (update.poll_answer && this.onPollAnswer) {
              try {
                const pa = update.poll_answer;
                this.onPollAnswer({
                  pollId: pa.poll_id,
                  userId: toUserId(this.channelName, pa.user.id),
                  optionIds: pa.option_ids,
                });
              } catch (e) {
                await logger.error("Error handling poll answer", { error: (e as Error).message });
              }
            }

            if (update.callback_query) {
              try {
                const parsed = parseActionCallbackData(update.callback_query.data);
                if (parsed && this.onPollAnswer) {
                  const action = this.actionPollById.get(parsed.pollId);
                  if (action) {
                    this.actionPollById.delete(parsed.pollId);
                    this.actionPollByMessage.delete(`${action.chatId}:${action.messageId}`);
                  }
                  this.onPollAnswer({
                    pollId: parsed.pollId,
                    userId: toUserId(this.channelName, update.callback_query.from.id),
                    optionIds: [parsed.optionId],
                  });
                }
                await this.api.answerCallbackQuery(update.callback_query.id);
              } catch (e) {
                await logger.error("Error handling callback query", { error: (e as Error).message });
              }
            }

            if (update.message) {
              try {
                const msg = update.message;
                const isGroup = msg.chat.type !== "private";

                // Cache forum topic names from service messages
                if (msg.message_thread_id) {
                  const key = `${msg.chat.id}:${msg.message_thread_id}`;
                  // Edited name always wins (most recent)
                  if (msg.forum_topic_edited?.name) {
                    this.topicNames.set(key, msg.forum_topic_edited.name);
                  } else if (msg.forum_topic_created) {
                    this.topicNames.set(key, msg.forum_topic_created.name);
                  } else if (msg.reply_to_message?.forum_topic_created && !this.topicNames.has(key)) {
                    // Only use creation message from reply chain as fallback (it has the original name, not renamed)
                    this.topicNames.set(key, msg.reply_to_message.forum_topic_created.name);
                  }
                }

                // Download photos/documents to local disk and use file paths
                let text = msg.text?.trim() || "";
                const fileUrls: string[] = [];

                // Determine file_id to download: photos or documents (files sent uncompressed)
                let downloadFileId: string | null = null;
                let downloadFileExt = "jpg";
                if (msg.photo && msg.photo.length > 0) {
                  const largest = msg.photo[msg.photo.length - 1];
                  downloadFileId = largest.file_id;
                } else if (msg.document) {
                  downloadFileId = msg.document.file_id;
                  const name = msg.document.file_name || "";
                  const dotIdx = name.lastIndexOf(".");
                  if (dotIdx > 0) downloadFileExt = name.slice(dotIdx + 1);
                }

                if (downloadFileId) {
                  try {
                    const file = await this.api.getFile(downloadFileId);
                    if (file.file_path) {
                      const url = this.api.getFileUrl(file.file_path);
                      const ext = file.file_path.split(".").pop() || downloadFileExt;
                      const fileName = `${Date.now()}-${file.file_unique_id}.${ext}`;
                      await ensureDirs();
                      const localPath = join(paths.uploadsDir, fileName);
                      const res = await fetch(url);
                      if (res.ok) {
                        const buffer = await res.arrayBuffer();
                        await Bun.write(localPath, buffer);
                        await chmod(localPath, 0o600).catch(() => {});
                        fileUrls.push(localPath);
                        const caption = msg.caption?.trim() || "";
                        text = caption
                          ? `${caption} ${localPath}`
                          : localPath;
                      } else {
                        await logger.error("Failed to download file", { status: res.status });
                      }
                    }
                  } catch (e) {
                    await logger.error("Failed to resolve file", { error: (e as Error).message });
                  }
                }

                // Extract reply/quote context from replied-to message
                const reply = msg.reply_to_message;
                if (reply && !reply.forum_topic_created) {
                  const quoteLines: string[] = [];

                  // Download photo/document from the quoted message
                  let replyFileId: string | null = null;
                  let replyFileExt = "jpg";
                  if (reply.photo && reply.photo.length > 0) {
                    replyFileId = reply.photo[reply.photo.length - 1].file_id;
                  } else if (reply.document) {
                    replyFileId = reply.document.file_id;
                    const name = reply.document.file_name || "";
                    const dotIdx = name.lastIndexOf(".");
                    if (dotIdx > 0) replyFileExt = name.slice(dotIdx + 1);
                  }

                  if (replyFileId) {
                    try {
                      const file = await this.api.getFile(replyFileId);
                      if (file.file_path) {
                        const url = this.api.getFileUrl(file.file_path);
                        const ext = file.file_path.split(".").pop() || replyFileExt;
                        const fileName = `${Date.now()}-${file.file_unique_id}.${ext}`;
                        await ensureDirs();
                        const localPath = join(paths.uploadsDir, fileName);
                        const res = await fetch(url);
                        if (res.ok) {
                          const buffer = await res.arrayBuffer();
                          await Bun.write(localPath, buffer);
                          await chmod(localPath, 0o600).catch(() => {});
                          fileUrls.push(localPath);
                          quoteLines.push(`> [image: ${localPath}]`);
                        }
                      }
                    } catch (e) {
                      await logger.error("Failed to download reply file", { error: (e as Error).message });
                    }
                  }

                  // Extract text/caption from the quoted message
                  const replyText = (reply.text || reply.caption || "").trim();
                  if (replyText) {
                    for (const line of replyText.split("\n")) {
                      quoteLines.push(`> ${line}`);
                    }
                  }

                  if (quoteLines.length > 0) {
                    const quoteBlock = quoteLines.join("\n");
                    text = text ? `${quoteBlock}\n\n${text}` : quoteBlock;
                  }
                }

                if (!text || !msg.from) continue;

                // Strip @BotUsername mentions (common in groups)
                text = this.stripBotMention(text);
                if (!text) continue;

                // Resolve topic title from cache
                const topicTitle = msg.message_thread_id && msg.message_thread_id !== 1
                  ? this.topicNames.get(`${msg.chat.id}:${msg.message_thread_id}`)
                  : undefined;

                const inbound: InboundMessage = {
                  userId: toUserId(this.channelName, msg.from.id),
                  chatId: toChatId(this.channelName, msg.chat.id, msg.message_thread_id),
                  username: msg.from.username,
                  text,
                  fileUrls: fileUrls.length > 0 ? fileUrls : undefined,
                  isGroup,
                  chatTitle: isGroup ? msg.chat.title : undefined,
                  topicTitle,
                };

                await onMessage(inbound);
              } catch (e) {
                await logger.error("Error handling message", { error: (e as Error).message });
              }
            }
          }
        } catch (e) {
          if (this.isPollingConflictError(e)) {
            await logger.error("Telegram polling conflict; stopping receiver", { error: (e as Error).message });
            this.running = false;
            break;
          }
          await logger.error("Polling error", { error: (e as Error).message });
          if (this.running) await Bun.sleep(5000);
        }
      }
    } finally {
      this.running = false;
      await this.releasePollerLock();
    }
  }

  async getBotName(): Promise<string> {
    const me = await this.api.getMe();
    return me.first_name || me.username || "Bot";
  }

  stopReceiving(): void {
    this.running = false;
  }
}
