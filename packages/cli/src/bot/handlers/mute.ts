import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import { getChatMuted, setChatMuted } from "../../config/schema";
import { saveConfig } from "../../config/store";

export async function handleMuteCommand(
  msg: InboundMessage,
  muted: boolean,
  ctx: RouterContext
): Promise<void> {
  const { fmt } = ctx.channel;
  const current = getChatMuted(ctx.config, msg.chatId);
  if (current === muted) {
    await ctx.channel.send(
      msg.chatId,
      muted
        ? `${fmt.escape("⛳️")} This chat is already ${fmt.code("muted")}.`
        : `${fmt.escape("⛳️")} This chat is already ${fmt.code("unmuted")}.`
    );
    return;
  }

  const changed = setChatMuted(ctx.config, msg.chatId, muted);
  if (changed) {
    await saveConfig(ctx.config);
  }

  if (muted) {
    ctx.channel.setTyping(msg.chatId, false);
  }

  await ctx.channel.send(
    msg.chatId,
    muted
      ? `${fmt.escape("⛳️")} Bridge output is now ${fmt.code("muted")} for this chat. Use ${fmt.code("/unmute")} to resume.`
      : `${fmt.escape("⛳️")} Bridge output is now ${fmt.code("unmuted")} for this chat.`
  );
}
