import type { Channel, InboundMessage } from "../channel/types";
import type { TgConfig } from "../config/schema";
import type { SessionManager } from "../session/manager";
import { isUserPaired } from "../security/allowlist";
import { escapeHtml } from "../channels/telegram/formatter";
import { addLinkedGroup, removeLinkedGroup, isLinkedGroup, updateLinkedGroupTitle } from "../config/schema";
import { saveConfig } from "../config/store";
import { handlePair } from "./handlers/pair";
import { handleHelp } from "./handlers/help";
import { handleSpawn } from "./handlers/spawn";
import { handleSessionMgmt } from "./handlers/session-mgmt";
import { handleStdinInput } from "./handlers/stdin-input";
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
  const text = msg.text?.trim();
  if (!text) return;

  const userId = msg.userId;
  const chatId = msg.chatId;
  const username = msg.username;

  await logger.debug("Received message", {
    userId,
    chatId,
    isCommand: text.startsWith("/"),
    textLen: text.length,
  });

  // /pair is always available (for unpaired users)
  if (text.startsWith("/pair")) {
    await handlePair(msg, ctx);
    return;
  }

  // /start and /help are always available
  if (text === "/start" || text === "/help") {
    await handleHelp(msg, ctx);
    return;
  }

  // Everything else requires pairing
  if (!isUserPaired(ctx.config, userId)) {
    await ctx.channel.send(
      chatId,
      "You are not paired. Use /pair &lt;code&gt; to pair."
    );
    return;
  }

  if (
    msg.isGroup &&
    text !== "/link" &&
    !text.startsWith("/link ") &&
    !isLinkedGroup(ctx.config, chatId)
  ) {
    await ctx.channel.send(chatId, "This group is not linked yet. Run <code>/link</code> first.");
    return;
  }

  // Auto-update group title if it changed (skip topics — their names are user-provided via /link)
  if (msg.isGroup && msg.chatTitle && chatId.split(":").length < 3) {
    if (updateLinkedGroupTitle(ctx.config, chatId, msg.chatTitle)) {
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
    const attached = ctx.sessionManager.getAttached(chatId);
    const attachedRemote = ctx.sessionManager.getAttachedRemote(chatId);
    const attachedId = attached?.ownerUserId === userId ? attached.id : undefined;
    const attachedRemoteId = attachedRemote?.ownerUserId === userId ? attachedRemote.id : undefined;
    const mainId = attachedId || attachedRemoteId;
    const lines = sessions.map((s) => {
      const label = s.id;
      const isMain = label === mainId;
      const marker = isMain ? " (subscribed)" : "";
      return `<code>${label}</code> ${escapeHtml(s.command)}${marker}`;
    });
    await ctx.channel.send(chatId, lines.join("\n"));
    return;
  }

  // /link — register this group or topic with the bot
  if (text === "/link" || text.startsWith("/link ")) {
    if (!msg.isGroup) {
      await ctx.channel.send(chatId, "Use /link in a group or topic to register it with the bot.");
      return;
    }
    const linkArg = text.slice(5).trim(); // optional name for topics
    const isTopic = chatId.split(":").length >= 3;

    if (isTopic) {
      // Auto-link parent group if not already linked
      const parts = chatId.split(":");
      const parentChatId = `${parts[0]}:${parts[1]}`;
      if (addLinkedGroup(ctx.config, parentChatId, msg.chatTitle)) {
        await saveConfig(ctx.config);
      }
      // Link the topic with provided name or fallback
      const topicTitle = linkArg || "Topic";
      const added = addLinkedGroup(ctx.config, chatId, topicTitle);
      if (added) {
        await saveConfig(ctx.config);
        await ctx.channel.send(chatId, `Topic <b>${escapeHtml(topicTitle)}</b> linked.`);
      } else {
        await ctx.channel.send(chatId, `This topic is already linked.`);
      }
    } else {
      const added = addLinkedGroup(ctx.config, chatId, msg.chatTitle);
      if (added) {
        await saveConfig(ctx.config);
        await ctx.channel.send(chatId, `Group linked. Sessions can now be subscribed to this group.`);
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
      const isTopic = chatId.split(":").length >= 3;
      await ctx.channel.send(chatId, isTopic ? "Topic unlinked." : "Group unlinked.");
    } else {
      await ctx.channel.send(chatId, "This chat is not linked.");
    }
    return;
  }

  // /subscribe <id> — subscribe this chat to a session
  if (text.startsWith("/subscribe")) {
    const sessionId = text.slice(10).trim();
    if (!sessionId) {
      await ctx.channel.send(chatId, "Usage: /subscribe &lt;session-id&gt;\nExample: <code>/subscribe r-abc123</code>");
      return;
    }
    if (msg.isGroup && !isLinkedGroup(ctx.config, chatId)) {
      await ctx.channel.send(chatId, "This group is not linked yet. Run <code>/link</code> first.");
      return;
    }
    if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
      await ctx.channel.send(chatId, `Session <code>${escapeHtml(sessionId)}</code> not found.`);
      return;
    }
    if (ctx.sessionManager.attach(chatId, sessionId)) {
      // Subscribe group chats to session output
      if (msg.isGroup) {
        ctx.sessionManager.subscribeGroup(sessionId, chatId);
      }
      const remote = ctx.sessionManager.getRemote(sessionId);
      const label = remote?.cwd.split("/").pop() || sessionId;
      let reply = `Subscribed to <b>${escapeHtml(label)}</b> <i>(${escapeHtml(sessionId)})</i>`;
      if (msg.isGroup) {
        reply += `\n\n⚠️ For plain text messages to work in groups, disable <b>Group Privacy</b> in @BotFather (<code>/setprivacy</code> → Disable).`;
      }
      await ctx.channel.send(chatId, reply);
    } else {
      await ctx.channel.send(chatId, `Session <code>${escapeHtml(sessionId)}</code> not found.`);
    }
    return;
  }

  // /unsubscribe — unsubscribe this chat from its session
  if (text === "/unsubscribe") {
    const attached = ctx.sessionManager.getAttached(chatId);
    const attachedRemote = ctx.sessionManager.getAttachedRemote(chatId);
    const attachedId = attached?.ownerUserId === userId ? attached.id : undefined;
    const attachedRemoteId = attachedRemote?.ownerUserId === userId ? attachedRemote.id : undefined;
    const sessionId = attachedId || attachedRemoteId;
    if (sessionId) {
      ctx.sessionManager.detach(chatId);
      if (msg.isGroup) {
        ctx.sessionManager.unsubscribeGroup(sessionId, chatId);
      }
      await ctx.channel.send(chatId, `Unsubscribed from <i>(${escapeHtml(sessionId)})</i>`);
    } else {
      await ctx.channel.send(chatId, "Not subscribed to any session.");
    }
    return;
  }


  // tg <command> - session management and spawning
  if (text.startsWith("tg ")) {
    const args = text.slice(3).trim();

    // Session management commands
    if (["ls", "attach", "detach", "stop", "kill"].some((cmd) => args.startsWith(cmd))) {
      await handleSessionMgmt(msg, args, ctx);
      return;
    }

    // Spawn a new session
    await handleSpawn(msg, args, ctx);
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
