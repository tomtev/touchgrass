import type { Formatter } from "./formatter";

// Tagged string IDs: "telegram:123456", "discord:98765"
export type ChannelUserId = string;
export type ChannelChatId = string;

export interface InboundMessage {
  userId: ChannelUserId;
  chatId: ChannelChatId;
  username?: string;
  text: string;
  fileUrls?: string[]; // resolved attachment URLs
  isGroup?: boolean; // true if message came from a group/channel
  chatTitle?: string; // group/channel title
  topicTitle?: string; // forum topic title (if detectable)
}

export interface PollResult {
  pollId: string;
  messageId: string;
}

export type PollAnswerHandler = (answer: {
  pollId: string;
  userId: ChannelUserId;
  optionIds: number[];
}) => void;

export interface Channel {
  readonly type: string;
  readonly fmt: Formatter;
  send(chatId: ChannelChatId, html: string): Promise<void>;
  sendOutput(chatId: ChannelChatId, rawOutput: string): Promise<void>;
  sendSessionExit(chatId: ChannelChatId, sessionId: string, exitCode: number | null): Promise<void>;
  sendDocument?(chatId: ChannelChatId, filePath: string, caption?: string): Promise<void>;
  clearLastMessage(chatId: ChannelChatId): void;
  startReceiving(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void>;
  stopReceiving(): void;
  setTyping(chatId: ChannelChatId, active: boolean): void;
  // Optional capabilities — not all channels support these
  sendPoll?(chatId: ChannelChatId, question: string, options: string[], multiSelect: boolean): Promise<PollResult>;
  closePoll?(chatId: ChannelChatId, messageId: string): Promise<void>;
  onPollAnswer?: PollAnswerHandler | null;
  validateChat?(chatId: ChannelChatId): Promise<boolean>;
  getBotName?(): Promise<string>;
}

/** Check if a ChannelChatId is a forum topic (has 3+ colon-separated parts) */
export function isTopic(chatId: ChannelChatId): boolean {
  return chatId.split(":").length >= 3;
}

/** Get the parent group chatId from a topic chatId */
export function getParentChatId(chatId: ChannelChatId): ChannelChatId {
  const parts = chatId.split(":");
  return `${parts[0]}:${parts[1]}`;
}
