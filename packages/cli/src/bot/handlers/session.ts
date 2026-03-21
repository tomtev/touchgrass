import type { InboundMessage } from "../../channel/types";
import type { RemoteSession } from "../../session/manager";
import { readAgentSoul } from "../../daemon/agent-soul";
import type { RouterContext } from "../command-router";
import { basename } from "path";

type SessionTool = "claude" | "codex" | "pi" | "kimi" | "gemini";

function detectTool(command: string): SessionTool | null {
  const head = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (head === "claude" || head === "codex" || head === "pi" || head === "kimi" || head === "gemini") return head;
  return null;
}

function resolveTargetRemote(msg: InboundMessage, ctx: RouterContext): RemoteSession | null {
  const attached = ctx.sessionManager.getAttachedRemote(msg.chatId);
  if (attached && attached.ownerUserId === msg.userId) return attached;
  if (attached && attached.ownerUserId !== msg.userId) return null;

  const remotes = ctx.sessionManager.listRemotesForUser(msg.userId);
  if (remotes.length === 1 && !msg.isGroup) return remotes[0];
  return null;
}

export async function handleSessionCommand(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  const { fmt } = ctx.channel;
  const remote = resolveTargetRemote(msg, ctx);
  if (!remote) {
    await ctx.channel.send(
      msg.chatId,
      `No connected touchgrass session for this chat. Start with ${fmt.code("touchgrass claude")} (or ${fmt.code("touchgrass codex")}, ${fmt.code("touchgrass pi")}, ${fmt.code("touchgrass kimi")}) and connect this channel first.`
    );
    return;
  }

  const tool = detectTool(remote.command);
  const soul = remote.cwd ? await readAgentSoul(remote.cwd).catch(() => null) : null;
  const project = remote.cwd ? basename(remote.cwd) : "";
  const lines: string[] = [`${fmt.escape("⛳️")} ${fmt.bold(fmt.escape("Current session"))}`];

  if (remote.name) {
    lines.push(`${fmt.escape("Name:")} ${fmt.code(fmt.escape(remote.name))}`);
  }
  if (soul?.name && soul.name !== remote.name) {
    lines.push(`${fmt.escape("Agent:")} ${fmt.code(fmt.escape(soul.name))}`);
  }
  if (tool) {
    lines.push(`${fmt.escape("Tool:")} ${fmt.code(fmt.escape(tool))}`);
  }
  if (project) {
    lines.push(`${fmt.escape("Project:")} ${fmt.code(fmt.escape(project))}`);
  }

  await ctx.channel.send(msg.chatId, lines.join("\n"));
}
