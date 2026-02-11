import { TelegramApi, type TelegramUpdate } from "./api";
import type { Channel, ChannelChatId, InboundMessage } from "../../channel/types";
import { escapeHtml, chunkText } from "./formatter";
import { stripAnsi } from "../../utils/ansi";
import { logger } from "../../daemon/logger";

function toChatId(num: number): ChannelChatId {
  return `telegram:${num}`;
}

function fromChatId(chatId: ChannelChatId): number {
  return Number(chatId.split(":")[1]);
}

export class TelegramChannel implements Channel {
  readonly type = "telegram";
  private api: TelegramApi;
  private running = false;
  private botUsername: string | null = null;
  // Track last message per chat for in-place editing
  private lastMessage: Map<string, { messageId: number; text: string }> = new Map();
  onMessageSent: ((messageRef: string, sessionId: string) => void) | null = null;

  constructor(botToken: string) {
    this.api = new TelegramApi(botToken);
  }

  async send(chatId: ChannelChatId, html: string, sessionId?: string): Promise<void> {
    const numChatId = fromChatId(chatId);
    try {
      const sent = await this.api.sendMessage(numChatId, html);
      this.lastMessage.delete(chatId);
      if (sessionId && this.onMessageSent) {
        this.onMessageSent(`telegram:${sent.message_id}`, sessionId);
      }
    } catch (e) {
      await logger.error("Failed to send message", { chatId, error: (e as Error).message });
    }
  }

  async sendOutput(chatId: ChannelChatId, rawOutput: string, sessionId?: string): Promise<void> {
    const numChatId = fromChatId(chatId);
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
              `<pre>${combined}</pre>`
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
        const sent = await this.api.sendMessage(numChatId, html);
        this.lastMessage.set(chatId, {
          messageId: sent.message_id,
          text: chunk,
        });
        if (sessionId && this.onMessageSent) {
          this.onMessageSent(`telegram:${sent.message_id}`, sessionId);
        }
      } catch (e) {
        await logger.error("Failed to send output", { chatId, error: (e as Error).message });
      }
    }
  }

  async sendSessionExit(chatId: ChannelChatId, sessionId: string, exitCode: number | null): Promise<void> {
    const status = exitCode === 0 ? "exited" : `exited with code ${exitCode ?? "unknown"}`;
    await this.send(chatId, `Session <code>${sessionId}</code> ${status}.`);
    this.lastMessage.delete(chatId);
  }

  clearLastMessage(chatId: ChannelChatId): void {
    this.lastMessage.delete(chatId);
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

  async startReceiving(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    // Validate bot and register commands
    try {
      const me = await this.api.getMe();
      this.botUsername = me.username || null;
      await logger.info("Bot connected", { username: me.username, id: me.id });
      await this.api.setMyCommands([
        { command: "sessions", description: "List active sessions" },
        { command: "connect", description: "Connect to session: /connect <id>" },
        { command: "disconnect", description: "Disconnect from session" },
        { command: "send", description: "Message a session: /send <id> <text>" },
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
          if (update.message) {
            try {
              const msg = update.message;
              const isGroup = msg.chat.type !== "private";

              // Resolve photos to URLs
              let text = msg.text?.trim() || "";
              const fileUrls: string[] = [];
              if (msg.photo && msg.photo.length > 0) {
                try {
                  const largest = msg.photo[msg.photo.length - 1];
                  const file = await this.api.getFile(largest.file_id);
                  if (file.file_path) {
                    const url = this.api.getFileUrl(file.file_path);
                    fileUrls.push(url);
                    const caption = msg.caption?.trim() || "";
                    text = caption ? `${caption} ${url}` : url;
                  }
                } catch (e) {
                  await logger.error("Failed to resolve photo", { error: (e as Error).message });
                }
              }

              if (!text || !msg.from) continue;

              // Strip @BotUsername mentions (common in groups)
              text = this.stripBotMention(text);
              if (!text) continue;

              // Build reply-to ref
              let replyToRef: string | undefined;
              if (msg.reply_to_message) {
                replyToRef = `telegram:${msg.reply_to_message.message_id}`;
              }

              const inbound: InboundMessage = {
                userId: `telegram:${msg.from.id}`,
                chatId: toChatId(msg.chat.id),
                username: msg.from.username,
                text,
                replyToRef,
                fileUrls: fileUrls.length > 0 ? fileUrls : undefined,
                isGroup,
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
