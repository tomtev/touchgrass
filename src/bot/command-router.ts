import type { Channel, InboundMessage, ChannelUserId } from "../channel/types";
import type { TgConfig } from "../config/schema";
import type { SessionManager } from "../session/manager";
import { isUserPaired } from "../security/allowlist";
import { escapeHtml } from "../channels/telegram/formatter";
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

  // /sessions — list active sessions
  if (text === "/sessions") {
    const sessions = ctx.sessionManager.list();
    if (sessions.length === 0) {
      await ctx.channel.send(chatId, "No active sessions.");
      return;
    }
    const attached = ctx.sessionManager.getAttached(chatId);
    const attachedRemote = ctx.sessionManager.getAttachedRemote(chatId);
    const mainId = attached?.id || attachedRemote?.id;
    const lines = sessions.map((s) => {
      const label = s.id;
      const isMain = label === mainId;
      const marker = isMain ? " (connected)" : "";
      return `<code>${label}</code> ${escapeHtml(s.command)}${marker}`;
    });
    await ctx.channel.send(chatId, lines.join("\n"));
    return;
  }

  // /connect <id> — connect this chat to a session
  if (text.startsWith("/connect")) {
    const sessionId = text.slice(8).trim();
    if (!sessionId) {
      await ctx.channel.send(chatId, "Usage: /connect &lt;session-id&gt;\nExample: <code>/connect r-abc123</code>");
      return;
    }
    if (ctx.sessionManager.attach(chatId, sessionId)) {
      // Subscribe group chats to session output
      if (msg.isGroup) {
        ctx.sessionManager.subscribeGroup(sessionId, chatId);
      }
      const remote = ctx.sessionManager.getRemote(sessionId);
      const label = remote?.name || remote?.cwd.split("/").pop() || sessionId;
      let reply = `Connected to <b>${escapeHtml(label)}</b> <i>(${sessionId})</i>`;
      if (msg.isGroup) {
        reply += `\n\n⚠️ For plain text messages to work in groups, disable <b>Group Privacy</b> in @BotFather (<code>/setprivacy</code> → Disable).`;
      }
      await ctx.channel.send(chatId, reply);
    } else {
      await ctx.channel.send(chatId, `Session <code>${sessionId}</code> not found.`);
    }
    return;
  }

  // /disconnect — disconnect this chat from its session
  if (text === "/disconnect") {
    const attached = ctx.sessionManager.getAttached(chatId);
    const attachedRemote = ctx.sessionManager.getAttachedRemote(chatId);
    const sessionId = attached?.id || attachedRemote?.id;
    if (sessionId) {
      ctx.sessionManager.detach(chatId);
      if (msg.isGroup) {
        ctx.sessionManager.unsubscribeGroup(sessionId, chatId);
      }
      await ctx.channel.send(chatId, `Disconnected from <i>(${sessionId})</i>`);
    } else {
      await ctx.channel.send(chatId, "Not connected to any session.");
    }
    return;
  }

  // /send <id> <text> — send message to a specific session
  if (text.startsWith("/send ")) {
    const rest = text.slice(6).trim();
    const match = rest.match(/^(r-[a-f0-9]+)\s+(.+)$/s);
    if (!match) {
      await ctx.channel.send(chatId, "Usage: <code>/send &lt;session-id&gt; &lt;text&gt;</code>");
      return;
    }
    const [, sessionId, input] = match;
    const remote = ctx.sessionManager.getRemote(sessionId);
    if (remote) {
      remote.inputQueue.push(input);
      return;
    }
    const session = ctx.sessionManager.get(sessionId);
    if (session && session.state === "running") {
      session.writeStdin(input);
      return;
    }
    await ctx.channel.send(chatId, `Session <code>${sessionId}</code> not found.`);
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
