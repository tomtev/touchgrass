import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import { logger } from "../../daemon/logger";

const ALLOWED_COMMANDS = ["claude", "codex", "pi"];

export async function handleSpawn(
  msg: InboundMessage,
  commandStr: string,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;

  if (!commandStr) {
    await ctx.channel.send(chatId, `Usage: <code>tg &lt;command&gt; [args]</code>\nAllowed: ${ALLOWED_COMMANDS.join(", ")}`);
    return;
  }

  // Parse command and args
  const parts = commandStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [commandStr];
  const command = parts[0];
  const args = parts.slice(1).map((a) => a.replace(/^"|"$/g, ""));

  if (!ALLOWED_COMMANDS.includes(command)) {
    await ctx.channel.send(chatId, `Command <code>${command}</code> not allowed. Allowed: ${ALLOWED_COMMANDS.join(", ")}`);
    return;
  }

  const session = ctx.sessionManager.spawn(command, args, chatId);

  if (!session) {
    await ctx.channel.send(chatId, "Max sessions reached. Stop a session first.");
    return;
  }

  await ctx.channel.send(
    chatId,
    `Session <code>${session.id}</code> started: <code>${commandStr}</code>\nYou are auto-attached. Send text to write to stdin.`
  );
  // Clear last message so output starts fresh
  ctx.channel.clearLastMessage(chatId);
}
