export interface ChannelConfig {
  type: string;
  credentials: Record<string, unknown>;
  pairedUsers: PairedUser[];
}

export interface PairedUser {
  userId: string; // e.g. "telegram:123456"
  username?: string;
  pairedAt: string;
}

export interface TgConfig {
  channels: Record<string, ChannelConfig>;
  settings: TgSettings;
}

export interface TgSettings {
  outputBatchMinMs: number;
  outputBatchMaxMs: number;
  outputBufferMaxChars: number;
  maxSessions: number;
  defaultShell: string;
}

export const defaultSettings: TgSettings = {
  outputBatchMinMs: 300,
  outputBatchMaxMs: 800,
  outputBufferMaxChars: 4096,
  maxSessions: 10,
  defaultShell: process.env.SHELL || "/bin/bash",
};

export function createDefaultConfig(): TgConfig {
  return {
    channels: {},
    settings: { ...defaultSettings },
  };
}

export function validateConfig(config: unknown): config is TgConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;
  return (
    typeof c.channels === "object" &&
    c.channels !== null &&
    typeof c.settings === "object" &&
    c.settings !== null
  );
}

// Helper to get the bot token from the telegram channel config
export function getTelegramBotToken(config: TgConfig): string {
  const tg = config.channels.telegram;
  if (!tg) return "";
  return (tg.credentials.botToken as string) || "";
}

// Helper to get all paired users across all channels
export function getAllPairedUsers(config: TgConfig): PairedUser[] {
  const users: PairedUser[] = [];
  for (const ch of Object.values(config.channels)) {
    users.push(...ch.pairedUsers);
  }
  return users;
}
