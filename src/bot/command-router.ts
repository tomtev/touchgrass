import type { Channel, InboundMessage } from "../channel/types";
import type { TgConfig } from "../config/schema";
import type { SessionManager } from "../session/manager";
import { isUserPaired } from "../security/allowlist";
import { escapeHtml } from "../channels/telegram/formatter";
import { addLinkedGroup, updateLinkedGroupTitle } from "../config/schema";
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

  await logger.debug("Received message", { userId, chatId, text: text.slice(0, 100) });

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

  // Auto-update group title if it changed
  if (msg.isGroup && msg.chatTitle) {
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
      const marker = isMain ? " (bound)" : "";
      return `<code>${label}</code> ${escapeHtml(s.command)}${marker}`;
    });
    await ctx.channel.send(chatId, lines.join("\n"));
    return;
  }

  // /link — register this group with the bot
  if (text === "/link") {
    if (!msg.isGroup) {
      await ctx.channel.send(chatId, "Use /link in a group to register it with the bot.");
      return;
    }
    const added = addLinkedGroup(ctx.config, chatId, msg.chatTitle);
    if (added) {
      await saveConfig(ctx.config);
      await ctx.channel.send(chatId, `Group linked. Sessions can now be bound to this group.`);
    } else {
      await ctx.channel.send(chatId, `This group is already linked.`);
    }
    return;
  }

  // /bind <id> — bind this chat to a session
  if (text.startsWith("/bind")) {
    const sessionId = text.slice(5).trim();
    if (!sessionId) {
      await ctx.channel.send(chatId, "Usage: /bind &lt;session-id&gt;\nExample: <code>/bind r-abc123</code>");
      return;
    }
    if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
      await ctx.channel.send(chatId, `Session <code>${sessionId}</code> not found.`);
      return;
    }
    if (ctx.sessionManager.attach(chatId, sessionId)) {
      // Subscribe group chats to session output
      if (msg.isGroup) {
        ctx.sessionManager.subscribeGroup(sessionId, chatId);
      }
      const remote = ctx.sessionManager.getRemote(sessionId);
      const label = remote?.name || remote?.cwd.split("/").pop() || sessionId;
      let reply = `Bound to <b>${escapeHtml(label)}</b> <i>(${sessionId})</i>`;
      if (msg.isGroup) {
        reply += `\n\n⚠️ For plain text messages to work in groups, disable <b>Group Privacy</b> in @BotFather (<code>/setprivacy</code> → Disable).`;
      }
      await ctx.channel.send(chatId, reply);
    } else {
      await ctx.channel.send(chatId, `Session <code>${sessionId}</code> not found.`);
    }
    return;
  }

  // /unbind — unbind this chat from its session
  if (text === "/unbind") {
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
      await ctx.channel.send(chatId, `Unbound from <i>(${sessionId})</i>`);
    } else {
      await ctx.channel.send(chatId, "Not bound to any session.");
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
