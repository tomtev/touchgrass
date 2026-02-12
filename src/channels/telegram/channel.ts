import { TelegramApi, type TelegramUpdate, type TelegramPollAnswer } from "./api";
import type { Channel, ChannelChatId, InboundMessage } from "../../channel/types";
import { escapeHtml, chunkText } from "./formatter";
import { stripAnsi } from "../../utils/ansi";
import { logger } from "../../daemon/logger";
import { paths, ensureDirs } from "../../config/paths";
import { join } from "path";
import { chmod, readdir, stat, unlink } from "fs/promises";

function toChatId(num: number, threadId?: number): ChannelChatId {
  if (threadId && threadId !== 1) return `telegram:${num}:${threadId}`;
  return `telegram:${num}`;
}

function fromChatId(chatId: ChannelChatId): { chatId: number; threadId?: number } {
  const parts = chatId.split(":");
  const numChatId = Number(parts[1]);
  if (parts.length >= 3) {
    return { chatId: numChatId, threadId: Number(parts[2]) };
  }
  return { chatId: numChatId };
}

export class TelegramChannel implements Channel {
  readonly type = "telegram";
  private api: TelegramApi;
  private running = false;
  private botUsername: string | null = null;
  // Track last message per chat for in-place editing
  private lastMessage: Map<string, { messageId: number; text: string }> = new Map();
  private typingTimers: Map<ChannelChatId, { interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> }> = new Map();
  private readonly uploadTtlMs = 24 * 60 * 60 * 1000;
  // Cache forum topic names: key = "chatId:threadId", value = topic name
  private topicNames: Map<string, string> = new Map();
  onPollAnswer: ((answer: TelegramPollAnswer) => void) | null = null;

  constructor(botToken: string) {
    this.api = new TelegramApi(botToken);
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
      await logger.error("Failed to send message", { chatId, error: (e as Error).message });
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
        await logger.error("Failed to send output", { chatId, error: (e as Error).message });
      }
    }
  }

  async sendDocument(chatId: ChannelChatId, filePath: string, caption?: string): Promise<void> {
    const { chatId: numChatId, threadId } = fromChatId(chatId);
    try {
      await this.api.sendDocument(numChatId, filePath, caption, threadId);
    } catch (e) {
      await logger.error("Failed to send document", { chatId, filePath, error: (e as Error).message });
    }
  }

  async sendSessionExit(chatId: ChannelChatId, sessionId: string, exitCode: number | null): Promise<void> {
    const status = exitCode === 0 ? "disconnected" : `disconnected (code ${exitCode ?? "unknown"})`;
    await this.send(chatId, `Session <code>${escapeHtml(sessionId)}</code> ${escapeHtml(status)}.`);
    this.lastMessage.delete(chatId);
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
  ): Promise<{ pollId: string; messageId: number }> {
    const { chatId: numChatId, threadId } = fromChatId(chatId);
    const sent = await this.api.sendPoll(numChatId, question, options, multiSelect, false, threadId);
    // Telegram includes poll info in the sent message
    const poll = (sent as unknown as { poll?: { id: string } }).poll;
    return { pollId: poll?.id ?? "", messageId: sent.message_id };
  }

  async closePoll(chatId: ChannelChatId, messageId: number): Promise<void> {
    const { chatId: numChatId } = fromChatId(chatId);
    try {
      await this.api.stopPoll(numChatId, messageId);
    } catch {
      // Poll may already be closed
    }
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

  async startReceiving(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    // Validate bot and register commands
    try {
      await this.cleanupOldUploads();
      const me = await this.api.getMe();
      this.botUsername = me.username || null;
      await logger.info("Bot connected", { username: me.username, id: me.id });
      await this.api.setMyCommands([
        { command: "sessions", description: "List active sessions" },
        { command: "subscribe", description: "Subscribe to session: /subscribe <id>" },
        { command: "unsubscribe", description: "Unsubscribe from session" },
        { command: "link", description: "Register this group/topic with the bot" },
        { command: "unlink", description: "Unregister this group/topic" },
        { command: "help", description: "Show help" },
        { command: "pair", description: "Pair with code: /pair <code>" },
      ]);
    } catch (e) {
      await logger.error("Failed to connect to Telegram", { error: (e as Error).message });
      throw e;
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
              this.onPollAnswer(update.poll_answer);
            } catch (e) {
              await logger.error("Error handling poll answer", { error: (e as Error).message });
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

              if (!text || !msg.from) continue;

              // Strip @BotUsername mentions (common in groups)
              text = this.stripBotMention(text);
              if (!text) continue;

              // Resolve topic title from cache
              const topicTitle = msg.message_thread_id && msg.message_thread_id !== 1
                ? this.topicNames.get(`${msg.chat.id}:${msg.message_thread_id}`)
                : undefined;

              const inbound: InboundMessage = {
                userId: `telegram:${msg.from.id}`,
                chatId: toChatId(msg.chat.id, msg.message_thread_id),
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
        await logger.error("Polling error", { error: (e as Error).message });
        if (this.running) await Bun.sleep(5000);
      }
    }
  }

  stopReceiving(): void {
    this.running = false;
  }
}
