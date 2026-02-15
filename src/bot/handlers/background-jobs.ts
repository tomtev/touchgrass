import type { Formatter } from "../../channel/formatter";
import type { ChannelChatId, ChannelUserId, InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";

export interface BackgroundJobSummary {
  taskId: string;
  command?: string;
  urls?: string[];
  updatedAt: number;
}

export interface BackgroundJobSessionSummary {
  sessionId: string;
  command: string;
  cwd: string;
  jobs: BackgroundJobSummary[];
}

function relativeAge(updatedAt: number): string {
  const deltaMs = Math.max(0, Date.now() - updatedAt);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderSessionHeader(
  fmt: Formatter,
  session: BackgroundJobSessionSummary
): string {
  const tool = session.command.split(/\s+/)[0] || "session";
  const dir = session.cwd.split("/").pop() || session.cwd || "cwd";
  return `${fmt.bold(fmt.escape(`${tool} (${dir})`))} ${fmt.escape("•")} ${fmt.code(fmt.escape(session.sessionId))}`;
}

export function formatBackgroundJobs(
  fmt: Formatter,
  sessions: BackgroundJobSessionSummary[]
): string {
  const running = sessions.reduce((acc, s) => acc + s.jobs.length, 0);
  const lines: string[] = [
    `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(`Background jobs (${running} running)`))}`,
  ];

  for (const session of sessions) {
    lines.push(renderSessionHeader(fmt, session));
    for (const job of session.jobs) {
      const cmd = (job.command || "running").trim();
      lines.push(
        `• ${fmt.code(fmt.escape(job.taskId))} ${fmt.escape("—")} ${fmt.escape(cmd)} ${fmt.escape(`(${relativeAge(job.updatedAt)})`)}`
      );
      const url = job.urls?.find((candidate) => /^https?:\/\//i.test(candidate));
      if (url) lines.push(`  ↳ ${fmt.link(fmt.escape(url), url)}`);
    }
  }

  return lines.join("\n");
}

export function emptyBackgroundJobsMessage(fmt: Formatter): string {
  return `${fmt.escape("⛳️")} ${fmt.escape("No running background jobs.")}`;
}

export function resolveBackgroundJobs(
  ctx: RouterContext,
  userId: ChannelUserId,
  chatId: ChannelChatId
) : BackgroundJobSessionSummary[] | Promise<BackgroundJobSessionSummary[]> {
  if (!ctx.listBackgroundJobs) return [];
  return ctx.listBackgroundJobs(userId, chatId);
}

export async function handleBackgroundJobsCommand(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  const sessions = await Promise.resolve(resolveBackgroundJobs(ctx, msg.userId, msg.chatId));
  if (sessions.length === 0) {
    await ctx.channel.send(msg.chatId, emptyBackgroundJobsMessage(ctx.channel.fmt));
    return;
  }
  await ctx.channel.send(msg.chatId, formatBackgroundJobs(ctx.channel.fmt, sessions));
}
