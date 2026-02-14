import type { Channel, ChannelChatId, InboundMessage, PollResult, PollAnswerHandler } from "../../channel/types";
import { SlackFormatter } from "./slack-formatter";
import { SlackApi } from "./api";
import { stripAnsi } from "../../utils/ansi";
import { logger } from "../../daemon/logger";
import { ensureDirs, paths } from "../../config/paths";
import { join } from "path";
import { chmod, readdir, stat, unlink } from "fs/promises";

interface SlackEnvelope {
  envelope_id?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

interface SlackPollState {
  pollId: string;
  messageId: string;
  optionCount: number;
  multiSelect: boolean;
  optionLabels: string[];
  mode: "text" | "buttons";
}

interface ResolvedTarget {
  channelId: string;
  threadTs?: string;
}

const SLACK_MAX_TEXT = 39000;

function chunkSlackText(text: string, maxLen = SLACK_MAX_TEXT): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxLen, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > i) end = lastNewline + 1;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

function pollId(): string {
  return `slack-poll-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function pollActionValue(id: string, optionId: number): string {
  return `tgp:${id}:${optionId}`;
}

function parsePollActionValue(value: string): { pollId: string; optionId: number } | null {
  const match = value.match(/^tgp:([^:]+):(\d+)$/);
  if (!match) return null;
  const optionId = Number(match[2]);
  if (!Number.isFinite(optionId) || optionId < 0) return null;
  return { pollId: match[1], optionId };
}

function toChatId(base: string, threadTs?: string): ChannelChatId {
  return threadTs ? `slack:${base}:${threadTs}` : `slack:${base}`;
}

function parseChatId(chatId: ChannelChatId): { base: string; threadTs?: string } {
  const parts = chatId.split(":");
  if (parts.length < 2 || parts[0] !== "slack") {
    throw new Error(`Invalid Slack chatId: ${chatId}`);
  }
  const base = parts[1];
  const threadTs = parts.length >= 3 ? parts.slice(2).join(":") : undefined;
  return { base, threadTs };
}

function isUserId(id: string): boolean {
  return id.startsWith("U");
}

function isGroupConversation(id: string): boolean {
  return id.startsWith("C") || id.startsWith("G");
}

export class SlackChannel implements Channel {
  readonly type = "slack";
  readonly fmt = new SlackFormatter();
  private readonly api: SlackApi;
  private readonly uploadTtlMs = 24 * 60 * 60 * 1000;
  private running = false;
  private ws: WebSocket | null = null;
  private botUserId: string | null = null;
  private botDisplayName: string | null = null;
  private lastMessage = new Map<ChannelChatId, { ts: string; text: string; channelId: string; threadTs?: string }>();
  private dmChannelCache = new Map<string, string>();
  private conversationNames = new Map<string, string>();
  private textPollByChat = new Map<ChannelChatId, SlackPollState>();
  private pollToChat = new Map<string, ChannelChatId>();

  onPollAnswer: PollAnswerHandler | null = null;
  onDeadChat: ((chatId: ChannelChatId, error: Error) => void) | null = null;

  constructor(botToken: string, appToken: string) {
    this.api = new SlackApi(botToken, appToken);
  }

  private isDeadChatError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return (
      lower.includes("channel_not_found") ||
      lower.includes("not_in_channel") ||
      lower.includes("is_archived") ||
      lower.includes("user_not_found") ||
      lower.includes("not_allowed_token_type")
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
          // Ignore files that changed while iterating
        }
      }
    } catch {
      // Ignore cleanup failures
    }
  }

  private async resolveTarget(chatId: ChannelChatId): Promise<ResolvedTarget> {
    const parsed = parseChatId(chatId);
    if (isUserId(parsed.base)) {
      let dmChannel = this.dmChannelCache.get(parsed.base);
      if (!dmChannel) {
        dmChannel = await this.api.openDm(parsed.base);
        this.dmChannelCache.set(parsed.base, dmChannel);
      }
      return { channelId: dmChannel, threadTs: parsed.threadTs };
    }
    return { channelId: parsed.base, threadTs: parsed.threadTs };
  }

  private stripBotMention(text: string): string {
    if (!this.botUserId) return text.trim();
    const mentionRe = new RegExp(`<@${this.botUserId}>`, "g");
    return text.replace(mentionRe, "").replace(/\s+/g, " ").trim();
  }

  private async getConversationTitle(channelId: string): Promise<string> {
    const cached = this.conversationNames.get(channelId);
    if (cached) return cached;
    try {
      const info = await this.api.getConversationInfo(channelId);
      const title = info.name || channelId;
      this.conversationNames.set(channelId, title);
      return title;
    } catch {
      return channelId;
    }
  }

  private parsePollAnswer(text: string, poll: SlackPollState): number[] | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (!/^\d+(?:[\s,]+\d+)*$/.test(trimmed)) {
      const byLabel = poll.optionLabels.findIndex((label) => label.toLowerCase() === trimmed.toLowerCase());
      if (byLabel >= 0) return [byLabel];
      return null;
    }
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

  setTyping(_chatId: ChannelChatId, _active: boolean): void {
    // Slack's Web API doesn't provide a stable typing indicator API like Telegram.
  }

  async send(chatId: ChannelChatId, text: string): Promise<void> {
    this.setTyping(chatId, false);
    try {
      const target = await this.resolveTarget(chatId);
      await this.api.sendMessage(target.channelId, text, target.threadTs);
      this.lastMessage.delete(chatId);
    } catch (e) {
      const err = e as Error;
      await logger.error("Failed to send Slack message", { chatId, error: err.message });
      if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
    }
  }

  async sendOutput(chatId: ChannelChatId, rawOutput: string): Promise<void> {
    this.setTyping(chatId, false);
    const clean = stripAnsi(rawOutput);
    if (!clean.trim()) return;

    try {
      const target = await this.resolveTarget(chatId);
      const chunks = chunkSlackText(clean);

      for (const chunk of chunks) {
        const last = this.lastMessage.get(chatId);
        if (last && chunks.length === 1) {
          const combined = `${last.text}${chunk}`;
          if (combined.length < SLACK_MAX_TEXT) {
            try {
              await this.api.updateMessage(last.channelId, last.ts, `\`\`\`${combined}\`\`\``);
              this.lastMessage.set(chatId, {
                ts: last.ts,
                channelId: last.channelId,
                threadTs: last.threadTs,
                text: combined,
              });
              return;
            } catch {
              // fall back to posting a new message
            }
          }
        }

        const sent = await this.api.sendMessage(target.channelId, `\`\`\`${chunk}\`\`\``, target.threadTs);
        this.lastMessage.set(chatId, {
          ts: sent.ts,
          channelId: sent.channel,
          threadTs: target.threadTs,
          text: chunk,
        });
      }
    } catch (e) {
      const err = e as Error;
      await logger.error("Failed to send Slack output", { chatId, error: err.message });
      if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
    }
  }

  async sendDocument(chatId: ChannelChatId, filePath: string, caption?: string): Promise<void> {
    try {
      const target = await this.resolveTarget(chatId);
      await this.api.sendFile(target.channelId, filePath, caption, target.threadTs);
    } catch (e) {
      const err = e as Error;
      await logger.error("Failed to send Slack document", { chatId, filePath, error: err.message });
      if (this.isDeadChatError(err.message)) this.onDeadChat?.(chatId, err);
    }
  }

  async sendSessionExit(chatId: ChannelChatId, sessionId: string, exitCode: number | null): Promise<void> {
    const status = exitCode === 0 ? "disconnected" : `disconnected (code ${exitCode ?? "unknown"})`;
    await this.send(chatId, `Session ${this.fmt.code(this.fmt.escape(sessionId))} ${this.fmt.escape(status)}.`);
    this.lastMessage.delete(chatId);
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
    const target = await this.resolveTarget(chatId);
    const id = pollId();
    let sent: { channel: string; ts: string };
    let mode: "text" | "buttons" = "text";
    if (!multiSelect) {
      mode = "buttons";
      const blocks: Record<string, unknown>[] = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${this.fmt.escape(question)}*`,
          },
        },
        {
          type: "actions",
          elements: options.slice(0, 10).map((opt, idx) => ({
            type: "button",
            text: {
              type: "plain_text",
              text: opt.slice(0, 75),
              emoji: true,
            },
            value: pollActionValue(id, idx),
            action_id: `tg_poll_${idx}`,
          })),
        },
      ];
      sent = await this.api.sendMessage(target.channelId, question, target.threadTs, blocks);
    } else {
      const promptLines = options.map((opt, idx) => `${idx + 1}. ${opt}`);
      const hint = "Reply with one or more numbers (for example: 1,3).";
      const body = `*${this.fmt.escape(question)}*\n${this.fmt.escape(promptLines.join("\n"))}\n${this.fmt.escape(hint)}`;
      sent = await this.api.sendMessage(target.channelId, body, target.threadTs);
    }

    const state: SlackPollState = {
      pollId: id,
      messageId: sent.ts,
      optionCount: options.length,
      multiSelect,
      optionLabels: options,
      mode,
    };
    this.textPollByChat.set(chatId, state);
    this.pollToChat.set(id, chatId);
    return { pollId: id, messageId: sent.ts };
  }

  async closePoll(chatId: ChannelChatId, messageId: string): Promise<void> {
    const state = this.textPollByChat.get(chatId);
    if (!state) return;
    if (state.messageId !== messageId) return;
    this.textPollByChat.delete(chatId);
    this.pollToChat.delete(state.pollId);
  }

  async validateChat(chatId: ChannelChatId): Promise<boolean> {
    try {
      const parsed = parseChatId(chatId);
      if (isUserId(parsed.base)) {
        await this.api.getUserInfo(parsed.base);
      } else {
        await this.api.getConversationInfo(parsed.base);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async handleMessageEvent(
    event: Record<string, unknown>,
    onMessage: (msg: InboundMessage) => Promise<void>
  ): Promise<void> {
    const subtype = typeof event.subtype === "string" ? event.subtype : "";
    if (
      subtype === "bot_message" ||
      subtype === "message_changed" ||
      subtype === "message_deleted" ||
      subtype === "channel_join" ||
      subtype === "channel_leave"
    ) {
      return;
    }
    if (event.bot_id) return;

    const channelId = typeof event.channel === "string" ? event.channel : "";
    const userIdRaw = typeof event.user === "string" ? event.user : "";
    if (!channelId || !userIdRaw) return;

    const ts = typeof event.ts === "string" ? event.ts : undefined;
    const threadTsRaw = typeof event.thread_ts === "string" ? event.thread_ts : undefined;
    const threadTs = threadTsRaw && ts && threadTsRaw !== ts ? threadTsRaw : undefined;

    let text = typeof event.text === "string" ? event.text : "";
    text = this.stripBotMention(text);
    const fileUrls: string[] = [];

    const files = Array.isArray(event.files) ? event.files as Array<Record<string, unknown>> : [];
    if (files.length > 0) {
      await ensureDirs();
      for (const file of files) {
        const privateUrl = (file.url_private_download as string) || (file.url_private as string);
        const fileId = (file.id as string) || `file-${Date.now()}`;
        const fileNameRaw = (file.name as string) || "";
        const ext = (() => {
          const i = fileNameRaw.lastIndexOf(".");
          if (i > 0) return fileNameRaw.slice(i + 1);
          const ft = file.filetype as string | undefined;
          return ft || "bin";
        })();
        if (!privateUrl) continue;
        try {
          const buffer = await this.api.downloadPrivateFile(privateUrl);
          const localPath = join(paths.uploadsDir, `${Date.now()}-${fileId}.${ext}`);
          await Bun.write(localPath, buffer);
          await chmod(localPath, 0o600).catch(() => {});
          fileUrls.push(localPath);
        } catch (e) {
          await logger.error("Failed to download Slack file", { error: (e as Error).message });
        }
      }
    }

    const inboundChatId = (() => {
      const base = channelId.startsWith("D") ? userIdRaw : channelId;
      return toChatId(base, threadTs);
    })();

    const poll = this.textPollByChat.get(inboundChatId);
    if (poll && text) {
      const answerIds = this.parsePollAnswer(text, poll);
      if (answerIds && this.onPollAnswer) {
        this.textPollByChat.delete(inboundChatId);
        this.pollToChat.delete(poll.pollId);
        this.onPollAnswer({
          pollId: poll.pollId,
          userId: `slack:${userIdRaw}`,
          optionIds: answerIds,
        });
        return;
      }
    }

    if (!text && fileUrls.length === 0) return;
    if (!text && fileUrls.length > 0) {
      text = fileUrls.join(" ");
    }

    const isGroup = !channelId.startsWith("D");
    const chatTitle = isGroup ? await this.getConversationTitle(channelId) : undefined;
    const topicTitle = threadTs ? "Thread" : undefined;
    const inbound: InboundMessage = {
      userId: `slack:${userIdRaw}`,
      chatId: inboundChatId,
      username: undefined,
      text,
      fileUrls: fileUrls.length > 0 ? fileUrls : undefined,
      isGroup,
      chatTitle,
      topicTitle,
    };

    await onMessage(inbound);
  }

  private async handleSocketEnvelope(
    envelope: SlackEnvelope,
    onMessage: (msg: InboundMessage) => Promise<void>
  ): Promise<void> {
    if (envelope.envelope_id && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }

    if (envelope.type === "events_api" && envelope.payload) {
      const event = envelope.payload.event as Record<string, unknown> | undefined;
      if (!event || typeof event.type !== "string") return;
      if (event.type === "message") {
        await this.handleMessageEvent(event, onMessage);
      }
      return;
    }

    if (envelope.type === "interactive" && envelope.payload) {
      const payload = envelope.payload;
      if (payload.type !== "block_actions") return;
      const user = payload.user as Record<string, unknown> | undefined;
      const userIdRaw = typeof user?.id === "string" ? user.id : "";
      if (!userIdRaw) return;
      const actions = Array.isArray(payload.actions) ? payload.actions as Array<Record<string, unknown>> : [];
      if (actions.length === 0) return;
      const value = typeof actions[0]?.value === "string" ? actions[0].value : "";
      const parsed = parsePollActionValue(value);
      if (!parsed || !this.onPollAnswer) return;
      const chatId = this.pollToChat.get(parsed.pollId);
      if (chatId) {
        this.textPollByChat.delete(chatId);
        this.pollToChat.delete(parsed.pollId);
      }
      this.onPollAnswer({
        pollId: parsed.pollId,
        userId: `slack:${userIdRaw}`,
        optionIds: [parsed.optionId],
      });
      return;
    }
  }

  private async runSocketLoop(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    const socketUrl = await this.api.openSocketConnection();
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(socketUrl);
      this.ws = ws;

      ws.onmessage = (evt) => {
        const raw = typeof evt.data === "string" ? evt.data : "";
        if (!raw) return;
        let envelope: SlackEnvelope;
        try {
          envelope = JSON.parse(raw) as SlackEnvelope;
        } catch {
          return;
        }
        void this.handleSocketEnvelope(envelope, onMessage).catch(async (e) => {
          await logger.error("Slack envelope handling failed", { error: (e as Error).message });
        });
      };

      ws.onerror = () => {
        // onclose will reconnect
      };

      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        resolve();
      };
    });
  }

  async startReceiving(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    await this.cleanupOldUploads();
    try {
      const me = await this.api.authTest();
      this.botUserId = me.user_id;
      this.botDisplayName = me.user || "Slack Bot";
      await logger.info("Slack bot connected", { userId: me.user_id, team: me.team });
    } catch (e) {
      await logger.error("Failed to connect to Slack", { error: (e as Error).message });
      throw e;
    }

    this.running = true;
    while (this.running) {
      try {
        await this.runSocketLoop(onMessage);
      } catch (e) {
        await logger.error("Slack Socket Mode error", { error: (e as Error).message });
      }
      if (this.running) {
        await Bun.sleep(3000);
      }
    }
  }

  async getBotName(): Promise<string> {
    if (this.botDisplayName) return this.botDisplayName;
    try {
      const me = await this.api.authTest();
      this.botDisplayName = me.user || "Slack Bot";
      this.botUserId = me.user_id;
      return this.botDisplayName;
    } catch {
      return "Slack Bot";
    }
  }

  stopReceiving(): void {
    this.running = false;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}
