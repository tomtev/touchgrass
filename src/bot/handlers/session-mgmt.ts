import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import { escapeHtml } from "../../channels/telegram/formatter";

export async function handleSessionMgmt(
  msg: InboundMessage,
  args: string,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const userId = msg.userId;
  const parts = args.split(/\s+/);
  const subCmd = parts[0];
  const sessionId = parts[1];
  const safeSessionId = sessionId ? escapeHtml(sessionId) : "";

  switch (subCmd) {
    case "ls": {
      const sessions = ctx.sessionManager.listForUser(userId);
      if (sessions.length === 0) {
        await ctx.channel.send(chatId, "No active sessions.");
        return;
      }
      const attached = ctx.sessionManager.getAttached(chatId);
      const attachedRemote = ctx.sessionManager.getAttachedRemote(chatId);
      const attachedId = attached?.ownerUserId === userId ? attached.id : undefined;
      const attachedRemoteId = attachedRemote?.ownerUserId === userId ? attachedRemote.id : undefined;
      const lines = sessions.map((s) => {
        const isAttached = attachedId === s.id || attachedRemoteId === s.id;
        const marker = isAttached ? " (attached)" : "";
        return `<code>${s.id}</code> [${s.state}] ${escapeHtml(s.command)}${marker}`;
      });
      await ctx.channel.send(chatId, lines.join("\n"));
      return;
    }

    case "attach": {
      if (!sessionId) {
        await ctx.channel.send(chatId, "Usage: <code>tg attach &lt;id&gt;</code>");
        return;
      }
      if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
        await ctx.channel.send(chatId, `Session <code>${safeSessionId}</code> not found or exited.`);
        return;
      }
      if (ctx.sessionManager.attach(chatId, sessionId)) {
        await ctx.channel.send(chatId, `Attached to session <code>${safeSessionId}</code>.`);
      } else {
        await ctx.channel.send(chatId, `Session <code>${safeSessionId}</code> not found or exited.`);
      }
      return;
    }

    case "detach": {
      if (ctx.sessionManager.detach(chatId)) {
        await ctx.channel.send(chatId, "Detached.");
      } else {
        await ctx.channel.send(chatId, "Not attached to any session.");
      }
      return;
    }

    case "stop": {
      if (!sessionId) {
        await ctx.channel.send(chatId, "Usage: <code>tg stop &lt;id&gt;</code>");
        return;
      }
      if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
        await ctx.channel.send(chatId, `Session <code>${safeSessionId}</code> not found or already exited.`);
        return;
      }
      if (ctx.sessionManager.stopSession(sessionId)) {
        await ctx.channel.send(chatId, `Sent SIGTERM to session <code>${safeSessionId}</code>.`);
      } else {
        await ctx.channel.send(chatId, `Session <code>${safeSessionId}</code> not found or already exited.`);
      }
      return;
    }

    case "kill": {
      if (!sessionId) {
        await ctx.channel.send(chatId, "Usage: <code>tg kill &lt;id&gt;</code>");
        return;
      }
      if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
        await ctx.channel.send(chatId, `Session <code>${safeSessionId}</code> not found or already exited.`);
        return;
      }
      if (ctx.sessionManager.killSession(sessionId)) {
        await ctx.channel.send(chatId, `Sent SIGKILL to session <code>${safeSessionId}</code>.`);
      } else {
        await ctx.channel.send(chatId, `Session <code>${safeSessionId}</code> not found or already exited.`);
      }
      return;
    }
  }
}
