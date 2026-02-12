import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";

const ALLOWED_COMMANDS = ["claude", "codex", "pi"];

export async function handleSpawn(
  msg: InboundMessage,
  commandStr: string,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const { fmt } = ctx.channel;

  if (!commandStr) {
    await ctx.channel.send(chatId, `Usage: ${fmt.code(`tg ${fmt.escape("<command>")} [args]`)}\nAllowed: ${ALLOWED_COMMANDS.join(", ")}`);
    return;
  }

  // Parse command and args
  const parts = commandStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [commandStr];
  const command = parts[0];
  const args = parts.slice(1).map((a) => a.replace(/^"|"$/g, ""));

  if (!ALLOWED_COMMANDS.includes(command)) {
    await ctx.channel.send(chatId, `Command ${fmt.code(fmt.escape(command))} not allowed. Allowed: ${ALLOWED_COMMANDS.join(", ")}`);
    return;
  }

  const session = ctx.sessionManager.spawn(command, args, chatId, msg.userId);

  if (!session) {
    await ctx.channel.send(chatId, "Max sessions reached. Stop a session first.");
    return;
  }

  await ctx.channel.send(
    chatId,
    `Session ${fmt.code(fmt.escape(session.id))} connected: ${fmt.code(fmt.escape(commandStr))}\nYou are auto-attached. Send text to write to stdin.`
  );
  // Clear last message so output starts fresh
  ctx.channel.clearLastMessage(chatId);
}
