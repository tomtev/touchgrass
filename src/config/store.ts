import { readFile, writeFile, chmod } from "fs/promises";
import { paths, ensureDirs } from "./paths";
import { type TgConfig, type ChannelConfig, createDefaultConfig, validateConfig, defaultSettings } from "./schema";

let cached: TgConfig | null = null;

// Old config format for migration
interface OldConfig {
  botToken: string;
  pairedUsers: Array<{ telegramId: number; username?: string; pairedAt: string }>;
  settings: Record<string, unknown>;
}

function isOldFormat(config: Record<string, unknown>): boolean {
  return typeof config.botToken === "string" && Array.isArray(config.pairedUsers);
}

function migrateConfig(old: OldConfig): TgConfig {
  const channels: Record<string, ChannelConfig> = {};

  if (old.botToken) {
    channels.telegram = {
      type: "telegram",
      credentials: { botToken: old.botToken },
      pairedUsers: old.pairedUsers.map((u) => ({
        userId: `telegram:${u.telegramId}`,
        username: u.username,
        pairedAt: u.pairedAt,
      })),
      linkedGroups: [],
    };
  }

  return {
    channels,
    settings: { ...defaultSettings, ...(old.settings || {}) } as TgConfig["settings"],
  };
}

export async function loadConfig(): Promise<TgConfig> {
  if (cached) return cached;
  try {
    const raw = await readFile(paths.config, "utf-8");
    await chmod(paths.config, 0o600).catch(() => {});
    const parsed = JSON.parse(raw);

    // Auto-migrate old format
    if (isOldFormat(parsed)) {
      const migrated = migrateConfig(parsed as unknown as OldConfig);
      await saveConfig(migrated);
      cached = migrated;
      return migrated;
    }

    if (!validateConfig(parsed)) {
      throw new Error("Invalid config format");
    }

    // Telegram-only runtime: drop unsupported channel entries on load.
    for (const [name, ch] of Object.entries(parsed.channels)) {
      if (name !== "telegram" || ch.type !== "telegram") {
        delete parsed.channels[name];
      }
    }

    // Merge with defaults in case new settings were added
    parsed.settings = { ...defaultSettings, ...parsed.settings };
    if (!parsed.chatPreferences || typeof parsed.chatPreferences !== "object") {
      parsed.chatPreferences = {};
    } else {
      for (const [chatId, pref] of Object.entries(parsed.chatPreferences)) {
        if (!pref || typeof pref !== "object") {
          delete parsed.chatPreferences[chatId];
          continue;
        }
        const mode = (pref as { outputMode?: unknown }).outputMode;
        const thinking = (pref as { thinking?: unknown }).thinking;
        const muted = (pref as { muted?: unknown }).muted;
        const validMode = mode === undefined || mode === "verbose" || mode === "compact";
        const validThinking = thinking === undefined || typeof thinking === "boolean";
        const validMuted = muted === undefined || typeof muted === "boolean";
        if (!validMode || !validThinking || !validMuted) {
          delete parsed.chatPreferences[chatId];
          continue;
        }
        // Compact is the default and should not be persisted explicitly.
        if (mode === "compact") {
          delete (pref as { outputMode?: unknown }).outputMode;
        }
        // Keep only meaningful preference objects.
        if (
          (pref as { outputMode?: unknown }).outputMode === undefined &&
          (pref as { thinking?: unknown }).thinking !== true &&
          (pref as { muted?: unknown }).muted !== true
        ) {
          delete parsed.chatPreferences[chatId];
        }
      }
    }
    // Ensure linkedGroups exists on all channels
    for (const ch of Object.values(parsed.channels)) {
      if (!ch.linkedGroups) ch.linkedGroups = [];
    }
    cached = parsed;
    return parsed;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return createDefaultConfig();
    }
    throw e;
  }
}

export async function saveConfig(config: TgConfig): Promise<void> {
  await ensureDirs();
  await writeFile(paths.config, JSON.stringify(config, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  await chmod(paths.config, 0o600).catch(() => {});
  cached = config;
}

export function invalidateCache(): void {
  cached = null;
}
