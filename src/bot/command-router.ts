import type { Channel, ChannelChatId, ChannelUserId, InboundMessage } from "../channel/types";
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
import { handleFilesCommand, handleInlineFileSearch } from "./handlers/files";
import { handleResumeCommand } from "./handlers/resume";
import {
  handleBackgroundJobsCommand,
  type BackgroundJobSessionSummary,
} from "./handlers/background-jobs";
import { logger } from "../daemon/logger";

export interface RouterContext {
  config: TgConfig;
  sessionManager: SessionManager;
  channel: Channel;
  listBackgroundJobs?: (
    userId: ChannelUserId,
    chatId: ChannelChatId
  ) => BackgroundJobSessionSummary[] | Promise<BackgroundJobSessionSummary[]>;
}

export async function routeMessage(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  let text = msg.text?.trim();
  if (!text) return;

  // Channel-agnostic command aliases for platforms where slash commands are not practical.
  if (text === "tg files" || text.startsWith("tg files ")) text = `/files${text.slice("tg files".length)}`;
  else if (text === "tg resume") text = "/resume";
  else if (text === "tg background_jobs" || text.startsWith("tg background_jobs ")) text = "/background_jobs";
  else if (text === "tg background-jobs" || text.startsWith("tg background-jobs ")) text = "/background-jobs";
  else if (text === "tg link" || text.startsWith("tg link ")) text = `/link${text.slice("tg link".length)}`;
  else if (text === "tg unlink") text = "/unlink";
  else if (text === "tg pair" || text.startsWith("tg pair ")) text = `/pair${text.slice("tg pair".length)}`;

  const userId = msg.userId;
  const chatId = msg.chatId;
  const { fmt } = ctx.channel;
  const isGroup = !!msg.isGroup;
  const linked = isLinkedGroup(ctx.config, chatId);
  const paired = isUserPaired(ctx.config, userId);

  await ctx.channel.syncCommandMenu?.({
    userId,
    chatId,
    isPaired: paired,
    isGroup,
    isLinkedGroup: linked,
  });

  await logger.debug("Received message", {
    userId,
    chatId,
    isCommand: text.startsWith("/"),
    textLen: text.length,
  });

  // /pair is always available (for unpaired users)
  if (text.startsWith("/pair")) {
    await handlePair({ ...msg, text }, ctx);
    await ctx.channel.syncCommandMenu?.({
      userId,
      chatId,
      isPaired: isUserPaired(ctx.config, userId),
      isGroup,
      isLinkedGroup: isLinkedGroup(ctx.config, chatId),
    });
    return;
  }

  // /start is always available
  if (text === "/start") {
    await handleHelp({ ...msg, text }, ctx);
    return;
  }

  if (text === "/help") {
    await ctx.channel.send(chatId, `Use ${fmt.code("/start")} to see available commands.`);
    return;
  }

  // Everything else requires pairing
  if (!paired) {
    await ctx.channel.send(
      chatId,
      `You are not paired. Use /pair ${fmt.escape("<code>")} to pair.`
    );
    return;
  }

  if (text === "/sessions") {
    await ctx.channel.send(chatId, `The ${fmt.code("/sessions")} command was removed. Use ${fmt.code("tg ls")} in your terminal.`);
    return;
  }

  if (
    isGroup &&
    text !== "/link" &&
    !text.startsWith("/link ") &&
    text !== "/unlink" &&
    !linked
  ) {
    await ctx.channel.send(chatId, `This group is not linked yet. Run ${fmt.code("/link")} first.`);
    return;
  }

  // Auto-update group title if it changed
  if (isGroup && msg.chatTitle && !isTopic(chatId)) {
    if (updateLinkedGroupTitle(ctx.config, chatId, msg.chatTitle)) {
      await saveConfig(ctx.config);
    }
  }
  // Auto-update topic title if detected from Telegram
  if (isGroup && msg.topicTitle && isTopic(chatId)) {
    if (updateLinkedGroupTitle(ctx.config, chatId, msg.topicTitle)) {
      await saveConfig(ctx.config);
    }
  }

  // /files [query] — pick a repository file and insert as @path in next message
  if (text === "/files" || text.startsWith("/files ")) {
    const query = text.slice("/files".length).trim();
    await handleFilesCommand({ ...msg, text }, query, ctx);
    return;
  }

  // /resume — pick a prior session and restart the connected tool with it
  if (text === "/resume") {
    await handleResumeCommand({ ...msg, text }, ctx);
    return;
  }

  // /background-jobs — list currently running background jobs
  if (text === "/background-jobs" || text === "/background_jobs") {
    await handleBackgroundJobsCommand({ ...msg, text }, ctx);
    return;
  }

  // @?query → file picker, @?query - prompt → resolve top path and send
  if (text.startsWith("@?")) {
    const handled = await handleInlineFileSearch({ ...msg, text }, text, ctx);
    if (handled) return;
  }

  // /link — register this group or topic with the bot
  if (text === "/link" || text.startsWith("/link ")) {
    if (!isGroup) {
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
      await ctx.channel.syncCommandMenu?.({
        userId,
        chatId,
        isPaired: true,
        isGroup,
        isLinkedGroup: isLinkedGroup(ctx.config, chatId),
      });
    } else {
      const added = addLinkedGroup(ctx.config, chatId, msg.chatTitle);
      if (added) {
        await saveConfig(ctx.config);
        await ctx.channel.send(chatId, `Group added as a channel. Use ${fmt.code("tg channels")} to see all channels.`);
      } else {
        await ctx.channel.send(chatId, `This group is already linked.`);
      }
      await ctx.channel.syncCommandMenu?.({
        userId,
        chatId,
        isPaired: true,
        isGroup,
        isLinkedGroup: isLinkedGroup(ctx.config, chatId),
      });
    }
    return;
  }

  // /unlink — unregister this group/topic from the bot
  if (text === "/unlink") {
    if (!isGroup) {
      await ctx.channel.send(chatId, "Use /unlink in a group or topic to unregister it.");
      return;
    }
    if (removeLinkedGroup(ctx.config, chatId)) {
      await saveConfig(ctx.config);
      await ctx.channel.send(chatId, isTopic(chatId) ? "Topic unlinked." : "Group unlinked.");
    } else {
      await ctx.channel.send(chatId, "This chat is not linked.");
    }
    await ctx.channel.syncCommandMenu?.({
      userId,
      chatId,
      isPaired: true,
      isGroup,
      isLinkedGroup: isLinkedGroup(ctx.config, chatId),
    });
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
      `Unknown command. Use ${fmt.code("tg files [query]")}, ${fmt.code("tg resume")}, ${fmt.code("tg background-jobs")}, ${fmt.code("tg attach <id>")}, ${fmt.code("tg detach")}, ${fmt.code("tg stop <id>")}, or ${fmt.code("tg kill <id>")}. Start sessions from your terminal with ${fmt.code("tg claude")}, ${fmt.code("tg codex")}, or ${fmt.code("tg pi")}.`
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
