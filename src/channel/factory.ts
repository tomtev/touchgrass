import type { Channel } from "./types";
import type { ChannelConfig } from "../config/schema";
import { TelegramChannel } from "../channels/telegram/channel";
import { SlackChannel } from "../channels/slack/channel";
import { WhatsAppChannel } from "../channels/whatsapp/channel";
import { defaultWhatsAppAuthDir } from "../channels/whatsapp/auth";

export function createChannel(name: string, config: ChannelConfig): Channel {
  switch (config.type) {
    case "telegram":
      return new TelegramChannel((config.credentials as { botToken: string }).botToken);
    case "slack":
      return new SlackChannel(
        (config.credentials as { botToken: string }).botToken,
        (config.credentials as { appToken: string }).appToken
      );
    case "whatsapp":
      return new WhatsAppChannel(
        ((config.credentials as { authDir?: string }).authDir || defaultWhatsAppAuthDir()).trim()
      );
    default:
      throw new Error(`Unknown channel type: ${config.type}`);
  }
}
