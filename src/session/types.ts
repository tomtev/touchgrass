import type { ChannelChatId, ChannelUserId } from "../channel/types";

export type SessionState = "remote";

export interface SessionInfo {
  id: string;
  command: string;
  state: SessionState;
  createdAt: string;
  exitCode: number | null;
  ownerChatId: ChannelChatId;
  ownerUserId: ChannelUserId;
}
