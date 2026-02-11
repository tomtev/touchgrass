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
}

export interface Channel {
  readonly type: string;
  send(chatId: ChannelChatId, html: string): Promise<void>;
  sendOutput(chatId: ChannelChatId, rawOutput: string): Promise<void>;
  sendSessionExit(chatId: ChannelChatId, sessionId: string, exitCode: number | null): Promise<void>;
  sendDocument?(chatId: ChannelChatId, filePath: string, caption?: string): Promise<void>;
  clearLastMessage(chatId: ChannelChatId): void;
  startReceiving(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void>;
  stopReceiving(): void;
  setTyping(chatId: ChannelChatId, active: boolean): void;
}
