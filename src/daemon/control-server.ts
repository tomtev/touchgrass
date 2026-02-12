import type { ChannelChatId, ChannelUserId } from "../channel/types";
import { paths } from "../config/paths";
import { logger } from "./logger";
import { removeSocket, onShutdown } from "./lifecycle";
import { timingSafeEqual } from "crypto";
import { chmod } from "fs/promises";

export interface DaemonContext {
  authToken: string;
  startedAt: number;
  getStatus: () => Record<string, unknown>;
  shutdown: () => Promise<void>;
  generatePairingCode: () => string;
  registerRemote: (command: string, chatId: ChannelChatId, ownerUserId: ChannelUserId, cwd: string, name: string) => { sessionId: string; dmBusy: boolean; linkedGroups: Array<{ chatId: string; title?: string }>; allLinkedGroups: Array<{ chatId: string; title?: string }> };
  bindChat: (sessionId: string, chatId: ChannelChatId) => boolean;
  canUserAccessSession: (userId: ChannelUserId, sessionId: string) => boolean;
  drainRemoteInput: (sessionId: string) => string[];
  endRemote: (sessionId: string, exitCode: number | null) => void;
  getSubscribedGroups: (sessionId: string) => string[];
  getBoundChat: (sessionId: string) => string | null;
  handleQuestion: (sessionId: string, questions: unknown[]) => void;
  handleToolCall: (sessionId: string, name: string, input: Record<string, unknown>) => void;
  handleApprovalNeeded: (sessionId: string, name: string, input: Record<string, unknown>, promptText?: string, pollOptions?: string[]) => void;
  handleThinking: (sessionId: string, text: string) => void;
  handleToolResult: (sessionId: string, toolName: string, content: string) => void;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  return JSON.parse(text) as Record<string, unknown>;
}

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
  // Remove stale socket
  await removeSocket();

  const server = Bun.serve({
    unix: paths.socket,
    async fetch(req) {
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

      if (path === "/remote/register" && req.method === "POST") {
        const body = await readJsonBody(req);
        const command = body.command as string;
        const chatId = body.chatId as string;
        const ownerUserId = body.ownerUserId as string;
        const cwd = (body.cwd as string) || "";
        const name = (body.name as string) || "";
        if (!command || !chatId || !ownerUserId) {
          return Response.json({ ok: false, error: "Missing command, chatId, or ownerUserId" }, { status: 400 });
        }
        const result = ctx.registerRemote(command, chatId, ownerUserId, cwd, name);
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
        const success = ctx.bindChat(sessionId, targetChatId);
        return Response.json({ ok: success });
      }

      // Match /remote/:id/* actions
      const remoteMatch = path.match(/^\/remote\/(r-[a-f0-9]+)\/(input|exit|subscribed-groups|question|tool-call|thinking|tool-result|approval-needed)$/);
      if (remoteMatch) {
        const [, sessionId, action] = remoteMatch;
        if (action === "tool-result" && req.method === "POST") {
          const body = await readJsonBody(req);
          const toolName = body.toolName as string;
          const content = body.content as string;
          if (!toolName || !content) {
            return Response.json({ ok: false, error: "Missing toolName or content" }, { status: 400 });
          }
          ctx.handleToolResult(sessionId, toolName, content);
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
          const lines = ctx.drainRemoteInput(sessionId);
          return Response.json({ ok: true, lines });
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
      }

      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    },
    error(err) {
      logger.error("Control server error", err.message);
      return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
    },
  });

  await chmod(paths.socket, 0o600).catch(() => {});
  onShutdown(() => server.stop());
  await logger.info("Control server listening", { socket: paths.socket });
}
