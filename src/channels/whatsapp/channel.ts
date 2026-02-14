import type { Channel, ChannelChatId, InboundMessage, PollAnswerHandler } from "../../channel/types";
import { WhatsAppFormatter } from "./whatsapp-formatter";
import { stripAnsi } from "../../utils/ansi";
import { logger } from "../../daemon/logger";
import { ensureDirs, paths } from "../../config/paths";
import { join, basename, extname } from "path";
import { chmod, readdir, stat, unlink } from "fs/promises";
import {
  chatIdToJid,
  isWhatsAppGroupJid,
  jidToChannelChatId,
  jidToChannelUserId,
} from "./normalize";
import {
  closeWhatsAppSocket,
  createWhatsAppSocket,
  defaultWhatsAppAuthDir,
  getDisconnectStatus,
  getSocketSelfId,
  hasWhatsAppCredentials,
} from "./auth";

const WHATSAPP_MAX_TEXT = 3900;

interface WhatsAppPollState {
  pollId: string;
  messageId: string;
  optionCount: number;
  multiSelect: boolean;
  optionLabels: string[];
}

function chunkText(text: string, maxLen = WHATSAPP_MAX_TEXT): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxLen, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > i) end = newline + 1;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

function guessMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

function whatsappPollId(): string {
  return `wa-poll-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function parseWhatsAppPollAnswer(text: string, poll: WhatsAppPollState): number[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const byLabel = poll.optionLabels.findIndex((label) => label.toLowerCase() === trimmed.toLowerCase());
  if (byLabel >= 0) return [byLabel];

  if (!/^\d+(?:[\s,]+\d+)*$/.test(trimmed)) return null;
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const token of trimmed.split(/[\s,]+/)) {
    const n = Number(token);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    if (n < 1 || n > poll.optionCount) return null;
    const zero = n - 1;
    if (!seen.has(zero)) {
      seen.add(zero);
      ids.push(zero);
    }
  }
  if (!poll.multiSelect && ids.length > 1) {
    return [ids[0]];
  }
  return ids;
}

function resolveMessageContent(message: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!message) return undefined;
  let current = message;
  for (let i = 0; i < 4; i++) {
    const ephemeral = current.ephemeralMessage as { message?: Record<string, unknown> } | undefined;
    if (ephemeral?.message) {
      current = ephemeral.message;
      continue;
    }
    const viewOnce = current.viewOnceMessage as { message?: Record<string, unknown> } | undefined;
    if (viewOnce?.message) {
      current = viewOnce.message;
      continue;
    }
    const viewOnceV2 = current.viewOnceMessageV2 as { message?: Record<string, unknown> } | undefined;
    if (viewOnceV2?.message) {
      current = viewOnceV2.message;
      continue;
    }
    break;
  }
  return current;
}

function extractMessageText(content: Record<string, unknown> | undefined): string {
  if (!content) return "";
  const conversation = content.conversation as string | undefined;
  if (conversation?.trim()) return conversation.trim();

  const extended = content.extendedTextMessage as { text?: string } | undefined;
  if (extended?.text?.trim()) return extended.text.trim();

  const image = content.imageMessage as { caption?: string } | undefined;
  if (image?.caption?.trim()) return image.caption.trim();

  const video = content.videoMessage as { caption?: string } | undefined;
  if (video?.caption?.trim()) return video.caption.trim();

  const document = content.documentMessage as { caption?: string } | undefined;
  if (document?.caption?.trim()) return document.caption.trim();

  const button = content.buttonsResponseMessage as { selectedDisplayText?: string } | undefined;
  if (button?.selectedDisplayText?.trim()) return button.selectedDisplayText.trim();

  const list = content.listResponseMessage as { title?: string } | undefined;
  if (list?.title?.trim()) return list.title.trim();

  const tpl = content.templateButtonReplyMessage as { selectedDisplayText?: string } | undefined;
  if (tpl?.selectedDisplayText?.trim()) return tpl.selectedDisplayText.trim();

  return "";
}

export class WhatsAppChannel implements Channel {
  readonly type = "whatsapp";
  readonly fmt = new WhatsAppFormatter();

  private readonly authDir: string;
  private readonly uploadTtlMs = 24 * 60 * 60 * 1000;
  private running = false;
  private connected = false;
  private loggedOut = false;
  private socket: unknown | null = null;
  private botName = "WhatsApp";
  private typingTimers = new Map<
    ChannelChatId,
    { interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> }
  >();
  private groupNames = new Map<string, string>();
  private textPollByChat = new Map<ChannelChatId, WhatsAppPollState>();
  private pollToChat = new Map<string, ChannelChatId>();

  onPollAnswer: PollAnswerHandler | null = null;
  onDeadChat: ((chatId: ChannelChatId, error: Error) => void) | null = null;

  constructor(authDir?: string) {
    this.authDir = authDir?.trim() || defaultWhatsAppAuthDir();
  }

  private isDeadChatError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("forbidden") ||
      lower.includes("not-authorized") ||
      lower.includes("not_authorized") ||
      lower.includes("not found") ||
      lower.includes("404")
    );
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
          // Ignore files that changed while iterating.
        }
      }
    } catch {
      // Ignore cleanup failures.
    }
  }

  private async getGroupTitle(groupJid: string): Promise<string | undefined> {
    const cached = this.groupNames.get(groupJid);
    if (cached) return cached;
    const sock = this.socket as { groupMetadata?: (jid: string) => Promise<{ subject?: string }> } | null;
    if (!sock?.groupMetadata || !this.connected) return undefined;
    try {
      const meta = await sock.groupMetadata(groupJid);
      const subject = meta?.subject;
      if (subject) this.groupNames.set(groupJid, subject);
      return subject;
    } catch {
      return undefined;
    }
  }

  private async sendPresence(chatId: ChannelChatId, state: "composing" | "paused"): Promise<void> {
    if (!this.socket || !this.connected) return;
    try {
      const jid = chatIdToJid(chatId);
      const sock = this.socket as {
        sendPresenceUpdate?: (presence: string, jid?: string) => Promise<void>;
      };
      if (sock.sendPresenceUpdate) {
        await sock.sendPresenceUpdate(state, jid);
      }
    } catch {
      // Ignore typing errors.
    }
  }

  setTyping(chatId: ChannelChatId, active: boolean): void {
    if (active) {
      if (this.typingTimers.has(chatId)) return;
      void this.sendPresence(chatId, "composing");
      const interval = setInterval(() => {
        void this.sendPresence(chatId, "composing");
      }, 4500);
      const timeout = setTimeout(() => this.setTyping(chatId, false), 120_000);
      this.typingTimers.set(chatId, { interval, timeout });
      return;
    }

    const entry = this.typingTimers.get(chatId);
    if (entry) {
      clearInterval(entry.interval);
      clearTimeout(entry.timeout);
      this.typingTimers.delete(chatId);
    }
    void this.sendPresence(chatId, "paused");
  }

  async send(chatId: ChannelChatId, text: string): Promise<void> {
    this.setTyping(chatId, false);
    const jid = chatIdToJid(chatId);
    try {
      const sock = this.socket as { sendMessage?: (jid: string, content: Record<string, unknown>) => Promise<void> } | null;
      if (!sock?.sendMessage || !this.connected) {
        throw new Error("WhatsApp channel is not connected");
      }
      await sock.sendMessage(jid, { text });
    } catch (e) {
      const err = e as Error;
      await logger.error("Failed to send WhatsApp message", { chatId, jid, error: err.message });
      if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
    }
  }

  async sendOutput(chatId: ChannelChatId, rawOutput: string): Promise<void> {
    this.setTyping(chatId, false);
    const clean = stripAnsi(rawOutput);
    if (!clean.trim()) return;
    const chunks = chunkText(clean);
    for (const chunk of chunks) {
      await this.send(chatId, `\`\`\`${chunk}\`\`\``);
    }
  }

  async sendDocument(chatId: ChannelChatId, filePath: string, caption?: string): Promise<void> {
    const jid = chatIdToJid(chatId);
    try {
      const sock = this.socket as {
        sendMessage?: (jid: string, content: Record<string, unknown>) => Promise<void>;
      } | null;
      if (!sock?.sendMessage || !this.connected) {
        throw new Error("WhatsApp channel is not connected");
      }
      const data = await Bun.file(filePath).arrayBuffer();
      const fileName = basename(filePath);
      await sock.sendMessage(jid, {
        document: Buffer.from(data),
        fileName,
        mimetype: guessMimeType(filePath),
        ...(caption ? { caption } : {}),
      });
    } catch (e) {
      const err = e as Error;
      await logger.error("Failed to send WhatsApp document", { chatId, filePath, error: err.message });
      if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
    }
  }

  async sendSessionExit(chatId: ChannelChatId, sessionId: string, exitCode: number | null): Promise<void> {
    const status = exitCode === 0 ? "disconnected" : `disconnected (code ${exitCode ?? "unknown"})`;
    await this.send(chatId, `Session ${this.fmt.code(this.fmt.escape(sessionId))} ${this.fmt.escape(status)}.`);
  }

  clearLastMessage(_chatId: ChannelChatId): void {
    // No-op for WhatsApp.
  }

  async sendPoll(
    chatId: ChannelChatId,
    question: string,
    options: string[],
    multiSelect: boolean
  ): Promise<{ pollId: string; messageId: string }> {
    const id = whatsappPollId();
    const messageId = `wa-msg-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const promptLines = options.map((opt, idx) => `${idx + 1}. ${opt}`);
    const hint = multiSelect
      ? "Reply with one or more numbers (for example: 1,3)."
      : "Reply with one number (for example: 2).";
    const body = `*${question}*\n${promptLines.join("\n")}\n${hint}`;
    await this.send(chatId, body);

    const state: WhatsAppPollState = {
      pollId: id,
      messageId,
      optionCount: options.length,
      multiSelect,
      optionLabels: options,
    };
    this.textPollByChat.set(chatId, state);
    this.pollToChat.set(id, chatId);
    return { pollId: id, messageId };
  }

  async closePoll(chatId: ChannelChatId, messageId: string): Promise<void> {
    const poll = this.textPollByChat.get(chatId);
    if (!poll) return;
    if (poll.messageId !== messageId) return;
    this.textPollByChat.delete(chatId);
    this.pollToChat.delete(poll.pollId);
  }

  async validateChat(chatId: ChannelChatId): Promise<boolean> {
    if (!this.connected || !this.socket) return true;
    try {
      const jid = chatIdToJid(chatId);
      const sock = this.socket as {
        groupMetadata?: (jid: string) => Promise<unknown>;
        onWhatsApp?: (jid: string) => Promise<Array<{ exists?: boolean }>>;
      };
      if (isWhatsAppGroupJid(jid) && sock.groupMetadata) {
        await sock.groupMetadata(jid);
        return true;
      }
      if (sock.onWhatsApp) {
        const result = await sock.onWhatsApp(jid);
        if (!Array.isArray(result) || result.length === 0) return false;
        return result.some((r) => r?.exists !== false);
      }
      return true;
    } catch {
      return false;
    }
  }

  async getBotName(): Promise<string> {
    return this.botName;
  }

  private async handleMessagesUpsert(
    upsert: unknown,
    onMessage: (msg: InboundMessage) => Promise<void>
  ): Promise<void> {
    const payload = upsert as {
      type?: string;
      messages?: Array<Record<string, unknown>>;
    };
    if (payload.type !== "notify" && payload.type !== "append") return;
    for (const msg of payload.messages || []) {
      const key = (msg.key as Record<string, unknown> | undefined) || {};
      const remoteJid = key.remoteJid as string | undefined;
      if (!remoteJid) continue;
      if (remoteJid.endsWith("@status") || remoteJid.endsWith("@broadcast")) continue;
      if (key.fromMe === true) continue;

      const isGroup = isWhatsAppGroupJid(remoteJid);
      const senderJid = (isGroup ? (key.participant as string | undefined) : remoteJid) || "";
      const userId = jidToChannelUserId(senderJid);
      if (!userId) continue;

      const chatId = isGroup ? `whatsapp:${remoteJid}` : jidToChannelChatId(remoteJid);
      const content = resolveMessageContent(msg.message as Record<string, unknown> | undefined);
      const text = extractMessageText(content);
      if (!text) continue;

      const poll = this.textPollByChat.get(chatId);
      if (poll && this.onPollAnswer) {
        const answerIds = parseWhatsAppPollAnswer(text, poll);
        if (answerIds) {
          this.textPollByChat.delete(chatId);
          this.pollToChat.delete(poll.pollId);
          this.onPollAnswer({
            pollId: poll.pollId,
            userId,
            optionIds: answerIds,
          });
          continue;
        }
      }

      const inbound: InboundMessage = {
        userId,
        chatId,
        username: (msg.pushName as string | undefined) || undefined,
        text,
        isGroup,
        chatTitle: isGroup ? await this.getGroupTitle(remoteJid) : undefined,
      };
      await onMessage(inbound);
    }
  }

  private async runSocketLoop(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    const hadCreds = await hasWhatsAppCredentials(this.authDir);
    const sock = await createWhatsAppSocket({
      authDir: this.authDir,
      printQr: !hadCreds,
      verbose: false,
    });
    this.socket = sock;

    const baileys = (await import("@whiskeysockets/baileys")) as {
      DisconnectReason?: { loggedOut?: number };
    };

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      const ev = (sock as { ev?: { on?: (event: string, handler: (...args: unknown[]) => void) => void } }).ev;
      ev?.on?.("messages.upsert", (upsert: unknown) => {
        void this.handleMessagesUpsert(upsert, onMessage).catch(async (e) => {
          await logger.error("Failed to handle WhatsApp message", { error: (e as Error).message });
        });
      });

      ev?.on?.("connection.update", (update: unknown) => {
        const u = update as {
          connection?: string;
          lastDisconnect?: { error?: unknown };
        };

        if (u.connection === "open") {
          this.connected = true;
          const selfId = getSocketSelfId(sock);
          if (selfId) {
            this.botName = `WhatsApp ${selfId}`;
          }
          void logger.info("WhatsApp connected", { selfId: selfId || "unknown" });
          return;
        }

        if (u.connection === "close") {
          this.connected = false;
          const status = getDisconnectStatus(u.lastDisconnect?.error);
          const loggedOut = status === baileys.DisconnectReason?.loggedOut;
          if (loggedOut) {
            this.loggedOut = true;
            this.running = false;
            void logger.error("WhatsApp session logged out. Run `tg init` to relink.");
          } else {
            void logger.warn("WhatsApp connection closed", {
              status: status ?? "unknown",
              error: String(u.lastDisconnect?.error || "unknown"),
            });
          }
          finish();
        }
      });
    });
  }

  async startReceiving(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    await this.cleanupOldUploads();
    this.running = true;
    this.loggedOut = false;

    while (this.running) {
      try {
        await this.runSocketLoop(onMessage);
      } catch (e) {
        await logger.error("WhatsApp channel loop failed", { error: (e as Error).message });
      } finally {
        const sock = this.socket;
        this.socket = null;
        this.connected = false;
        if (sock) {
          await closeWhatsAppSocket(sock);
        }
      }

      if (!this.running || this.loggedOut) break;
      await Bun.sleep(3000);
    }
  }

  stopReceiving(): void {
    this.running = false;
    for (const [chatId] of this.typingTimers) {
      this.setTyping(chatId, false);
    }
    if (this.socket) {
      void closeWhatsAppSocket(this.socket);
    }
    this.socket = null;
    this.connected = false;
  }
}
