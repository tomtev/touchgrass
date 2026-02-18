import { parseChannelAddress } from "../channel/id";

export interface ChannelConfig {
  type: string;
  credentials: Record<string, unknown>;
  pairedUsers: PairedUser[];
  linkedGroups: LinkedGroup[];
}

export interface PairedUser {
  userId: string; // e.g. "telegram:123456" or "telegram:bot_a:123456"
  username?: string;
  pairedAt: string;
}

export interface LinkedGroup {
  chatId: string; // e.g. "telegram:-123456" or "telegram:bot_a:-123456:12"
  title?: string;
  linkedAt: string;
}

export interface TgConfig {
  channels: Record<string, ChannelConfig>;
  settings: TgSettings;
  chatPreferences?: Record<string, ChatPreferences>;
}

export type OutputMode = "compact" | "verbose";

export interface ChatPreferences {
  outputMode?: OutputMode;
  thinking?: boolean;
  muted?: boolean;
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
    chatPreferences: {},
  };
}

export function validateConfig(config: unknown): config is TgConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;
  return (
    typeof c.channels === "object" &&
    c.channels !== null &&
    typeof c.settings === "object" &&
    c.settings !== null &&
    (c.chatPreferences === undefined || (typeof c.chatPreferences === "object" && c.chatPreferences !== null))
  );
}

export function getChatOutputMode(config: TgConfig, chatId: string): OutputMode {
  const mode = config.chatPreferences?.[chatId]?.outputMode;
  return mode === "verbose" ? "verbose" : "compact";
}

export function getChatThinkingEnabled(config: TgConfig, chatId: string): boolean {
  return config.chatPreferences?.[chatId]?.thinking === true;
}

export function getChatMuted(config: TgConfig, chatId: string): boolean {
  return config.chatPreferences?.[chatId]?.muted === true;
}

function pruneChatPreference(config: TgConfig, chatId: string): void {
  const pref = config.chatPreferences?.[chatId];
  if (!pref) return;
  const hasOutputMode = pref.outputMode === "verbose";
  const hasThinking = pref.thinking === true;
  const hasMuted = pref.muted === true;
  if (!hasOutputMode && !hasThinking && !hasMuted) {
    delete config.chatPreferences?.[chatId];
  }
}

export function setChatOutputMode(config: TgConfig, chatId: string, mode: OutputMode): boolean {
  if (getChatOutputMode(config, chatId) === mode) return false;
  if (!config.chatPreferences) config.chatPreferences = {};
  const nextPref: ChatPreferences = { ...(config.chatPreferences[chatId] || {}) };
  if (mode === "compact") delete nextPref.outputMode;
  else nextPref.outputMode = mode;
  config.chatPreferences[chatId] = nextPref;
  pruneChatPreference(config, chatId);
  return true;
}

export function setChatThinkingEnabled(config: TgConfig, chatId: string, enabled: boolean): boolean {
  if (getChatThinkingEnabled(config, chatId) === enabled) return false;
  if (!config.chatPreferences) config.chatPreferences = {};
  const nextPref: ChatPreferences = { ...(config.chatPreferences[chatId] || {}) };
  if (enabled) nextPref.thinking = true;
  else delete nextPref.thinking;
  config.chatPreferences[chatId] = nextPref;
  pruneChatPreference(config, chatId);
  return true;
}

export function setChatMuted(config: TgConfig, chatId: string, enabled: boolean): boolean {
  if (getChatMuted(config, chatId) === enabled) return false;
  if (!config.chatPreferences) config.chatPreferences = {};
  const nextPref: ChatPreferences = { ...(config.chatPreferences[chatId] || {}) };
  if (enabled) nextPref.muted = true;
  else delete nextPref.muted;
  config.chatPreferences[chatId] = nextPref;
  pruneChatPreference(config, chatId);
  return true;
}

export function getTelegramChannelEntries(config: TgConfig): Array<[string, ChannelConfig]> {
  return Object.entries(config.channels).filter(([, ch]) => ch.type === "telegram");
}

function resolveChannelNameForAddress(
  config: TgConfig,
  address: string,
  preferredChannelName?: string
): string | undefined {
  const parsed = parseChannelAddress(address);
  if (!parsed.type) return undefined;

  if (preferredChannelName) {
    const preferred = config.channels[preferredChannelName];
    if (preferred && preferred.type === parsed.type) return preferredChannelName;
  }

  if (parsed.channelName) {
    const scoped = config.channels[parsed.channelName];
    if (scoped && scoped.type === parsed.type) return parsed.channelName;
  }

  for (const [name, ch] of Object.entries(config.channels)) {
    if (ch.type === parsed.type) return name;
  }
  return undefined;
}

// Helper to get the bot token from telegram channel config.
// Without channelName, returns the default `telegram` token when present,
// otherwise the first configured telegram token.
export function getTelegramBotToken(config: TgConfig, channelName?: string): string {
  if (channelName) {
    const ch = config.channels[channelName];
    if (!ch || ch.type !== "telegram") return "";
    return (ch.credentials.botToken as string) || "";
  }

  const defaultCh = config.channels.telegram;
  if (defaultCh?.type === "telegram") {
    return (defaultCh.credentials.botToken as string) || "";
  }

  for (const [, ch] of getTelegramChannelEntries(config)) {
    const token = (ch.credentials.botToken as string) || "";
    if (token) return token;
  }
  return "";
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
export function updateLinkedGroupTitle(
  config: TgConfig,
  chatId: string,
  title: string,
  preferredChannelName?: string
): boolean {
  const channelName = resolveChannelNameForAddress(config, chatId, preferredChannelName);
  if (channelName) {
    const scoped = config.channels[channelName];
    const group = scoped?.linkedGroups?.find((g) => g.chatId === chatId);
    if (group && group.title !== title) {
      group.title = title;
      return true;
    }
  }

  for (const [name, ch] of Object.entries(config.channels)) {
    if (channelName && name === channelName) continue;
    const group = ch.linkedGroups?.find((g) => g.chatId === chatId);
    if (group && group.title !== title) {
      group.title = title;
      return true;
    }
  }
  return false;
}

// Remove a linked group/topic by chatId. Returns true if removed.
export function removeLinkedGroup(
  config: TgConfig,
  chatId: string,
  preferredChannelName?: string
): boolean {
  const channelName = resolveChannelNameForAddress(config, chatId, preferredChannelName);
  if (channelName) {
    const scoped = config.channels[channelName];
    if (scoped?.linkedGroups) {
      const idx = scoped.linkedGroups.findIndex((g) => g.chatId === chatId);
      if (idx >= 0) {
        scoped.linkedGroups.splice(idx, 1);
        return true;
      }
    }
  }

  for (const [name, ch] of Object.entries(config.channels)) {
    if (channelName && name === channelName) continue;
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
export function addLinkedGroup(
  config: TgConfig,
  chatId: string,
  title?: string,
  preferredChannelName?: string
): boolean {
  const channelName = resolveChannelNameForAddress(config, chatId, preferredChannelName);
  if (!channelName) return false;
  const ch = config.channels[channelName];
  if (!ch) return false;
  if (!ch.linkedGroups) ch.linkedGroups = [];
  if (ch.linkedGroups.some((g) => g.chatId === chatId)) return false;
  ch.linkedGroups.push({ chatId, title, linkedAt: new Date().toISOString() });
  return true;
}

export function isLinkedGroup(config: TgConfig, chatId: string, preferredChannelName?: string): boolean {
  const channelName = resolveChannelNameForAddress(config, chatId, preferredChannelName);
  if (channelName) {
    const scoped = config.channels[channelName];
    if (scoped?.linkedGroups?.some((g) => g.chatId === chatId)) return true;
  }

  for (const [name, ch] of Object.entries(config.channels)) {
    if (channelName && name === channelName) continue;
    if (ch.linkedGroups?.some((g) => g.chatId === chatId)) return true;
  }
  return false;
}

export function getLinkedGroupTitle(config: TgConfig, chatId: string, preferredChannelName?: string): string | undefined {
  const channelName = resolveChannelNameForAddress(config, chatId, preferredChannelName);
  if (channelName) {
    const scoped = config.channels[channelName];
    const group = scoped?.linkedGroups?.find((g) => g.chatId === chatId);
    if (group) return group.title;
  }

  for (const [name, ch] of Object.entries(config.channels)) {
    if (channelName && name === channelName) continue;
    const group = ch.linkedGroups?.find((g) => g.chatId === chatId);
    if (group) return group.title;
  }
  return undefined;
}
