import type { Channel } from "./types";
import type { ChannelConfig } from "../config/schema";
import { TelegramChannel } from "../channels/telegram/channel";
import { SlackChannel } from "../channels/slack/channel";
import { InternalChannel } from "../channels/internal/channel";

export function createChannel(name: string, config: ChannelConfig): Channel {
  switch (config.type) {
    case "telegram":
      return new TelegramChannel((config.credentials as { botToken: string }).botToken, name);
    case "slack":
      return new SlackChannel(
        (config.credentials as { botToken: string }).botToken,
        (config.credentials as { appToken: string }).appToken,
        name
      );
    case "internal":
      return new InternalChannel(name);
    default:
      throw new Error(`Unsupported channel type: ${config.type}. Only telegram and slack are supported.`);
  }
}
