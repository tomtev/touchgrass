import { loadConfig } from "../config/store";
import { getTelegramBotToken } from "../config/schema";
import { logger } from "./logger";
import { writePidFile, installSignalHandlers, onShutdown, removePidFile, removeSocket } from "./lifecycle";
import { startControlServer } from "./control-server";
import { routeMessage } from "../bot/command-router";
import { SessionManager } from "../session/manager";
import { generatePairingCode } from "../security/pairing";
import { TelegramChannel } from "../channels/telegram/channel";
import { escapeHtml } from "../channels/telegram/formatter";
import type { Channel, ChannelChatId } from "../channel/types";

const DAEMON_STARTED_AT = Date.now();

export async function startDaemon(): Promise<void> {
  await logger.info("Daemon starting", { pid: process.pid });

  const config = await loadConfig();
  const botToken = getTelegramBotToken(config);
  if (!botToken) {
    await logger.error("No bot token configured. Run `tg init` first.");
    console.error("No bot token configured. Run `tg init` first.");
    process.exit(1);
  }

  installSignalHandlers();
  await writePidFile();

  const sessionManager = new SessionManager(config.settings);

  // Create channel instances from config
  const channels: Channel[] = [];
  for (const [name, cfg] of Object.entries(config.channels)) {
    if (cfg.type === "telegram") {
      channels.push(new TelegramChannel((cfg.credentials as { botToken: string }).botToken));
    }
  }

  if (channels.length === 0) {
    await logger.error("No channels configured. Run `tg init` first.");
    console.error("No channels configured. Run `tg init` first.");
    process.exit(1);
  }

  // Auto-stop timer: shut down when all sessions disconnect
  const AUTO_STOP_DELAY = 30_000;
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelAutoStop() {
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }
  }

  function scheduleAutoStop() {
    cancelAutoStop();
    autoStopTimer = setTimeout(async () => {
      if (sessionManager.remoteCount() === 0 && sessionManager.runningCount() === 0) {
        await logger.info("No active sessions, auto-stopping daemon");
        for (const ch of channels) ch.stopReceiving();
        sessionManager.killAll();
        await removePidFile();
        await removeSocket();
        process.exit(0);
      }
    }, AUTO_STOP_DELAY);
  }

  // Wire message tracking and event handlers for each channel
  for (const channel of channels) {
    channel.onMessageSent = (msgRef: string, sessionId: string) => {
      sessionManager.trackMessage(msgRef, sessionId);
    };
  }

  // Use the first channel for sending notifications (daemon-initiated messages)
  const primaryChannel = channels[0];

  // Wire session event handlers
  sessionManager.setEventHandlers({
    onOutput: (sessionId, data) => {
      const session = sessionManager.get(sessionId);
      if (session) {
        primaryChannel.sendOutput(session.ownerChatId, data);
        // Also send to subscribed group chats
        for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
          primaryChannel.sendOutput(groupChatId, data);
        }
      }
    },
    onExit: (sessionId, exitCode) => {
      const session = sessionManager.get(sessionId);
      if (session) {
        primaryChannel.sendSessionExit(session.ownerChatId, sessionId, exitCode);
        for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
          primaryChannel.sendSessionExit(groupChatId, sessionId, exitCode);
        }
      }
    },
  });

  onShutdown(async () => {
    cancelAutoStop();
    for (const ch of channels) ch.stopReceiving();
    sessionManager.killAll();
  });

  await startControlServer({
    startedAt: DAEMON_STARTED_AT,
    getStatus() {
      return {
        pid: process.pid,
        uptime: process.uptime(),
        sessions: sessionManager.list().map((s) => ({
          id: s.id,
          command: s.command,
          state: s.state,
          createdAt: s.createdAt,
        })),
      };
    },
    async shutdown() {
      cancelAutoStop();
      for (const ch of channels) ch.stopReceiving();
      sessionManager.killAll();
      await removePidFile();
      await removeSocket();
      process.exit(0);
    },
    generatePairingCode() {
      return generatePairingCode();
    },
    registerRemote(command: string, chatId: ChannelChatId, cwd: string, name: string): string {
      cancelAutoStop();
      const remote = sessionManager.registerRemote(command, chatId, cwd, name);
      const label = name || cwd.split("/").pop() || cwd;
      const tool = command.split(" ")[0]; // e.g. "claude", "codex", "pi"
      primaryChannel.send(chatId, `<b>${escapeHtml(label)}</b> [${tool}] <i>(${remote.id})</i> started`, remote.id);
      return remote.id;
    },
    drainRemoteInput(sessionId: string): string[] {
      return sessionManager.drainRemoteInput(sessionId);
    },
    trackMessage(sessionId: string, msgRef: string): void {
      sessionManager.trackMessage(msgRef, sessionId);
    },
    endRemote(sessionId: string, exitCode: number | null): void {
      const remote = sessionManager.getRemote(sessionId);
      if (remote) {
        const label = remote.name || remote.cwd.split("/").pop() || remote.cwd;
        const tool = remote.command.split(" ")[0];
        const status = exitCode === 0 ? "exited" : `exited with code ${exitCode ?? "unknown"}`;
        const msg = `<b>${escapeHtml(label)}</b> [${tool}] <i>(${remote.id})</i> ${status}`;
        primaryChannel.send(remote.chatId, msg);
        // Notify subscribed groups
        for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
          primaryChannel.send(groupChatId, msg);
        }
        sessionManager.removeRemote(sessionId);
      }
      if (sessionManager.remoteCount() === 0 && sessionManager.runningCount() === 0) {
        scheduleAutoStop();
      }
    },
    getSubscribedGroups(sessionId: string): string[] {
      return sessionManager.getSubscribedGroups(sessionId);
    },
  });

  // Start receiving on all channels
  for (const channel of channels) {
    channel.startReceiving(async (msg) => {
      await routeMessage(msg, { config, sessionManager, channel });
    });
  }

  await logger.info("Daemon started successfully");
}
