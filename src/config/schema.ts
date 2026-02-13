export interface ChannelConfig {
  type: string;
  credentials: Record<string, unknown>;
  pairedUsers: PairedUser[];
  linkedGroups: LinkedGroup[];
}

export interface PairedUser {
  userId: string; // e.g. "telegram:123456"
  username?: string;
  pairedAt: string;
}

export interface LinkedGroup {
  chatId: string; // e.g. "telegram:-123456"
  title?: string;
  linkedAt: string;
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

// Helper to get all linked groups across all channels
export function getAllLinkedGroups(config: TgConfig): LinkedGroup[] {
  const groups: LinkedGroup[] = [];
  for (const ch of Object.values(config.channels)) {
    groups.push(...(ch.linkedGroups || []));
  }
  return groups;
}

// Update a linked group's title if it changed. Returns true if updated.
export function updateLinkedGroupTitle(config: TgConfig, chatId: string, title: string): boolean {
  for (const ch of Object.values(config.channels)) {
    const group = ch.linkedGroups?.find((g) => g.chatId === chatId);
    if (group && group.title !== title) {
      group.title = title;
      return true;
    }
  }
  return false;
}

// Remove a linked group/topic by chatId. Returns true if removed.
export function removeLinkedGroup(config: TgConfig, chatId: string): boolean {
  for (const ch of Object.values(config.channels)) {
    if (!ch.linkedGroups) continue;
    const idx = ch.linkedGroups.findIndex((g) => g.chatId === chatId);
    if (idx >= 0) {
      ch.linkedGroups.splice(idx, 1);
      return true;
    }
  }
  return false;
}

// Add a linked group to the first channel that matches the type
export function addLinkedGroup(config: TgConfig, chatId: string, title?: string): boolean {
  // Determine channel type from chatId prefix
  const channelType = chatId.split(":")[0]; // "telegram"
  for (const ch of Object.values(config.channels)) {
    if (ch.type === channelType) {
      if (!ch.linkedGroups) ch.linkedGroups = [];
      // Don't add duplicates
      if (ch.linkedGroups.some((g) => g.chatId === chatId)) return false;
      ch.linkedGroups.push({ chatId, title, linkedAt: new Date().toISOString() });
      return true;
    }
  }
  return false;
}

export function isLinkedGroup(config: TgConfig, chatId: string): boolean {
  for (const ch of Object.values(config.channels)) {
    if (ch.linkedGroups?.some((g) => g.chatId === chatId)) return true;
  }
  return false;
}

export function getLinkedGroupTitle(config: TgConfig, chatId: string): string | undefined {
  for (const ch of Object.values(config.channels)) {
    const group = ch.linkedGroups?.find((g) => g.chatId === chatId);
    if (group) return group.title;
  }
  return undefined;
}
