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

interface StartControlCenterSessionArgs {
  chatId: ChannelChatId;
  userId: ChannelUserId;
  tool: "claude" | "codex" | "pi" | "kimi";
  projectName?: string;
  toolArgs?: string[];
}

interface StartControlCenterSessionResult {
  ok: boolean;
  error?: string;
  projectPath?: string;
}

interface StopChatSessionResult {
  ok: boolean;
  error?: string;
  sessionId?: string;
}

interface OpenControlCenterNewSessionArgs {
  chatId: ChannelChatId;
  userId: ChannelUserId;
  suggestedProjectName?: string;
}

interface OpenControlCenterNewSessionResult {
  ok: boolean;
  error?: string;
}

interface StartChatSessionArgs {
  chatId: ChannelChatId;
  userId: ChannelUserId;
  tool?: "claude" | "codex" | "pi" | "kimi";
  toolArgs?: string[];
}

interface StartChatSessionResult {
  ok: boolean;
  error?: string;
  projectPath?: string;
}

export interface RouterContext {
  config: TgConfig;
  channelName?: string;
  sessionManager: SessionManager;
  channel: Channel;
  listBackgroundJobs?: (
    userId: ChannelUserId,
    chatId: ChannelChatId
  ) => BackgroundJobSessionSummary[] | Promise<BackgroundJobSessionSummary[]>;
  isControlCenterActive?: () => Promise<boolean>;
  startControlCenterSession?: (args: StartControlCenterSessionArgs) => Promise<StartControlCenterSessionResult>;
  openControlCenterNewSession?: (
    args: OpenControlCenterNewSessionArgs
  ) => Promise<OpenControlCenterNewSessionResult>;
  stopSessionForChat?: (
    userId: ChannelUserId,
    chatId: ChannelChatId
  ) => Promise<StopChatSessionResult>;
  startSessionForChat?: (args: StartChatSessionArgs) => Promise<StartChatSessionResult>;
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
    isCampActive?: boolean;
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
  else if (text === "tg start" || text.startsWith("tg start ")) text = `/start${text.slice("tg start".length)}`;
  else if (text === "tg new" || text.startsWith("tg new ")) text = `/start${text.slice("tg new".length)}`;
  else if (text === "tg stop") text = "/kill";
  else if (text === "tg kill") text = "/kill";
  else if (text === "tg background_jobs" || text.startsWith("tg background_jobs ")) text = "/background_jobs";
  else if (text === "tg background-jobs" || text.startsWith("tg background-jobs ")) text = "/background-jobs";
  else if (text === "tg link" || text.startsWith("tg link ")) text = `/link${text.slice("tg link".length)}`;
  else if (text === "tg unlink") text = "/unlink";
  else if (text === "tg pair" || text.startsWith("tg pair ")) text = `/pair${text.slice("tg pair".length)}`;
  else if (text === "/stop") text = "/kill";

  const userId = msg.userId;
  const chatId = msg.chatId;
  const channelName = ctx.channelName || "telegram";
  const { fmt } = ctx.channel;
  const isGroup = !!msg.isGroup;
  const campActive = isGroup && ctx.isControlCenterActive ? await ctx.isControlCenterActive() : false;
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
    isCampActive: campActive,
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
      isCampActive: campActive,
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

  const isStartCommand = text === "/start" || text.startsWith("/start ");
  const isLegacyNewCommand = text === "/new" || text.startsWith("/new ");
  const isOpenSessionCommand = isStartCommand || isLegacyNewCommand;
  const isKillCommand = text === "/kill";

  if (
    isGroup &&
    text !== "/link" &&
    !text.startsWith("/link ") &&
    text !== "/unlink" &&
    !isOpenSessionCommand &&
    !isKillCommand &&
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

  if (text === "/mute" || text === "/unmute") {
    await ctx.channel.send(
      chatId,
      `${fmt.escape("⛳️")} ${fmt.code("/mute")} and ${fmt.code("/unmute")} were removed. Use ${fmt.code("/kill")} to stop and ${fmt.code("/start")} to start again.`
    );
    return;
  }

  if (isOpenSessionCommand) {
    const argsRaw = isLegacyNewCommand
      ? text.slice("/new".length).trim()
      : text.slice("/start".length).trim();
    const tokens = argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : [];
    let requestedTool: "claude" | "codex" | "pi" | "kimi" | undefined;
    if (tokens[0] && ["claude", "codex", "pi", "kimi"].includes(tokens[0].toLowerCase())) {
      requestedTool = tokens.shift()!.toLowerCase() as "claude" | "codex" | "pi" | "kimi";
    }
    const requestedArgs = tokens;

    // In normal (non-camp) mode, /start controls the already-attached tg wrapper.
    const attachedRemote = ctx.sessionManager.getAttachedRemote(chatId);
    if (attachedRemote) {
      if (attachedRemote.ownerUserId !== userId) {
        await ctx.channel.send(chatId, `${fmt.escape("⛳️")} Only the session owner can start this chat session.`);
        return;
      }
      if (argsRaw && !requestedTool) {
        await ctx.channel.send(
          chatId,
          `${fmt.escape("⛳️")} Usage: ${fmt.code("/start [claude|codex|pi|kimi] [args...]")}`
        );
        return;
      }
      if (!ctx.sessionManager.requestRemoteStart(attachedRemote.id, requestedTool, requestedArgs)) {
        await ctx.channel.send(chatId, `${fmt.escape("⛳️")} Could not request start for this session.`);
        return;
      }
      await ctx.channel.send(
        chatId,
        `${fmt.escape("⛳️")} Start requested for ${fmt.code(fmt.escape(attachedRemote.id))}.`
      );
      return;
    }

    if (!campActive) {
      if (ctx.startSessionForChat) {
        const started = await ctx.startSessionForChat({
          chatId,
          userId,
          ...(requestedTool ? { tool: requestedTool } : {}),
          ...(requestedArgs.length > 0 ? { toolArgs: requestedArgs } : {}),
        });
        if (started.ok) {
          await ctx.channel.send(
            chatId,
            `${fmt.escape("⛳️")} Starting ${fmt.code(requestedTool || "previous session tool")} in ${fmt.code(
              fmt.escape(started.projectPath || "project folder")
            )}...`
          );
          return;
        }
      }
      await ctx.channel.send(
        chatId,
        `${fmt.escape("⛳️")} Camp is not active for chat-launched sessions. ` +
          `${fmt.escape("For normal mode, start from terminal with")} ${fmt.code(`tg claude --channel ${chatId}`)} ` +
          `${fmt.escape("(or tg codex/tg pi/tg kimi).")} ` +
          `${fmt.escape("To launch directly from chat, run")} ${fmt.code("tg camp")} ${fmt.escape("from your projects root.")}`
      );
      return;
    }
    // If this group/topic is not linked yet, auto-link it when Camp is active.
    if (isGroup && !linked) {
      if (isTopic(chatId)) {
        const parentChat = getParentChatId(chatId);
        if (addLinkedGroup(ctx.config, parentChat, msg.chatTitle, channelName)) {
          await saveConfig(ctx.config);
        }
        const topicTitle = msg.topicTitle || msg.chatTitle || "Topic";
        if (addLinkedGroup(ctx.config, chatId, topicTitle, channelName)) {
          await saveConfig(ctx.config);
        }
      } else {
        if (addLinkedGroup(ctx.config, chatId, msg.chatTitle, channelName)) {
          await saveConfig(ctx.config);
        }
      }
      syncCommandMenuAsync(ctx, {
        userId,
        chatId,
        isPaired: true,
        isGroup,
        isLinkedGroup: isLinkedGroup(ctx.config, chatId, channelName),
        hasActiveSession: !!ctx.sessionManager.getAttachedRemote(chatId),
        isCampActive: campActive,
      });
    }

    const suggestedProjectName = tokens.join(" ").trim() || msg.topicTitle || msg.chatTitle || undefined;

    if (ctx.openControlCenterNewSession) {
      const opened = await ctx.openControlCenterNewSession({
        chatId,
        userId,
        suggestedProjectName,
      });
      if (!opened.ok) {
        await ctx.channel.send(chatId, `${fmt.escape("⛳️")} ${fmt.escape(opened.error || "Could not open new-session picker.")}`);
      }
      return;
    }

    if (!ctx.startControlCenterSession) {
      await ctx.channel.send(chatId, `${fmt.escape("⛳️")} This runtime cannot open /start from chat.`);
      return;
    }
    if (!requestedTool) {
      await ctx.channel.send(
        chatId,
        `${fmt.escape("⛳️")} Usage: ${fmt.code("/start claude|codex|pi|kimi [project-name]")}`
      );
      return;
    }

    const started = await ctx.startControlCenterSession({
      chatId,
      userId,
      tool: requestedTool,
      projectName: suggestedProjectName,
    });
    if (!started.ok) {
      await ctx.channel.send(chatId, `${fmt.escape("⛳️")} ${fmt.escape(started.error || "Could not start session.")}`);
      return;
    }
    await ctx.channel.send(
      chatId,
      `${fmt.escape("⛳️")} Starting ${fmt.code(requestedTool)} in ${fmt.code(fmt.escape(started.projectPath || "project folder"))}...`
    );
    return;
  }

  if (text === "/kill") {
    let stopped: StopChatSessionResult;
    if (ctx.stopSessionForChat) {
      stopped = await ctx.stopSessionForChat(userId, chatId);
    } else {
      const remote = ctx.sessionManager.getAttachedRemote(chatId);
      if (!remote) {
        stopped = { ok: false, error: "No active session is attached to this chat." };
      } else if (remote.ownerUserId !== userId) {
        stopped = { ok: false, error: "Only the session owner can kill this chat session." };
      } else if (!ctx.sessionManager.requestRemoteKill(remote.id)) {
        stopped = { ok: false, error: "Could not request kill for this session." };
      } else {
        stopped = { ok: true, sessionId: remote.id };
      }
    }
    if (!stopped.ok) {
      await ctx.channel.send(chatId, `${fmt.escape("⛳️")} ${fmt.escape(stopped.error || "No session to kill.")}`);
      return;
    }
    await ctx.channel.send(
      chatId,
      `${fmt.escape("⛳️")} Kill requested for ${fmt.code(fmt.escape(stopped.sessionId || "session"))}.`
    );
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
        isCampActive: campActive,
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
        isCampActive: campActive,
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
      isCampActive: campActive,
    });
    return;
  }

  // tg <command> - session management
  if (text.startsWith("tg ")) {
    const args = text.slice(3).trim();

    // Session management commands
    if (["ls", "attach", "detach", "stop", "kill", "session"].some((cmd) => args.startsWith(cmd))) {
      await handleSessionMgmt(msg, args, ctx);
      return;
    }

      await ctx.channel.send(
      chatId,
      `Unknown command. Use ${fmt.code("tg files [query]")}, ${fmt.code("tg session")}, ${fmt.code("tg resume")}, ${fmt.code("tg output_mode simple|verbose")}, ${fmt.code("tg thinking on|off|toggle")}, ${fmt.code("tg start [claude|codex|pi|kimi] [project]")}, ${fmt.code("tg kill")}, ${fmt.code("tg background-jobs")}, ${fmt.code("tg attach <id>")}, ${fmt.code("tg detach")}, ${fmt.code("tg stop <id>")}, or ${fmt.code("tg kill <id>")}. Start sessions from your terminal with ${fmt.code("tg claude")}, ${fmt.code("tg codex")}, ${fmt.code("tg pi")}, or ${fmt.code("tg kimi")}.`
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
