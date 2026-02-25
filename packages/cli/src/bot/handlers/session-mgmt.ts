import type { InboundMessage } from "../../channel/types";
import type { RemoteSession } from "../../session/manager";
import type { RouterContext } from "../command-router";
import { handleSessionCommand } from "./session";

type SessionTool = "claude" | "codex" | "pi" | "kimi";

function cleanToken(token: string | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim().replace(/^['"`]+|['"`]+$/g, "");
  return trimmed || null;
}

function detectTool(command: string): SessionTool | null {
  const head = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (head === "claude" || head === "codex" || head === "pi" || head === "kimi") return head;
  return null;
}

function extractResumeRef(tool: SessionTool, command: string): string | null {
  if (tool === "pi") {
    return cleanToken(command.match(/(?:^|\s)--session(?:=|\s+)([^\s]+)/i)?.[1]);
  }
  if (tool === "kimi") {
    return cleanToken(command.match(/(?:^|\s)(?:--session|-S)(?:=|\s+)([^\s]+)/i)?.[1]);
  }
  return cleanToken(
    command.match(/\bresume\s+([^\s]+)/i)?.[1] ||
    command.match(/\b--resume(?:=|\s+)([^\s]+)/i)?.[1]
  );
}

function resolveTargetRemote(
  msg: InboundMessage,
  sessionId: string | null,
  ctx: RouterContext
): RemoteSession | null {
  if (sessionId) {
    const remote = ctx.sessionManager.getRemote(sessionId);
    if (!remote || remote.ownerUserId !== msg.userId) return null;
    return remote;
  }

  const attached = ctx.sessionManager.getAttachedRemote(msg.chatId);
  if (attached && attached.ownerUserId === msg.userId) return attached;
  if (attached && attached.ownerUserId !== msg.userId) return null;

  const remotes = ctx.sessionManager.listRemotesForUser(msg.userId);
  if (remotes.length === 1 && !msg.isGroup) return remotes[0];
  return null;
}

function parseRestartArgs(parts: string[]): { sessionId: string | null; error?: string } {
  if (parts.length === 0) return { sessionId: null };
  if (parts.length > 1) {
    return { sessionId: null, error: "Usage: touchgrass restart [<tg_session_id>]" };
  }

  const arg = parts[0];
  if (!arg || arg.startsWith("--")) {
    return { sessionId: null, error: "Usage: touchgrass restart [<tg_session_id>]" };
  }
  return { sessionId: arg };
}

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
    case "session": {
      await handleSessionCommand(msg, ctx);
      return;
    }

    case "ls": {
      const sessions = ctx.sessionManager.listForUser(userId);
      if (sessions.length === 0) {
        await ctx.channel.send(chatId, "No active sessions.");
        return;
      }
      const attachedRemote = ctx.sessionManager.getAttachedRemote(chatId);
      const attachedRemoteId = attachedRemote?.ownerUserId === userId ? attachedRemote.id : undefined;
      const lines = sessions.map((s) => {
        const isAttached = attachedRemoteId === s.id;
        const marker = isAttached ? " (attached)" : "";
        return `${fmt.code(s.id)} [${s.state}] ${fmt.escape(s.command)}${marker}`;
      });
      await ctx.channel.send(chatId, lines.join("\n"));
      return;
    }

    case "attach": {
      if (!sessionId) {
        await ctx.channel.send(chatId, `Usage: ${fmt.code(`touchgrass attach ${fmt.escape("<id>")}`)}`);
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
        await ctx.channel.send(chatId, `Usage: ${fmt.code(`touchgrass stop ${fmt.escape("<id>")}`)}`);
        return;
      }
      if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or already exited.`);
        return;
      }
      if (ctx.sessionManager.requestRemoteStop(sessionId)) {
        await ctx.channel.send(chatId, `Sent stop to session ${fmt.code(safeSessionId)}.`);
      } else {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or already exited.`);
      }
      return;
    }

    case "kill": {
      if (!sessionId) {
        await ctx.channel.send(chatId, `Usage: ${fmt.code(`touchgrass kill ${fmt.escape("<id>")}`)}`);
        return;
      }
      if (!ctx.sessionManager.canUserAccessSession(userId, sessionId)) {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or already exited.`);
        return;
      }
      if (ctx.sessionManager.requestRemoteKill(sessionId)) {
        await ctx.channel.send(chatId, `Sent kill to session ${fmt.code(safeSessionId)}.`);
      } else {
        await ctx.channel.send(chatId, `Session ${fmt.code(safeSessionId)} not found or already exited.`);
      }
      return;
    }

    case "restart": {
      const parsed = parseRestartArgs(parts.slice(1));
      if (parsed.error) {
        await ctx.channel.send(chatId, fmt.escape(parsed.error));
        return;
      }

      const target = resolveTargetRemote(msg, parsed.sessionId || null, ctx);
      if (!target) {
        if (parsed.sessionId) {
          await ctx.channel.send(chatId, `Session ${fmt.code(fmt.escape(parsed.sessionId))} not found or already exited.`);
          return;
        }
        await ctx.channel.send(
          chatId,
          `No connected session for this chat. Use ${fmt.code("/session")} to inspect the active bridge first.`
        );
        return;
      }

      let sessionRef: string | null = null;
      const tool = detectTool(target.command);
      if (tool) {
        sessionRef = extractResumeRef(tool, target.command);
      }

      if (!sessionRef) {
        await ctx.channel.send(
          chatId,
          `Could not infer a tool session ID from the current command. Use ${fmt.code("/resume")} first, then ${fmt.code(`touchgrass restart ${fmt.escape(target.id)}`)}.`
        );
        return;
      }

      if (!ctx.sessionManager.requestRemoteResume(target.id, sessionRef)) {
        await ctx.channel.send(chatId, `Session ${fmt.code(fmt.escape(target.id))} not found or already exited.`);
        return;
      }

      await ctx.channel.send(
        chatId,
        `Requested restart for touchgrass session ${fmt.code(fmt.escape(target.id))} using tool session ${fmt.code(fmt.escape(sessionRef))}.`
      );
      return;
    }
  }
}
