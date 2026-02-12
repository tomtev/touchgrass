import type { ChannelChatId, ChannelUserId } from "../channel/types";

export type SessionState = "running" | "exited" | "remote";

export interface SessionInfo {
  id: string;
  command: string;
  state: SessionState;
  createdAt: string;
  exitCode: number | null;
  ownerChatId: ChannelChatId;
  ownerUserId: ChannelUserId;
}

export interface SessionEvents {
  onOutput: (sessionId: string, data: string) => void;
  onExit: (sessionId: string, exitCode: number | null) => void;
}
