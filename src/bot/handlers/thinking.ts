import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import { getChatThinkingEnabled, setChatThinkingEnabled } from "../../config/schema";
import { saveConfig } from "../../config/store";

function usageText(): string {
  return "Usage: /thinking on|off|toggle";
}

function parseThinkingArg(value: string | undefined): "on" | "off" | "toggle" | null {
  if (!value) return "toggle";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "toggle";
  if (["on", "enable", "enabled", "true", "1", "yes"].includes(normalized)) return "on";
  if (["off", "disable", "disabled", "false", "0", "no"].includes(normalized)) return "off";
  if (["toggle", "flip"].includes(normalized)) return "toggle";
  return null;
}

export async function handleThinkingCommand(
  msg: InboundMessage,
  thinkingArg: string | undefined,
  ctx: RouterContext
): Promise<void> {
  const { fmt } = ctx.channel;
  const parsedArg = parseThinkingArg(thinkingArg);
  const current = getChatThinkingEnabled(ctx.config, msg.chatId);

  if (!parsedArg) {
    await ctx.channel.send(
      msg.chatId,
      `${fmt.escape(usageText())}\n${fmt.escape("Current thinking mode:")} ${fmt.code(current ? "on" : "off")}`
    );
    return;
  }

  const next = parsedArg === "toggle" ? !current : parsedArg === "on";
  const changed = setChatThinkingEnabled(ctx.config, msg.chatId, next);
  if (changed) {
    await saveConfig(ctx.config);
  }

  await ctx.channel.send(
    msg.chatId,
    `${fmt.escape("⛳️")} Thinking is now ${fmt.code(next ? "on" : "off")} for this chat.`
  );
}
