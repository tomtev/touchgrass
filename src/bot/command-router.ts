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
import { handleSessionCommand } from "./handlers/session";
import { handleOutputModeCommand } from "./handlers/output-mode";
import { handleThinkingCommand } from "./handlers/thinking";
import {
  handleBackgroundJobsCommand,
  type BackgroundJobSessionSummary,
} from "./handlers/background-jobs";
import { logger } from "../daemon/logger";

export interface RouterContext {
  config: TgConfig;
  channelName?: string;
  sessionManager: SessionManager;
  channel: Channel;
  listBackgroundJobs?: (
    userId: ChannelUserId,
    chatId: ChannelChatId
  ) => BackgroundJobSessionSummary[] | Promise<BackgroundJobSessionSummary[]>;
}

function syncCommandMenuAsync(
  ctx: RouterContext,
  args: {
    userId: ChannelUserId;
    chatId: ChannelChatId;
    isPaired: boolean;
    isGroup: boolean;
    isLinkedGroup: boolean;
    hasActiveSession: boolean;
  }
): void {
  const sync = ctx.channel.syncCommandMenu;
  if (!sync) return;
  void sync.call(ctx.channel, args).catch(async (error: unknown) => {
    await logger.debug("Command menu sync failed", {
      chatId: args.chatId,
      userId: args.userId,
      error: (error as Error)?.message ?? String(error),
    });
  });
}

export async function routeMessage(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  let text = msg.text?.trim();
  if (!text) return;

  // Telegram group commands can arrive as /command@BotName.
  // Normalize to /command so command matching works consistently.
  text = text.replace(/^\/([a-z0-9_]+)@[^\s]+(?=\s|$)/i, "/$1");

  // Channel-agnostic command aliases for platforms where slash commands are not practical.
  if (text === "tg files" || text.startsWith("tg files ")) text = `/files${text.slice("tg files".length)}`;
  else if (text === "tg session") text = "/session";
  else if (text === "tg resume") text = "/resume";
  else if (text === "tg output_mode" || text.startsWith("tg output_mode ")) text = `/output_mode${text.slice("tg output_mode".length)}`;
  else if (text === "tg output-mode" || text.startsWith("tg output-mode ")) text = `/output_mode${text.slice("tg output-mode".length)}`;
  else if (text === "tg thinking" || text.startsWith("tg thinking ")) text = `/thinking${text.slice("tg thinking".length)}`;
  else if (text === "tg background_jobs" || text.startsWith("tg background_jobs ")) text = "/background_jobs";
  else if (text === "tg background-jobs" || text.startsWith("tg background-jobs ")) text = "/background-jobs";
  else if (text === "tg link" || text.startsWith("tg link ")) text = `/link${text.slice("tg link".length)}`;
  else if (text === "tg unlink") text = "/unlink";
  else if (text === "tg pair" || text.startsWith("tg pair ")) text = `/pair${text.slice("tg pair".length)}`;

  const userId = msg.userId;
  const chatId = msg.chatId;
  const channelName = ctx.channelName || "telegram";
  const { fmt } = ctx.channel;
  const isGroup = !!msg.isGroup;
  const linked = isLinkedGroup(ctx.config, chatId, channelName);
  const paired = isUserPaired(ctx.config, userId);
  const hasActiveSession = !!ctx.sessionManager.getAttachedRemote(chatId);

  syncCommandMenuAsync(ctx, {
    userId,
    chatId,
    isPaired: paired,
    isGroup,
    isLinkedGroup: linked,
    hasActiveSession,
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
    syncCommandMenuAsync(ctx, {
      userId,
      chatId,
      isPaired: isUserPaired(ctx.config, userId),
      isGroup,
      isLinkedGroup: isLinkedGroup(ctx.config, chatId, channelName),
      hasActiveSession: !!ctx.sessionManager.getAttachedRemote(chatId),
    });
    return;
  }

  // /start in DM keeps Telegram onboarding/help behavior.
  if (!isGroup && (text === "/start" || text.startsWith("/start "))) {
    await handleHelp({ ...msg, text }, ctx);
    return;
  }

  if (text === "/help") {
    await handleHelp({ ...msg, text }, ctx);
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

  if (text === "/mute" || text === "/unmute" || text === "/stop" || text === "/kill" || text === "/new" || text === "/start" || text.startsWith("/start ") || text.startsWith("/new ")) {
    await ctx.channel.send(
      chatId,
      `${fmt.escape("⛳️ Chat-side session start/stop was removed. Start sessions from your terminal with")} ${fmt.code("tg claude")}, ${fmt.code("tg codex")}, ${fmt.code("tg pi")}, ${fmt.code("tg kimi")} ${fmt.escape("and use")} ${fmt.code("tg stop <id>")} ${fmt.escape("or")} ${fmt.code("tg kill <id>")} ${fmt.escape("from terminal when needed.")}`
    );
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
    if (updateLinkedGroupTitle(ctx.config, chatId, msg.chatTitle, channelName)) {
      await saveConfig(ctx.config);
    }
  }
  // Auto-update topic title if detected from Telegram
  if (isGroup && msg.topicTitle && isTopic(chatId)) {
    if (updateLinkedGroupTitle(ctx.config, chatId, msg.topicTitle, channelName)) {
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

  // /session — show current connected session + resume commands
  if (text === "/session") {
    await handleSessionCommand({ ...msg, text }, ctx);
    return;
  }

  // /background-jobs — list currently running background jobs
  if (text === "/background-jobs" || text === "/background_jobs") {
    await handleBackgroundJobsCommand({ ...msg, text }, ctx);
    return;
  }

  // /output_mode [simple|verbose] — choose how noisy bridge output should be
  if (text === "/output_mode" || text === "/output-mode" || text.startsWith("/output_mode ") || text.startsWith("/output-mode ")) {
    const modeArg = text.replace(/^\/output(?:_|-)mode/i, "").trim() || undefined;
    await handleOutputModeCommand({ ...msg, text }, modeArg, ctx);
    return;
  }

  // /thinking [on|off|toggle] — control thinking previews for this chat
  if (text === "/thinking" || text.startsWith("/thinking ")) {
    const toggleArg = text.replace(/^\/thinking/i, "").trim() || undefined;
    await handleThinkingCommand({ ...msg, text }, toggleArg, ctx);
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
      if (addLinkedGroup(ctx.config, parentChat, msg.chatTitle, channelName)) {
        await saveConfig(ctx.config);
      }
      // Require a name for topics (auto-detected or user-provided)
      const topicTitle = linkArg || msg.topicTitle;
      if (!topicTitle) {
        await ctx.channel.send(chatId, `Please provide a name: ${fmt.code("/link MyTopic")}`);
        return;
      }
      const added = addLinkedGroup(ctx.config, chatId, topicTitle, channelName);
      if (added) {
        await saveConfig(ctx.config);
        await ctx.channel.send(chatId, `Topic ${fmt.bold(fmt.escape(topicTitle))} linked.`);
      } else {
        await ctx.channel.send(chatId, `This topic is already linked.`);
      }
      syncCommandMenuAsync(ctx, {
        userId,
        chatId,
        isPaired: true,
        isGroup,
        isLinkedGroup: isLinkedGroup(ctx.config, chatId, channelName),
        hasActiveSession: !!ctx.sessionManager.getAttachedRemote(chatId),
      });
    } else {
      const added = addLinkedGroup(ctx.config, chatId, msg.chatTitle, channelName);
      if (added) {
        await saveConfig(ctx.config);
        await ctx.channel.send(chatId, `Group added as a channel. Use ${fmt.code("tg channels")} to see all channels.`);
      } else {
        await ctx.channel.send(chatId, `This group is already linked.`);
      }
      syncCommandMenuAsync(ctx, {
        userId,
        chatId,
        isPaired: true,
        isGroup,
        isLinkedGroup: isLinkedGroup(ctx.config, chatId, channelName),
        hasActiveSession: !!ctx.sessionManager.getAttachedRemote(chatId),
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
    if (removeLinkedGroup(ctx.config, chatId, channelName)) {
      await saveConfig(ctx.config);
      await ctx.channel.send(chatId, isTopic(chatId) ? "Topic unlinked." : "Group unlinked.");
    } else {
      await ctx.channel.send(chatId, "This chat is not linked.");
    }
    syncCommandMenuAsync(ctx, {
      userId,
      chatId,
      isPaired: true,
      isGroup,
      isLinkedGroup: isLinkedGroup(ctx.config, chatId, channelName),
      hasActiveSession: !!ctx.sessionManager.getAttachedRemote(chatId),
    });
    return;
  }

  // tg <command> - session management
  if (text.startsWith("tg ")) {
    const args = text.slice(3).trim();

    // Session management commands
    if (["ls", "attach", "detach", "stop", "kill", "restart", "session"].some((cmd) => args.startsWith(cmd))) {
      await handleSessionMgmt(msg, args, ctx);
      return;
    }

      await ctx.channel.send(
      chatId,
      `Unknown command. Use ${fmt.code("tg files [query]")}, ${fmt.code("tg session")}, ${fmt.code("tg resume")}, ${fmt.code("tg output_mode simple|verbose")}, ${fmt.code("tg thinking on|off|toggle")}, ${fmt.code("tg background-jobs")}, ${fmt.code("tg attach <id>")}, ${fmt.code("tg detach")}, ${fmt.code("tg stop <id>")}, ${fmt.code("tg kill <id>")}, or ${fmt.code("tg restart [tg_session_id]")}. Start sessions from your terminal with ${fmt.code("tg claude")}, ${fmt.code("tg codex")}, ${fmt.code("tg pi")}, or ${fmt.code("tg kimi")}.`
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
