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

const MAX_RENDERED_JOBS_PER_SESSION = 5;
const MAX_COMMAND_PREVIEW = 90;

function compactCommand(command?: string): string {
  const raw = (command || "running").trim();
  if (!raw) return "running";
  if (raw.length <= MAX_COMMAND_PREVIEW) return raw;
  return `${raw.slice(0, MAX_COMMAND_PREVIEW - 3)}...`;
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
    const visible = session.jobs.slice(0, MAX_RENDERED_JOBS_PER_SESSION);
    for (const job of visible) {
      const url = job.urls?.find((candidate) => /^https?:\/\//i.test(candidate));
      if (url) {
        lines.push(
          `• ${fmt.code(fmt.escape(job.taskId))} ${fmt.escape(`(${relativeAge(job.updatedAt)})`)}`
        );
        lines.push(`  ↳ ${fmt.link(fmt.escape(url), url)}`);
        continue;
      }

      const cmd = compactCommand(job.command);
      lines.push(
        `• ${fmt.code(fmt.escape(job.taskId))} ${fmt.escape("—")} ${fmt.escape(cmd)} ${fmt.escape(`(${relativeAge(job.updatedAt)})`)}`
      );
    }
    if (session.jobs.length > MAX_RENDERED_JOBS_PER_SESSION) {
      lines.push(fmt.escape(`+${session.jobs.length - MAX_RENDERED_JOBS_PER_SESSION} more`));
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
