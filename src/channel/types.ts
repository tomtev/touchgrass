// Tagged string IDs: "telegram:123456", "discord:98765"
export type ChannelUserId = string;
export type ChannelChatId = string;

export interface InboundMessage {
  userId: ChannelUserId;
  chatId: ChannelChatId;
  username?: string;
  text: string;
  replyToRef?: string; // opaque ref for reply-to routing
  fileUrls?: string[]; // resolved attachment URLs
  isGroup?: boolean; // true if message came from a group/channel
}

export interface Channel {
  readonly type: string;
  send(chatId: ChannelChatId, html: string, sessionId?: string): Promise<void>;
  sendOutput(chatId: ChannelChatId, rawOutput: string, sessionId?: string): Promise<void>;
  sendSessionExit(chatId: ChannelChatId, sessionId: string, exitCode: number | null): Promise<void>;
  clearLastMessage(chatId: ChannelChatId): void;
  startReceiving(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void>;
  stopReceiving(): void;
  onMessageSent: ((messageRef: string, sessionId: string) => void) | null;
}
