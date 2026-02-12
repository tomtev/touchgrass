import type { Channel } from "./types";
import type { ChannelConfig } from "../config/schema";
import { TelegramChannel } from "../channels/telegram/channel";

export function createChannel(name: string, config: ChannelConfig): Channel {
  switch (config.type) {
    case "telegram":
      return new TelegramChannel((config.credentials as { botToken: string }).botToken);
    default:
      throw new Error(`Unknown channel type: ${config.type}`);
  }
}
