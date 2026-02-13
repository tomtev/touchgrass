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
    agents: {},
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

    // Rename legacy "bees" key to "agents"
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (obj.agents === undefined && obj.bees && typeof obj.bees === "object") {
        obj.agents = obj.bees;
      }
      if (obj.bees !== undefined) {
        delete obj.bees;
      }
    }

    if (!validateConfig(parsed)) {
      throw new Error("Invalid config format");
    }
    // Merge with defaults in case new settings were added
    parsed.settings = { ...defaultSettings, ...parsed.settings };
    if (!parsed.agents) parsed.agents = {};
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
