import type { ChannelChatId } from "../channel/types";
import { paths } from "../config/paths";
import { logger } from "./logger";
import { removeSocket, onShutdown } from "./lifecycle";

export interface DaemonContext {
  startedAt: number;
  getStatus: () => Record<string, unknown>;
  shutdown: () => Promise<void>;
  generatePairingCode: () => string;
  registerRemote: (command: string, chatId: ChannelChatId, cwd: string, name: string) => string;
  drainRemoteInput: (sessionId: string) => string[];
  endRemote: (sessionId: string, exitCode: number | null) => void;
  trackMessage: (sessionId: string, msgRef: string) => void;
  getSubscribedGroups: (sessionId: string) => string[];
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  return JSON.parse(text) as Record<string, unknown>;
}

export async function startControlServer(ctx: DaemonContext): Promise<void> {
  // Remove stale socket
  await removeSocket();

  const server = Bun.serve({
    unix: paths.socket,
    async fetch(req) {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;

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
        const cwd = (body.cwd as string) || "";
        const name = (body.name as string) || "";
        if (!command || !chatId) {
          return Response.json({ ok: false, error: "Missing command or chatId" }, { status: 400 });
        }
        const sessionId = ctx.registerRemote(command, chatId, cwd, name);
        return Response.json({ ok: true, sessionId });
      }

      // Match /remote/:id/input, /remote/:id/exit, /remote/:id/track-message, /remote/:id/subscribed-groups
      const remoteMatch = path.match(/^\/remote\/(r-[a-f0-9]+)\/(input|exit|track-message|subscribed-groups)$/);
      if (remoteMatch) {
        const [, sessionId, action] = remoteMatch;
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
        if (action === "track-message" && req.method === "POST") {
          const body = await readJsonBody(req);
          const msgRef = body.msgRef as string;
          if (msgRef) ctx.trackMessage(sessionId, msgRef);
          return Response.json({ ok: true });
        }
        if (action === "subscribed-groups" && req.method === "GET") {
          const chatIds = ctx.getSubscribedGroups(sessionId);
          return Response.json({ ok: true, chatIds });
        }
      }

      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    },
    error(err) {
      logger.error("Control server error", err.message);
      return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
    },
  });

  onShutdown(() => server.stop());
  await logger.info("Control server listening", { socket: paths.socket });
}
