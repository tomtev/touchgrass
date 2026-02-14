import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";

export async function handleSessionMgmt(
  msg: InboundMessage,
  args: string,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const userId = msg.userId;
  const { fmt } = ctx.channel;
  const parts = args.split(/\s+/);
  const subCmd = parts[0];
  const sessionId = parts[1];
  const safeSessionId = sessionId ? fmt.escape(sessionId) : "";

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
        return `${fmt.code(s.id)} [${s.state}] ${fmt.escape(s.command)}${marker}`;
      });
      await ctx.channel.send(chatId, lines.join("\n"));
      return;
    }

    case "attach": {
      if (!sessionId) {
        await ctx.channel.send(chatId, `Usage: ${fmt.code(`tg attach ${fmt.escape("<id>")}`)}`);
        return;
      }
      if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or exited.`);
        return;
      }
      if (ctx.sessionManager.attach(chatId, sessionId)) {
        await ctx.channel.send(chatId, `Attached to session ${fmt.code(safeSessionId)}.`);
      } else {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or exited.`);
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
        await ctx.channel.send(chatId, `Usage: ${fmt.code(`tg stop ${fmt.escape("<id>")}`)}`);
        return;
      }
      if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or already exited.`);
        return;
      }
      if (ctx.sessionManager.stopSession(sessionId) || ctx.sessionManager.requestRemoteStop(sessionId)) {
        await ctx.channel.send(chatId, `Sent stop to session ${fmt.code(safeSessionId)}.`);
      } else {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or already exited.`);
      }
      return;
    }

    case "kill": {
      if (!sessionId) {
        await ctx.channel.send(chatId, `Usage: ${fmt.code(`tg kill ${fmt.escape("<id>")}`)}`);
        return;
      }
      if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or already exited.`);
        return;
      }
      if (ctx.sessionManager.killSession(sessionId) || ctx.sessionManager.requestRemoteKill(sessionId)) {
        await ctx.channel.send(chatId, `Sent kill to session ${fmt.code(safeSessionId)}.`);
      } else {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or already exited.`);
      }
      return;
    }
  }
}
