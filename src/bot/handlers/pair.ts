import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import { validatePairingCode } from "../../security/pairing";
import { addPairedUser, isUserPaired } from "../../security/allowlist";
import { checkRateLimit } from "../../security/rate-limiter";
import { logger } from "../../daemon/logger";

export async function handlePair(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const userId = msg.userId;
  const username = msg.username;
  const { fmt } = ctx.channel;

  if (isUserPaired(ctx.config, userId)) {
    await ctx.channel.send(chatId, "You are already paired.");
    return;
  }

  const parts = msg.text.trim().split(/\s+/);
  if (parts.length < 2) {
    await ctx.channel.send(chatId, `Usage: /pair ${fmt.escape("<code>")}`);
    return;
  }

  if (!checkRateLimit(userId)) {
    await ctx.channel.send(
      chatId,
      "Too many pairing attempts. Try again in a minute."
    );
    return;
  }

  const code = parts[1];
  if (!validatePairingCode(code)) {
    await ctx.channel.send(chatId, "Invalid or expired pairing code.");
    return;
  }

  await addPairedUser(ctx.config, userId, username);
  await logger.info("User paired", { userId, username });
  await ctx.channel.send(
    chatId,
    `Paired successfully! Welcome${username ? `, @${username}` : ""}.\n\nSend ${fmt.code(`tg ${fmt.escape("<command>")}`)} to run a command.\nSend /help for more info.`
  );
}
