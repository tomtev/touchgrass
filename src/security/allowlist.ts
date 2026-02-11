import type { TgConfig, PairedUser } from "../config/schema";
import type { ChannelUserId } from "../channel/types";
import { saveConfig } from "../config/store";

export function isUserPaired(config: TgConfig, userId: ChannelUserId): boolean {
  for (const ch of Object.values(config.channels)) {
    if (ch.pairedUsers.some((u) => u.userId === userId)) return true;
  }
  return false;
}

export async function addPairedUser(
  config: TgConfig,
  userId: ChannelUserId,
  username?: string
): Promise<void> {
  if (isUserPaired(config, userId)) return;

  // Determine channel from userId prefix
  const channelType = userId.split(":")[0];
  const channelConfig = config.channels[channelType];
  if (!channelConfig) return;

  const user: PairedUser = {
    userId,
    pairedAt: new Date().toISOString(),
    ...(username ? { username } : {}),
  };

  channelConfig.pairedUsers.push(user);
  await saveConfig(config);
}

export async function removePairedUser(
  config: TgConfig,
  userId: ChannelUserId
): Promise<boolean> {
  for (const ch of Object.values(config.channels)) {
    const idx = ch.pairedUsers.findIndex((u) => u.userId === userId);
    if (idx !== -1) {
      ch.pairedUsers.splice(idx, 1);
      await saveConfig(config);
      return true;
    }
  }
  return false;
}
