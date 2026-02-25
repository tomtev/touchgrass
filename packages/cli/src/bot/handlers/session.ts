import type { InboundMessage } from "../../channel/types";
import type { RemoteSession } from "../../session/manager";
import type { RouterContext } from "../command-router";

type SessionTool = "claude" | "codex" | "pi" | "kimi";

function detectTool(command: string): SessionTool | null {
  const head = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (head === "claude" || head === "codex" || head === "pi" || head === "kimi") return head;
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

function cleanToken(token: string | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim().replace(/^['"`]+|['"`]+$/g, "");
  return trimmed || null;
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

function resumeTemplate(tool: SessionTool): string {
  if (tool === "pi") return "touchgrass pi --session <pi_session_id>";
  if (tool === "kimi") return "touchgrass kimi --session <kimi_session_id>";
  if (tool === "claude") return "touchgrass claude resume <claude_session_id>";
  return "touchgrass codex resume <codex_session_id>";
}

function resumeCommand(tool: SessionTool, sessionRef: string): string {
  if (tool === "pi" || tool === "kimi") return `touchgrass ${tool} --session ${sessionRef}`;
  return `touchgrass ${tool} resume ${sessionRef}`;
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
  const lines: string[] = [
    `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape("Current touchgrass session"))}`,
    `${fmt.escape("touchgrass session ID:")} ${fmt.code(fmt.escape(remote.id))}`,
  ];

  if (tool) {
    lines.push(`${fmt.escape("Tool:")} ${fmt.code(fmt.escape(tool))}`);
  }
  if (remote.cwd) {
    lines.push(`${fmt.escape("Project:")} ${fmt.code(fmt.escape(remote.cwd))}`);
  }

  lines.push(`${fmt.escape("Resume picker:")} ${fmt.code("/resume")} ${fmt.escape("or")} ${fmt.code("touchgrass resume")}`);

  if (tool) {
    const ref = extractResumeRef(tool, remote.command);
    if (ref) {
      lines.push(`${fmt.escape("Tool session ID:")} ${fmt.code(fmt.escape(ref))}`);
      lines.push(`${fmt.escape("Direct tool resume:")} ${fmt.code(fmt.escape(resumeCommand(tool, ref)))}`);
      lines.push(`${fmt.escape("Restart wrapper on same tool session:")} ${fmt.code(fmt.escape(`touchgrass restart ${remote.id}`))}`);
    } else {
      lines.push(`${fmt.escape("Tool session ID:")} ${fmt.escape("not detected from current command")}`);
      lines.push(`${fmt.escape("Tool resume command:")} ${fmt.code(fmt.escape(resumeTemplate(tool)))}`);
      lines.push(`${fmt.escape("Restart wrapper command:")} ${fmt.code(fmt.escape(`touchgrass restart ${remote.id}`))}`);
      lines.push(`${fmt.escape("If restart cannot infer a tool session, use")} ${fmt.code("/resume")} ${fmt.escape("first.")}`);
    }
  }

  await ctx.channel.send(msg.chatId, lines.join("\n"));
}
