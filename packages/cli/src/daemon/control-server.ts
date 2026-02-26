import type { ChannelChatId, ChannelUserId } from "../channel/types";
import { CONTROL_HOST, paths, useTcpControlServer } from "../config/paths";
import { logger } from "./logger";
import { removeControlPortFile, removeSocket, onShutdown } from "./lifecycle";
import { timingSafeEqual } from "crypto";
import { chmod, writeFile } from "fs/promises";
import type { RemoteControlAction } from "../session/remote-control";

export interface ChannelInfo {
  chatId: string;
  title: string;
  type: "dm" | "group" | "topic";
  busy: boolean;
  busyLabel: string | null;
}

export interface ConfigChannelSummary {
  name: string;
  type: string;
  botUsername?: string;
  botFirstName?: string;
  pairedUserCount: number;
  linkedGroupCount: number;
}

export interface ConfigChannelDetails {
  name: string;
  type: string;
  botUsername?: string;
  pairedUsers: Array<{ userId: string; username?: string; pairedAt: string }>;
  linkedGroups: Array<{ chatId: string; title?: string; linkedAt: string }>;
}

export interface DaemonContext {
  authToken: string;
  startedAt: number;
  getStatus: () => Record<string, unknown>;
  getInputNeeded: () => Array<{ sessionId: string; command: string; type: 'approval' | 'question' }>;
  shutdown: () => Promise<void>;
  generatePairingCode: () => string;
  getChannels: () => Promise<ChannelInfo[]>;
  registerRemote: (command: string, chatId: ChannelChatId, ownerUserId: ChannelUserId, cwd: string, sessionId?: string, subscribedGroups?: string[], name?: string) => Promise<{ sessionId: string; dmBusy: boolean; linkedGroups: Array<{ chatId: string; title?: string }>; allLinkedGroups: Array<{ chatId: string; title?: string }> }>;
  bindChat: (sessionId: string, chatId: ChannelChatId) => Promise<{ ok: boolean; error?: string }>;
  canUserAccessSession: (userId: ChannelUserId, sessionId: string) => boolean;
  drainRemoteInput: (sessionId: string) => string[];
  drainRemoteControl: (sessionId: string) => RemoteControlAction | null;
  pushRemoteInput: (sessionId: string, text: string) => boolean;
  hasRemote: (sessionId: string) => boolean;
  endRemote: (sessionId: string, exitCode: number | null) => void;
  getSubscribedGroups: (sessionId: string) => string[];
  getBoundChat: (sessionId: string) => string | null;
  handleQuestion: (sessionId: string, questions: unknown[]) => void;
  handleToolCall: (sessionId: string, name: string, input: Record<string, unknown>) => void;
  handleTyping: (sessionId: string, active: boolean) => void;
  handleApprovalNeeded: (sessionId: string, name: string, input: Record<string, unknown>, promptText?: string, pollOptions?: string[]) => void;
  handleThinking: (sessionId: string, text: string) => void;
  handleAssistantText: (sessionId: string, text: string) => void;
  handleToolResult: (sessionId: string, toolName: string, content: string, isError?: boolean) => void;
  handleBackgroundJob: (
    sessionId: string,
    event: {
      taskId: string;
      status: string;
      command?: string;
      outputFile?: string;
      summary?: string;
      urls?: string[];
    }
  ) => void;
  getBackgroundJobs: (sessionId: string) => Array<{ taskId: string; status: string; command?: string; urls?: string[]; updatedAt: number }>;
  getAllBackgroundJobs: (cwd?: string) => Array<{ sessionId: string; command: string; cwd: string; jobs: Array<{ taskId: string; status: string; command?: string; urls?: string[]; updatedAt: number }> }>;
  sendMessageToSession: (sessionId: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  sendFileToSession: (sessionId: string, filePath: string, caption?: string) => Promise<{ ok: boolean; error?: string }>;
  stopSessionById: (sessionId: string) => { ok: boolean; error?: string };
  killSessionById: (sessionId: string) => { ok: boolean; error?: string };
  restartSessionById: (sessionId: string, sessionRef?: string) => { ok: boolean; error?: string; sessionRef?: string };
  // Config channel management
  getConfigChannels: () => Promise<ConfigChannelSummary[]>;
  getChannelDetails: (name: string) => Promise<{ ok: boolean; error?: string; channel?: ConfigChannelDetails }>;
  addChannel: (name: string, type: string, botToken: string) => Promise<{ ok: boolean; error?: string; botUsername?: string; botFirstName?: string; needsRestart?: boolean }>;
  removeChannel: (name: string) => Promise<{ ok: boolean; error?: string; needsRestart?: boolean }>;
  removePairedUser: (channelName: string, userId: string) => Promise<{ ok: boolean; error?: string }>;
  addLinkedGroupApi: (channelName: string, chatId: string, title?: string) => Promise<{ ok: boolean; error?: string }>;
  removeLinkedGroupApi: (channelName: string, chatId: string) => Promise<{ ok: boolean; error?: string }>;
}

const MAX_BODY_SIZE = 1_048_576; // 1 MB

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY_SIZE) {
    throw new BodyTooLargeError();
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new InvalidJsonError();
  }
}

class BodyTooLargeError extends Error { constructor() { super("Payload too large"); } }
class InvalidJsonError extends Error { constructor() { super("Invalid JSON body"); } }

function constantTimeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function isAuthorized(req: Request, expectedToken: string): boolean {
  const provided = req.headers.get("x-touchgrass-auth");
  if (!provided) return false;
  return constantTimeEqual(provided, expectedToken);
}

export async function startControlServer(ctx: DaemonContext): Promise<void> {
  // Remove stale control endpoints
  await removeSocket();
  await removeControlPortFile();

  const handlers: {
    fetch(req: Request): Promise<Response>;
    error(err: Error): Response;
  } = {
    async fetch(req: Request) {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;

      if (!isAuthorized(req, ctx.authToken)) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      if (path === "/status") {
        return Response.json({ ok: true, ...ctx.getStatus() });
      }

      if (path === "/shutdown" && req.method === "POST") {
        // Respond before shutting down
        const res = Response.json({ ok: true, message: "Shutting down" });
        // Schedule shutdown
        setTimeout(() => ctx.shutdown(), 100);
        return res;
      }

      if (path === "/generate-code" && req.method === "POST") {
        const code = ctx.generatePairingCode();
        return Response.json({ ok: true, code });
      }

      if (path === "/health") {
        return Response.json({ ok: true, pid: process.pid, startedAt: ctx.startedAt });
      }

      if (path === "/channels") {
        const channels = await ctx.getChannels();
        return Response.json({ ok: true, channels });
      }

      if (path === "/input-needed") {
        return Response.json({ ok: true, sessions: ctx.getInputNeeded() });
      }

      // GET /skills?cwd=/path — list available SKILL.md files
      if (path === "/skills" && req.method === "GET") {
        const cwd = new URL(req.url, "http://localhost").searchParams.get("cwd");
        if (!cwd) {
          return Response.json({ ok: false, error: "cwd required" }, { status: 400 });
        }
        const { listSkills } = await import("./skills");
        const skills = await listSkills(cwd);
        return Response.json({ ok: true, skills });
      }

      // GET /agent-soul?cwd=/path — read agent soul from AGENTS.md
      if (path === "/agent-soul" && req.method === "GET") {
        const cwd = new URL(req.url, "http://localhost").searchParams.get("cwd");
        if (!cwd) {
          return Response.json({ ok: false, error: "cwd required" }, { status: 400 });
        }
        const { readAgentSoul } = await import("./agent-soul");
        const soul = await readAgentSoul(cwd);
        return Response.json({ ok: true, soul });
      }

      // POST /agent-soul?cwd=/path — write agent soul to AGENTS.md
      if (path === "/agent-soul" && req.method === "POST") {
        const cwd = new URL(req.url, "http://localhost").searchParams.get("cwd");
        if (!cwd) {
          return Response.json({ ok: false, error: "cwd required" }, { status: 400 });
        }
        const body = await readJsonBody(req);
        const name = body.name as string;
        const purpose = body.purpose as string;
        const owner = body.owner as string;
        const dna = (body.dna as string) || undefined;
        if (!name) {
          return Response.json({ ok: false, error: "name required" }, { status: 400 });
        }
        const { writeAgentSoul } = await import("./agent-soul");
        try {
          await writeAgentSoul(cwd, { name, purpose: purpose || "", owner: owner || "", dna });
          return Response.json({ ok: true });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Failed to write";
          return Response.json({ ok: false, error: msg }, { status: 400 });
        }
      }

      // GET /sessions/recent?tool=claude&cwd=/path — list resumable sessions
      if (path === "/sessions/recent") {
        const url = new URL(req.url, "http://localhost");
        const tool = url.searchParams.get("tool") as "claude" | "codex" | "pi" | "kimi" | null;
        const cwd = url.searchParams.get("cwd");
        if (!tool || !cwd) {
          return Response.json({ ok: false, error: "tool and cwd required" }, { status: 400 });
        }
        const { listRecentSessions } = await import("../bot/handlers/resume");
        const sessions = listRecentSessions(tool, cwd);
        return Response.json({ ok: true, sessions });
      }

      const sessionMatch = path.match(/^\/session\/(r-[a-f0-9]+)\/(stop|kill|restart)$/);
      if (sessionMatch && req.method === "POST") {
        const [, sessionId, action] = sessionMatch;
        let result: { ok: boolean; error?: string; sessionRef?: string };
        if (action === "stop") {
          result = ctx.stopSessionById(sessionId);
        } else if (action === "kill") {
          result = ctx.killSessionById(sessionId);
        } else {
          const body = await readJsonBody(req);
          const sessionRef = typeof body.sessionRef === "string" ? body.sessionRef : undefined;
          result = ctx.restartSessionById(sessionId, sessionRef);
        }
        if (!result.ok) {
          const status = (result.error || "").toLowerCase().includes("not found") ? 404 : 400;
          return Response.json({ ok: false, error: result.error || "Session not found" }, { status });
        }
        if (action === "restart") {
          return Response.json({ ok: true, sessionRef: result.sessionRef });
        }
        return Response.json({ ok: true });
      }

      if (path === "/remote/register" && req.method === "POST") {
        const body = await readJsonBody(req);
        const command = body.command as string;
        const chatId = body.chatId as string;
        const ownerUserId = body.ownerUserId as string;
        const cwd = (body.cwd as string) || "";
        const sessionId = (body.sessionId as string) || undefined;
        const subscribedGroups = Array.isArray(body.subscribedGroups) ? body.subscribedGroups as string[] : undefined;
        const name = (body.name as string) || undefined;
        if (!command || !chatId || !ownerUserId) {
          return Response.json({ ok: false, error: "Missing command, chatId, or ownerUserId" }, { status: 400 });
        }
        const result = await ctx.registerRemote(command, chatId, ownerUserId, cwd, sessionId || undefined, subscribedGroups, name);
        return Response.json({ ok: true, sessionId: result.sessionId, dmBusy: result.dmBusy, linkedGroups: result.linkedGroups, allLinkedGroups: result.allLinkedGroups });
      }

      if (path === "/remote/bind-chat" && req.method === "POST") {
        const body = await readJsonBody(req);
        const sessionId = body.sessionId as string;
        const targetChatId = body.chatId as string;
        const ownerUserId = body.ownerUserId as string;
        if (!sessionId || !targetChatId || !ownerUserId) {
          return Response.json({ ok: false, error: "Missing sessionId, chatId, or ownerUserId" }, { status: 400 });
        }
        if (!ctx.canUserAccessSession(ownerUserId, sessionId)) {
          return Response.json({ ok: false, error: "Unauthorized session access" }, { status: 403 });
        }
        const result = await ctx.bindChat(sessionId, targetChatId);
        return Response.json({ ok: result.ok, ...(result.error ? { error: result.error } : {}) });
      }

      // Claude Code hook endpoint — receives structured lifecycle events from the hook script
      const hookMatch = path.match(/^\/hook\/(r-[a-f0-9]+)$/);
      if (hookMatch && req.method === "POST") {
        const [, sessionId] = hookMatch;
        if (!ctx.hasRemote(sessionId)) {
          return Response.json({ ok: false, error: "Session not found" }, { status: 404 });
        }
        const body = await readJsonBody(req);
        const eventName = body.hook_event_name as string;
        if (!eventName) {
          return Response.json({ ok: false, error: "Missing hook_event_name" }, { status: 400 });
        }

        if (eventName === "PermissionRequest") {
          const toolName = (body.tool_name as string) || "unknown";
          // AskUserQuestion is handled via JSONL parsing, not as a permission request.
          // Auto-approve it so the user only sees the actual question poll.
          if (toolName === "AskUserQuestion") {
            return Response.json({ ok: true });
          }
          const toolInput = (body.tool_input as Record<string, unknown>) || {};
          // Build human-readable prompt text from tool name and input
          let promptText = `Allow ${toolName}`;
          if (toolName === "Bash" && typeof toolInput.command === "string") {
            const cmd = toolInput.command.length > 80
              ? toolInput.command.slice(0, 80) + "..."
              : toolInput.command;
            promptText = `Allow Bash: ${cmd}?`;
          } else if ((toolName === "Edit" || toolName === "Write") && typeof toolInput.file_path === "string") {
            promptText = `Allow ${toolName}: ${toolInput.file_path}?`;
          } else if (toolName === "Glob" && typeof toolInput.pattern === "string") {
            const path = typeof toolInput.path === "string" ? ` in ${toolInput.path}` : "";
            promptText = `Allow Search: ${toolInput.pattern}${path}?`;
          } else if (toolName === "Grep" && typeof toolInput.pattern === "string") {
            const path = typeof toolInput.path === "string" ? ` in ${toolInput.path}` : "";
            promptText = `Allow Grep: ${toolInput.pattern}${path}?`;
          } else if (toolName === "Read" && typeof toolInput.file_path === "string") {
            promptText = `Allow Read: ${toolInput.file_path}?`;
          } else if (toolName === "WebFetch" && typeof toolInput.url === "string") {
            const url = toolInput.url.length > 60 ? toolInput.url.slice(0, 60) + "..." : toolInput.url;
            promptText = `Allow Fetch: ${url}?`;
          } else if (toolName === "WebSearch" && typeof toolInput.query === "string") {
            promptText = `Allow Search: ${toolInput.query}?`;
          } else if (toolName === "NotebookEdit" && typeof toolInput.notebook_path === "string") {
            promptText = `Allow NotebookEdit: ${toolInput.notebook_path}?`;
          } else {
            promptText = `Allow ${toolName}?`;
          }
          // Extract poll options from permission_suggestions
          const suggestions = Array.isArray(body.permission_suggestions) ? body.permission_suggestions as Array<{ type?: string; tool?: string }> : [];
          const pollOptions = ["Yes", "Yes, always for this session", "No"];
          if (suggestions.length > 0) {
            // Check if there's an "always allow" suggestion to make the options more specific
            const hasAlwaysAllow = suggestions.some((s) => s.type === "toolAlwaysAllow");
            if (hasAlwaysAllow) {
              pollOptions[1] = `Yes, always allow ${toolName}`;
            }
          }
          ctx.handleApprovalNeeded(sessionId, toolName, toolInput, promptText, pollOptions);
          return Response.json({ ok: true });
        }

        if (eventName === "UserPromptSubmit") {
          ctx.handleTyping(sessionId, true);
          return Response.json({ ok: true });
        }

        if (eventName === "Stop") {
          ctx.handleTyping(sessionId, false);
          return Response.json({ ok: true });
        }

        return Response.json({ ok: true }); // Unknown event — ignore silently
      }

      // GET /background-jobs?cwd=<path> — list all background jobs (optionally filtered by cwd)
      // GET /remote/:id/background-jobs — list background jobs for a specific session
      if (path === "/background-jobs" && req.method === "GET") {
        const cwd = new URL(req.url, "http://localhost").searchParams.get("cwd") || undefined;
        const allJobs = ctx.getAllBackgroundJobs(cwd);
        return Response.json({ ok: true, sessions: allJobs });
      }
      const bgJobsMatch = path.match(/^\/remote\/(r-[a-f0-9]+)\/background-jobs$/);
      if (bgJobsMatch && req.method === "GET") {
        const [, sessionId] = bgJobsMatch;
        const jobs = ctx.getBackgroundJobs(sessionId);
        return Response.json({ ok: true, jobs });
      }

      // Match /remote/:id/* actions
      const remoteMatch = path.match(/^\/remote\/(r-[a-f0-9]+)\/(input|exit|subscribed-groups|question|tool-call|thinking|assistant|tool-result|approval-needed|typing|background-job|send-input|send-file|send-message)$/);
      if (remoteMatch) {
        const [, sessionId, action] = remoteMatch;
        if (action === "assistant" && req.method === "POST") {
          const body = await readJsonBody(req);
          const text = body.text as string;
          if (!text) {
            return Response.json({ ok: false, error: "Missing text" }, { status: 400 });
          }
          ctx.handleAssistantText(sessionId, text);
          return Response.json({ ok: true });
        }
        if (action === "tool-result" && req.method === "POST") {
          const body = await readJsonBody(req);
          const toolName = body.toolName as string;
          const content = body.content as string;
          const isError = body.isError === true;
          if (!toolName || !content) {
            return Response.json({ ok: false, error: "Missing toolName or content" }, { status: 400 });
          }
          ctx.handleToolResult(sessionId, toolName, content, isError);
          return Response.json({ ok: true });
        }
        if (action === "background-job" && req.method === "POST") {
          const body = await readJsonBody(req);
          const taskId = body.taskId as string;
          const status = body.status as string;
          const command = body.command as string | undefined;
          const outputFile = body.outputFile as string | undefined;
          const summary = body.summary as string | undefined;
          const urls = Array.isArray(body.urls)
            ? (body.urls as unknown[]).filter((v): v is string => typeof v === "string" && v.length > 0)
            : undefined;
          if (!taskId || !status) {
            return Response.json({ ok: false, error: "Missing taskId or status" }, { status: 400 });
          }
          ctx.handleBackgroundJob(sessionId, { taskId, status, command, outputFile, summary, urls });
          return Response.json({ ok: true });
        }
        if (action === "thinking" && req.method === "POST") {
          const body = await readJsonBody(req);
          const text = body.text as string;
          if (!text) {
            return Response.json({ ok: false, error: "Missing text" }, { status: 400 });
          }
          ctx.handleThinking(sessionId, text);
          return Response.json({ ok: true });
        }
        if (action === "tool-call" && req.method === "POST") {
          const body = await readJsonBody(req);
          const name = body.name as string;
          const input = (body.input as Record<string, unknown>) || {};
          if (!name) {
            return Response.json({ ok: false, error: "Missing name" }, { status: 400 });
          }
          ctx.handleToolCall(sessionId, name, input);
          return Response.json({ ok: true });
        }
        if (action === "typing" && req.method === "POST") {
          const body = await readJsonBody(req);
          const active = body.active === true;
          ctx.handleTyping(sessionId, active);
          return Response.json({ ok: true });
        }
        if (action === "approval-needed" && req.method === "POST") {
          const body = await readJsonBody(req);
          const name = body.name as string;
          const input = (body.input as Record<string, unknown>) || {};
          if (!name) {
            return Response.json({ ok: false, error: "Missing name" }, { status: 400 });
          }
          const promptText = (body.promptText as string) || undefined;
          const pollOptions = Array.isArray(body.pollOptions) ? body.pollOptions as string[] : undefined;
          ctx.handleApprovalNeeded(sessionId, name, input, promptText, pollOptions);
          return Response.json({ ok: true });
        }
        if (action === "question" && req.method === "POST") {
          const body = await readJsonBody(req);
          const questions = body.questions as unknown[];
          if (!questions || !Array.isArray(questions)) {
            return Response.json({ ok: false, error: "Missing questions" }, { status: 400 });
          }
          ctx.handleQuestion(sessionId, questions);
          return Response.json({ ok: true });
        }
        if (action === "input" && req.method === "GET") {
          // Signal to CLI that this session is unknown so it can re-register
          if (!ctx.hasRemote(sessionId)) {
            return Response.json({ ok: true, lines: [], unknown: true });
          }
          const lines = ctx.drainRemoteInput(sessionId);
          const controlAction = ctx.drainRemoteControl(sessionId);
          return Response.json({ ok: true, lines, controlAction });
        }
        if (action === "exit" && req.method === "POST") {
          const body = await readJsonBody(req);
          const exitCode = (body.exitCode as number) ?? null;
          ctx.endRemote(sessionId, exitCode);
          return Response.json({ ok: true });
        }
        if (action === "subscribed-groups" && req.method === "GET") {
          const chatIds = ctx.getSubscribedGroups(sessionId);
          const boundChat = ctx.getBoundChat(sessionId);
          return Response.json({ ok: true, chatIds, boundChat });
        }
        if (action === "send-input" && req.method === "POST") {
          if (!ctx.hasRemote(sessionId)) {
            return Response.json({ ok: false, error: "Session not found" }, { status: 404 });
          }
          const body = await readJsonBody(req);
          const text = body.text as string;
          if (!text) {
            return Response.json({ ok: false, error: "Missing text" }, { status: 400 });
          }
          const pushed = ctx.pushRemoteInput(sessionId, text);
          return Response.json({ ok: pushed });
        }
        if (action === "send-file" && req.method === "POST") {
          const body = await readJsonBody(req);
          const filePath = body.filePath as string;
          const caption = body.caption as string | undefined;
          if (!filePath) {
            return Response.json({ ok: false, error: "Missing filePath" }, { status: 400 });
          }
          const result = await ctx.sendFileToSession(sessionId, filePath, caption);
          if (!result.ok) {
            return Response.json({ ok: false, error: result.error || "Failed to send file" }, { status: 400 });
          }
          return Response.json({ ok: true });
        }
        if (action === "send-message" && req.method === "POST") {
          const body = await readJsonBody(req);
          const text = body.text as string;
          if (!text) {
            return Response.json({ ok: false, error: "Missing text" }, { status: 400 });
          }
          const result = await ctx.sendMessageToSession(sessionId, text);
          if (!result.ok) {
            return Response.json({ ok: false, error: result.error || "Failed to send message" }, { status: 400 });
          }
          return Response.json({ ok: true });
        }
      }

      // --- Config channel management routes ---
      const configChannelMatch = path.match(/^\/config\/channels(?:\/([a-z][a-z0-9_-]*))?(?:\/(users|groups)(?:\/(.+))?)?$/);
      if (configChannelMatch) {
        const [, channelName, subResource, subId] = configChannelMatch;

        // GET /config/channels — list all channels
        if (!channelName && req.method === "GET") {
          const channels = await ctx.getConfigChannels();
          return Response.json({ ok: true, channels });
        }

        // POST /config/channels — add a new channel
        if (!channelName && req.method === "POST") {
          const body = await readJsonBody(req);
          const name = body.name as string;
          const type = body.type as string;
          const botToken = body.botToken as string;
          if (!name || !type || !botToken) {
            return Response.json({ ok: false, error: "Missing name, type, or botToken" }, { status: 400 });
          }
          const result = await ctx.addChannel(name, type, botToken);
          if (!result.ok) {
            return Response.json({ ok: false, error: result.error }, { status: 400 });
          }
          return Response.json({ ok: true, botUsername: result.botUsername, botFirstName: result.botFirstName, needsRestart: result.needsRestart });
        }

        // GET /config/channels/:name — get channel details
        if (channelName && !subResource && req.method === "GET") {
          const result = await ctx.getChannelDetails(channelName);
          if (!result.ok) {
            return Response.json({ ok: false, error: result.error }, { status: 404 });
          }
          return Response.json({ ok: true, channel: result.channel });
        }

        // DELETE /config/channels/:name — remove a channel
        if (channelName && !subResource && req.method === "DELETE") {
          const result = await ctx.removeChannel(channelName);
          if (!result.ok) {
            const status = (result.error || "").toLowerCase().includes("not found") ? 404 : 400;
            return Response.json({ ok: false, error: result.error }, { status });
          }
          return Response.json({ ok: true, needsRestart: result.needsRestart });
        }

        // DELETE /config/channels/:name/users/:userId — remove a paired user
        if (channelName && subResource === "users" && subId && req.method === "DELETE") {
          const result = await ctx.removePairedUser(channelName, decodeURIComponent(subId));
          if (!result.ok) {
            const status = (result.error || "").toLowerCase().includes("not found") ? 404 : 400;
            return Response.json({ ok: false, error: result.error }, { status });
          }
          return Response.json({ ok: true });
        }

        // POST /config/channels/:name/groups — add a linked group
        if (channelName && subResource === "groups" && !subId && req.method === "POST") {
          const body = await readJsonBody(req);
          const chatId = body.chatId as string;
          const title = body.title as string | undefined;
          if (!chatId) {
            return Response.json({ ok: false, error: "Missing chatId" }, { status: 400 });
          }
          const result = await ctx.addLinkedGroupApi(channelName, chatId, title);
          if (!result.ok) {
            const status = (result.error || "").toLowerCase().includes("not found") ? 404 : 400;
            return Response.json({ ok: false, error: result.error }, { status });
          }
          return Response.json({ ok: true });
        }

        // DELETE /config/channels/:name/groups/:chatId — remove a linked group
        if (channelName && subResource === "groups" && subId && req.method === "DELETE") {
          const result = await ctx.removeLinkedGroupApi(channelName, decodeURIComponent(subId));
          if (!result.ok) {
            const status = (result.error || "").toLowerCase().includes("not found") ? 404 : 400;
            return Response.json({ ok: false, error: result.error }, { status });
          }
          return Response.json({ ok: true });
        }
      }

      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    },
    error(err: Error) {
      if (err instanceof BodyTooLargeError) {
        return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
      }
      if (err instanceof InvalidJsonError) {
        return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
      }
      logger.error("Control server error", err.message);
      return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
    },
  };

  const server = useTcpControlServer()
    ? Bun.serve({
        hostname: CONTROL_HOST,
        port: 0,
        ...handlers,
      })
    : Bun.serve({
        unix: paths.socket,
        ...handlers,
      });

  if (useTcpControlServer()) {
    const port = Number(server.port);
    await writeFile(paths.controlPortFile, String(port), { encoding: "utf-8", mode: 0o600 });
    await chmod(paths.controlPortFile, 0o600).catch(() => {});
    await logger.info("Control server listening", { host: CONTROL_HOST, port });
  } else {
    await chmod(paths.socket, 0o600).catch(() => {});
    await logger.info("Control server listening", { socket: paths.socket });
  }
  onShutdown(() => server.stop());
}
