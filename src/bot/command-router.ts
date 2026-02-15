import type { Channel, InboundMessage } from "../channel/types";
import { isTopic, getParentChatId } from "../channel/types";
import type { TgConfig } from "../config/schema";
import type { SessionManager } from "../session/manager";
import { isUserPaired } from "../security/allowlist";
import { addLinkedGroup, removeLinkedGroup, isLinkedGroup, updateLinkedGroupTitle } from "../config/schema";
import { saveConfig } from "../config/store";
import { handlePair } from "./handlers/pair";
import { handleHelp } from "./handlers/help";
import { handleSessionMgmt } from "./handlers/session-mgmt";
import { handleStdinInput } from "./handlers/stdin-input";
import { handleFilesCommand } from "./handlers/files";
import { logger } from "../daemon/logger";

export interface RouterContext {
  config: TgConfig;
  sessionManager: SessionManager;
  channel: Channel;
}

export async function routeMessage(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  let text = msg.text?.trim();
  if (!text) return;

  // Channel-agnostic command aliases for platforms where slash commands are not practical.
  if (text === "tg help") text = "/help";
  else if (text === "tg sessions") text = "/sessions";
  else if (text === "tg files" || text.startsWith("tg files ")) text = `/files${text.slice("tg files".length)}`;
  else if (text === "tg link" || text.startsWith("tg link ")) text = `/link${text.slice("tg link".length)}`;
  else if (text === "tg unlink") text = "/unlink";
  else if (text === "tg pair" || text.startsWith("tg pair ")) text = `/pair${text.slice("tg pair".length)}`;

  const userId = msg.userId;
  const chatId = msg.chatId;
  const { fmt } = ctx.channel;

  await logger.debug("Received message", {
    userId,
    chatId,
    isCommand: text.startsWith("/"),
    textLen: text.length,
  });

  // /pair is always available (for unpaired users)
  if (text.startsWith("/pair")) {
    await handlePair({ ...msg, text }, ctx);
    return;
  }

  // /start and /help are always available
  if (text === "/start" || text === "/help") {
    await handleHelp({ ...msg, text }, ctx);
    return;
  }

  // Everything else requires pairing
  if (!isUserPaired(ctx.config, userId)) {
    await ctx.channel.send(
      chatId,
      `You are not paired. Use /pair ${fmt.escape("<code>")} to pair.`
    );
    return;
  }

  if (
    msg.isGroup &&
    text !== "/link" &&
    !text.startsWith("/link ") &&
    text !== "/unlink" &&
    !isLinkedGroup(ctx.config, chatId)
  ) {
    await ctx.channel.send(chatId, `This group is not linked yet. Run ${fmt.code("/link")} first.`);
    return;
  }

  // Auto-update group title if it changed
  if (msg.isGroup && msg.chatTitle && !isTopic(chatId)) {
    if (updateLinkedGroupTitle(ctx.config, chatId, msg.chatTitle)) {
      await saveConfig(ctx.config);
    }
  }
  // Auto-update topic title if detected from Telegram
  if (msg.isGroup && msg.topicTitle && isTopic(chatId)) {
    if (updateLinkedGroupTitle(ctx.config, chatId, msg.topicTitle)) {
      await saveConfig(ctx.config);
    }
  }

  // /sessions — list active sessions
  if (text === "/sessions") {
    const sessions = ctx.sessionManager.listForUser(userId);
    if (sessions.length === 0) {
      await ctx.channel.send(chatId, "No active sessions.");
      return;
    }
    const attached = ctx.sessionManager.getAttachedRemote(chatId);
    const mainId = attached?.ownerUserId === userId ? attached.id : undefined;
    const lines = sessions.map((s) => {
      const label = s.id;
      const isMain = label === mainId;
      const marker = isMain ? " (connected)" : "";
      return `${fmt.code(label)} ${fmt.escape(s.command)}${marker}`;
    });
    await ctx.channel.send(chatId, lines.join("\n"));
    return;
  }

  // /files [query] — pick a repository file and insert as @path in next message
  if (text === "/files" || text.startsWith("/files ")) {
    const query = text.slice("/files".length).trim();
    await handleFilesCommand({ ...msg, text }, query, ctx);
    return;
  }

  // /link — register this group or topic with the bot
  if (text === "/link" || text.startsWith("/link ")) {
    if (!msg.isGroup) {
      await ctx.channel.send(chatId, "Use /link in a group or topic to register it with the bot.");
      return;
    }
    const linkArg = text.slice(5).trim(); // optional name for topics

    if (isTopic(chatId)) {
      // Auto-link parent group if not already linked
      const parentChat = getParentChatId(chatId);
      if (addLinkedGroup(ctx.config, parentChat, msg.chatTitle)) {
        await saveConfig(ctx.config);
      }
      // Require a name for topics (auto-detected or user-provided)
      const topicTitle = linkArg || msg.topicTitle;
      if (!topicTitle) {
        await ctx.channel.send(chatId, `Please provide a name: ${fmt.code("/link MyTopic")}`);
        return;
      }
      const added = addLinkedGroup(ctx.config, chatId, topicTitle);
      if (added) {
        await saveConfig(ctx.config);
        await ctx.channel.send(chatId, `Topic ${fmt.bold(fmt.escape(topicTitle))} linked.`);
      } else {
        await ctx.channel.send(chatId, `This topic is already linked.`);
      }
    } else {
      const added = addLinkedGroup(ctx.config, chatId, msg.chatTitle);
      if (added) {
        await saveConfig(ctx.config);
        await ctx.channel.send(chatId, `Group added as a channel. Use ${fmt.code("tg channels")} to see all channels.`);
      } else {
        await ctx.channel.send(chatId, `This group is already linked.`);
      }
    }
    return;
  }

  // /unlink — unregister this group/topic from the bot
  if (text === "/unlink") {
    if (!msg.isGroup) {
      await ctx.channel.send(chatId, "Use /unlink in a group or topic to unregister it.");
      return;
    }
    if (removeLinkedGroup(ctx.config, chatId)) {
      await saveConfig(ctx.config);
      await ctx.channel.send(chatId, isTopic(chatId) ? "Topic unlinked." : "Group unlinked.");
    } else {
      await ctx.channel.send(chatId, "This chat is not linked.");
    }
    return;
  }

  // tg <command> - session management
  if (text.startsWith("tg ")) {
    const args = text.slice(3).trim();

    // Session management commands
    if (["ls", "attach", "detach", "stop", "kill"].some((cmd) => args.startsWith(cmd))) {
      await handleSessionMgmt(msg, args, ctx);
      return;
    }

    await ctx.channel.send(
      chatId,
      `Unknown command. Use ${fmt.code("tg sessions")}, ${fmt.code("tg files [query]")}, ${fmt.code("tg attach <id>")}, ${fmt.code("tg detach")}, ${fmt.code("tg stop <id>")}, or ${fmt.code("tg kill <id>")}. Start sessions from your terminal with ${fmt.code("tg claude")}, ${fmt.code("tg codex")}, or ${fmt.code("tg pi")}.`
    );
    return;
  }

  // /message <text> → send to attached session (regular or remote)
  if (text.startsWith("/message ")) {
    const inputText = text.slice(9);
    if (inputText) {
      const syntheticMsg: InboundMessage = { ...msg, text: inputText };
      await handleStdinInput(syntheticMsg, ctx);
    }
    return;
  }

  // Non-command text → stdin of attached session
  await handleStdinInput(msg, ctx);
}
