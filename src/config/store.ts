import { readFile, writeFile } from "fs/promises";
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
    // Merge with defaults in case new settings were added
    parsed.settings = { ...defaultSettings, ...parsed.settings };
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
  await writeFile(paths.config, JSON.stringify(config, null, 2) + "\n", "utf-8");
  cached = config;
}

export function invalidateCache(): void {
  cached = null;
}
