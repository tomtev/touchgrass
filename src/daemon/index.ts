import { loadConfig, invalidateCache, saveConfig } from "../config/store";
import { getTelegramBotToken, getAllLinkedGroups, getAllPairedUsers, isLinkedGroup, removeLinkedGroup } from "../config/schema";
import { logger } from "./logger";
import { writePidFile, installSignalHandlers, onShutdown, removeAuthToken, removeControlPortFile, removePidFile, removeSocket } from "./lifecycle";
import { startControlServer, type ChannelInfo } from "./control-server";
import { routeMessage } from "../bot/command-router";
import { SessionManager } from "../session/manager";
import { generatePairingCode } from "../security/pairing";
import { isUserPaired } from "../security/allowlist";
import { rotateDaemonAuthToken } from "../security/daemon-auth";
import { createChannel } from "../channel/factory";
import type { Formatter } from "../channel/formatter";
import type { Channel, ChannelChatId, ChannelUserId } from "../channel/types";
import type { AskQuestion } from "../session/manager";
import { stat } from "fs/promises";
import { basename } from "path";

const DAEMON_STARTED_AT = Date.now();

/** Format a session label for messages: "claude (myproject)" or just "claude" */
function sessionLabel(command: string, cwd: string): string {
  const tool = command.split(" ")[0];
  const folder = cwd.split("/").pop();
  return folder ? `${tool} (${folder})` : tool;
}

export async function startDaemon(): Promise<void> {
  await logger.info("Daemon starting", { pid: process.pid });

  let config = await loadConfig();
  async function refreshConfig() {
    invalidateCache();
    config = await loadConfig();
  }
  const botToken = getTelegramBotToken(config);
  if (!botToken) {
    await logger.error("No bot token configured. Run `tg init` first.");
    console.error("No bot token configured. Run `tg init` first.");
    process.exit(1);
  }

  installSignalHandlers();
  await writePidFile();
  const daemonAuthToken = await rotateDaemonAuthToken();

  const sessionManager = new SessionManager(config.settings);

  // Create channel instances from config
  const channels: Channel[] = [];
  for (const [name, cfg] of Object.entries(config.channels)) {
    channels.push(createChannel(name, cfg));
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
        await removeAuthToken();
        await removePidFile();
        await removeSocket();
        await removeControlPortFile();
        process.exit(0);
      }
    }, AUTO_STOP_DELAY);
  }

  // Use the first channel for sending notifications (daemon-initiated messages)
  const primaryChannel = channels[0];
  const fmt = primaryChannel.fmt;

  // Wire dead chat detection — clean up subscriptions and linked groups when sends fail permanently
  for (const channel of channels) {
    if ("onDeadChat" in channel) {
      channel.onDeadChat = async (deadChatId, error) => {
        await logger.info("Dead chat detected", { chatId: deadChatId, error: error.message });
        // Unsubscribe dead chat from all sessions
        for (const session of sessionManager.list()) {
          sessionManager.unsubscribeGroup(session.id, deadChatId);
        }
        // Detach from any bound session
        sessionManager.detach(deadChatId);
        // Remove from linked groups config
        await refreshConfig();
        if (removeLinkedGroup(config, deadChatId)) {
          await saveConfig(config);
        }
      };
    }
  }

  // Wire session event handlers
  sessionManager.setEventHandlers({
    onOutput: (sessionId, data) => {
      const session = sessionManager.get(sessionId);
      if (session) {
        primaryChannel.setTyping(session.ownerChatId, false);
        for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
          primaryChannel.setTyping(groupChatId, false);
        }
        primaryChannel.sendOutput(session.ownerChatId, data);
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

  // --- Poll / AskUserQuestion support ---

  async function sendNextPoll(sessionId: string) {
    const pending = sessionManager.getPendingQuestions(sessionId);
    if (!pending) return;
    const idx = pending.currentIndex;
    if (idx >= pending.questions.length) {
      // All questions answered — press Enter on "Submit answers" screen, then cleanup
      const remote = sessionManager.getRemote(sessionId);
      if (remote) {
        remote.inputQueue.push("\x1b[POLL_SUBMIT]");
      }
      sessionManager.clearPendingQuestions(sessionId);
      return;
    }

    const q = pending.questions[idx];
    // Build options for poll (max 10 real options, Telegram limit is 10)
    const optionLabels = q.options.slice(0, 9).map((o) => o.label);
    optionLabels.push("Other (type a reply)");

    if (!primaryChannel.sendPoll) return;

    try {
      const questionText = q.question.length > 300 ? q.question.slice(0, 297) + "..." : q.question;
      const { pollId, messageId } = await primaryChannel.sendPoll(
        pending.chatId,
        questionText,
        optionLabels,
        q.multiSelect
      );
      sessionManager.registerPoll(pollId, {
        sessionId,
        chatId: pending.chatId,
        messageId,
        questionIndex: idx,
        totalQuestions: pending.questions.length,
        multiSelect: q.multiSelect,
        optionCount: optionLabels.length - 1, // exclude "Other"
      });
    } catch (e) {
      await logger.error("Failed to send poll", { sessionId, error: (e as Error).message });
      sessionManager.clearPendingQuestions(sessionId);
    }
  }

  function handlePollAnswer(answer: { pollId: string; userId: ChannelUserId; optionIds: number[] }) {
    const poll = sessionManager.getPollByPollId(answer.pollId);
    if (!poll) return;
    if (!isUserPaired(config, answer.userId)) {
      logger.warn("Ignoring poll answer from unpaired user", { userId: answer.userId, pollId: answer.pollId });
      return;
    }

    const remote = sessionManager.getRemote(poll.sessionId);
    if (!remote) return;
    if (remote.ownerUserId !== answer.userId) {
      logger.warn("Ignoring poll answer from non-owner", {
        userId: answer.userId,
        sessionId: poll.sessionId,
        ownerUserId: remote.ownerUserId,
      });
      return;
    }

    // Close the poll
    if (primaryChannel.closePoll) {
      primaryChannel.closePoll(poll.chatId, poll.messageId).catch(() => {});
    }
    sessionManager.removePoll(answer.pollId);

    const otherIdx = poll.optionCount; // "Other" is the last option
    const selectedOther = answer.optionIds.includes(otherIdx);

    if (selectedOther) {
      // User chose "Other" — push marker, wait for text message
      remote.inputQueue.push("\x1b[POLL_OTHER]");
      // Don't advance to next question; text handler will do that
      sessionManager.clearPendingQuestions(poll.sessionId);
    } else {
      // Encode selected options
      const encoded = `\x1b[POLL:${answer.optionIds.join(",")}:${poll.multiSelect ? "1" : "0"}]`;
      remote.inputQueue.push(encoded);

      // For multi-select, need to navigate Down to "Next"/"Submit" and press Enter
      // (single-select Enter already advances automatically)
      // Encode last cursor position and option count so CLI can calculate Downs needed
      if (poll.multiSelect) {
        const lastPos = answer.optionIds.length > 0 ? Math.max(...answer.optionIds) : 0;
        remote.inputQueue.push(`\x1b[POLL_NEXT:${lastPos}:${poll.optionCount}]`);
      }

      // Record answer and advance
      const pending = sessionManager.getPendingQuestions(poll.sessionId);
      if (pending) {
        pending.answers.push(answer.optionIds);
        pending.currentIndex++;
        sendNextPoll(poll.sessionId);
      }
    }
  }

  // Wire poll answer handler on all channels that support it
  for (const channel of channels) {
    if ("onPollAnswer" in channel) {
      channel.onPollAnswer = handlePollAnswer;
    }
  }

  function formatToolCall(fmt: Formatter, name: string, input: Record<string, unknown>): string | null {
    switch (name) {
      // --- Claude: Edit ---
      case "Edit": {
        const fp = input.file_path as string | undefined;
        if (!fp) return null;
        let msg = `${fmt.escape("✏️")} ${fmt.code(fmt.escape(fp))}`;
        const oldStr = input.old_string as string | undefined;
        const newStr = input.new_string as string | undefined;
        if (oldStr || newStr) {
          const diffLines: string[] = [];
          if (oldStr) {
            for (const line of oldStr.split("\n").slice(0, 5)) {
              diffLines.push(`- ${line}`);
            }
            if (oldStr.split("\n").length > 5) diffLines.push("- ...");
          }
          if (newStr) {
            for (const line of newStr.split("\n").slice(0, 5)) {
              diffLines.push(`+ ${line}`);
            }
            if (newStr.split("\n").length > 5) diffLines.push("+ ...");
          }
          if (diffLines.length > 0) {
            msg += `\n${fmt.pre(fmt.escape(diffLines.join("\n")))}`;
          }
        }
        return msg;
      }
      // --- Claude: Write ---
      case "Write": {
        const fp = input.file_path as string | undefined;
        if (!fp) return null;
        let msg = `${fmt.escape("📄")} ${fmt.code(fmt.escape(fp))}`;
        const content = input.content as string | undefined;
        if (content) {
          const lines = content.split("\n");
          const preview = lines.slice(0, 5).join("\n");
          const suffix = lines.length > 5 ? "\n..." : "";
          msg += `\n${fmt.pre(fmt.escape(preview + suffix))}`;
        }
        return msg;
      }
      // --- Claude: Bash, PI: bash ---
      case "Bash":
      case "bash": {
        const cmd = (input.command as string) || (input.cmd as string) || "";
        if (!cmd) return null;
        const truncated = cmd.length > 200 ? cmd.slice(0, 200) + "..." : cmd;
        return `$ ${fmt.code(fmt.escape(truncated))}`;
      }
      // --- Codex: exec_command ---
      case "exec_command": {
        let cmd = "";
        if (typeof input.cmd === "string") cmd = input.cmd;
        else if (typeof input.command === "string") cmd = input.command;
        if (!cmd) return null;
        const truncated = cmd.length > 200 ? cmd.slice(0, 200) + "..." : cmd;
        return `$ ${fmt.code(fmt.escape(truncated))}`;
      }
      // --- Codex: apply_patch (file edits) ---
      case "apply_patch": {
        const patch = input.content as string | undefined;
        if (!patch) return `${fmt.escape("✏️")} ${fmt.code("apply_patch")}`;
        // Extract file path from patch header: "*** Update File: path"
        const fileMatch = patch.match(/\*\*\* (?:Update|Add) File: (.+)/);
        const fp = fileMatch?.[1] || "file";
        const preview = patch.split("\n").slice(0, 8).join("\n");
        const suffix = patch.split("\n").length > 8 ? "\n..." : "";
        return `${fmt.escape("✏️")} ${fmt.code(fmt.escape(fp))}\n${fmt.pre(fmt.escape(preview + suffix))}`;
      }
      // --- Codex: write_stdin ---
      case "write_stdin":
        return `${fmt.escape("⌨️")} ${fmt.code("write_stdin")}`;
      // --- Claude: Read ---
      case "Read": {
        const fp = input.file_path as string | undefined;
        if (!fp) return null;
        return `${fmt.escape("📖")} ${fmt.code(fmt.escape(fp))}`;
      }
      // --- Claude: Glob ---
      case "Glob": {
        const pattern = input.pattern as string | undefined;
        if (!pattern) return null;
        const path = input.path as string | undefined;
        const inPart = path ? ` in ${fmt.code(fmt.escape(path))}` : "";
        return `${fmt.escape("🔍")} ${fmt.code(fmt.escape(pattern))}${inPart}`;
      }
      // --- Claude: Grep ---
      case "Grep": {
        const pattern = input.pattern as string | undefined;
        if (!pattern) return null;
        const glob = input.glob as string | undefined;
        const path = input.path as string | undefined;
        const parts: string[] = [`${fmt.escape("🔍")} ${fmt.code(fmt.escape(pattern))}`];
        if (glob) parts.push(`in ${fmt.code(fmt.escape(glob))}`);
        else if (path) parts.push(`in ${fmt.code(fmt.escape(path))}`);
        return parts.join(" ");
      }
      // --- Claude: Task ---
      case "Task": {
        const desc = input.description as string | undefined;
        if (!desc) return null;
        return `${fmt.escape("🤖")} ${fmt.italic(fmt.escape(desc))}`;
      }
      case "LSP": {
        const op = input.operation as string | undefined;
        const fp = input.filePath as string | undefined;
        if (!op || !fp) return null;
        return `${fmt.escape("🔗")} ${fmt.escape(op)} ${fmt.code(fmt.escape(fp))}`;
      }
      case "WebSearch": {
        const query = input.query as string | undefined;
        if (!query) return null;
        return `${fmt.escape("🌐")} ${fmt.code(fmt.escape(query))}`;
      }
      case "WebFetch": {
        const url = input.url as string | undefined;
        if (!url) return null;
        return `${fmt.escape("🌐")} ${fmt.code(fmt.escape(url.length > 100 ? url.slice(0, 100) + "..." : url))}`;
      }
      default:
        return `${fmt.escape("🔧")} ${fmt.code(fmt.escape(name))}`;
    }
  }

  // Reap orphaned remote sessions whose CLI crashed without calling /exit
  const REAP_INTERVAL = 60_000;
  const REAP_MAX_AGE = 30_000;
  const reaperTimer = setInterval(async () => {
    const reaped = sessionManager.reapStaleRemotes(REAP_MAX_AGE);
    for (const remote of reaped) {
      await logger.info("Reaped stale remote session", { id: remote.id, command: remote.command });
      const msg = `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(sessionLabel(remote.command, remote.cwd)))} disconnected (CLI stopped responding)`;
      primaryChannel.send(remote.chatId, msg);
    }
    if (reaped.length > 0 && sessionManager.remoteCount() === 0 && sessionManager.runningCount() === 0) {
      scheduleAutoStop();
    }
  }, REAP_INTERVAL);

  onShutdown(async () => {
    clearInterval(reaperTimer);
    cancelAutoStop();
    for (const ch of channels) ch.stopReceiving();
    sessionManager.killAll();
  });

  await startControlServer({
    authToken: daemonAuthToken,
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
      await removeAuthToken();
      await removePidFile();
      await removeSocket();
      await removeControlPortFile();
      process.exit(0);
    },
    generatePairingCode() {
      return generatePairingCode();
    },
    async getChannels(): Promise<ChannelInfo[]> {
      await refreshConfig();
      const pairedUsers = getAllPairedUsers(config);
      const results: ChannelInfo[] = [];

      // DM channels: one per paired user per bot
      for (const user of pairedUsers) {
        const dmChatId = user.userId.startsWith("telegram:")
          ? `telegram:${user.userId.split(":")[1]}`
          : user.userId;
        let title = "DM";
        for (const ch of channels) {
          if (ch.getBotName) {
            try { title = await ch.getBotName(); } catch {}
            break;
          }
        }
        const bound = sessionManager.getAttachedRemote(dmChatId);
        results.push({
          chatId: dmChatId,
          title,
          type: "dm",
          busy: !!bound,
          busyLabel: bound ? sessionLabel(bound.command, bound.cwd) : null,
        });
      }

      // Linked groups and topics
      const rawGroups = getAllLinkedGroups(config);
      for (const g of rawGroups) {
        const parts = g.chatId.split(":");
        const isTopic = parts.length >= 3;
        const bound = sessionManager.getAttachedRemote(g.chatId);
        results.push({
          chatId: g.chatId,
          title: g.title || g.chatId,
          type: isTopic ? "topic" : "group",
          busy: !!bound,
          busyLabel: bound ? sessionLabel(bound.command, bound.cwd) : null,
        });
      }

      return results;
    },
    async registerRemote(command: string, chatId: ChannelChatId, ownerUserId: ChannelUserId, cwd: string, existingId?: string, subscribedGroups?: string[]): Promise<{ sessionId: string; dmBusy: boolean; dmBusyLabel?: string; linkedGroups: Array<{ chatId: string; title?: string }>; allLinkedGroups: Array<{ chatId: string; title?: string; busyLabel?: string }> }> {
      cancelAutoStop();
      const isReconnect = !!existingId && !sessionManager.getRemote(existingId);
      const remote = sessionManager.registerRemote(command, chatId, ownerUserId, cwd, existingId);

      // Restore group subscriptions (e.g. after daemon restart, CLI re-registers with saved groups)
      if (subscribedGroups) {
        for (const groupId of subscribedGroups) {
          sessionManager.subscribeGroup(remote.id, groupId);
        }
      }

      if (isReconnect) {
        const label = sessionLabel(command, cwd);
        primaryChannel.send(chatId, `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(label))} reconnected after daemon restart. Messages sent during restart may have been lost.`);
      }

      const existingBound = sessionManager.getAttachedRemote(chatId);
      const dmBusy = !!existingBound && existingBound.id !== remote.id;
      const dmBusyLabel = dmBusy && existingBound ? sessionLabel(existingBound.command, existingBound.cwd) : undefined;

      await refreshConfig();
      const rawGroups = getAllLinkedGroups(config);

      // Validate groups still exist, remove dead ones
      const validGroups: Array<{ chatId: string; title?: string }> = [];
      for (const g of rawGroups) {
        if (primaryChannel.validateChat) {
          const alive = await primaryChannel.validateChat(g.chatId);
          if (alive) {
            validGroups.push({ chatId: g.chatId, title: g.title });
          } else {
            await logger.info("Removing inaccessible linked group", { chatId: g.chatId, title: g.title });
            removeLinkedGroup(config, g.chatId);
            await saveConfig(config);
          }
        } else {
          validGroups.push({ chatId: g.chatId, title: g.title });
        }
      }

      const allLinkedGroups = validGroups.map((g) => {
        const bound = sessionManager.getAttachedRemote(g.chatId);
        const busyLabel = bound && bound.id !== remote.id ? sessionLabel(bound.command, bound.cwd) : undefined;
        return { chatId: g.chatId, title: g.title, busyLabel };
      });
      const linkedGroups = allLinkedGroups.filter((g) => !g.busyLabel);

      return { sessionId: remote.id, dmBusy, dmBusyLabel, linkedGroups, allLinkedGroups };
    },
    async bindChat(sessionId: string, chatId: ChannelChatId): Promise<{ ok: boolean; error?: string }> {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return { ok: false, error: "Session not found" };
      const isOwnerDm = remote.chatId === chatId;
      await refreshConfig();
      const isLinkedTarget = isLinkedGroup(config, chatId);
      if (!isOwnerDm && !isLinkedTarget) return { ok: false, error: "Group is not linked" };

      // Validate the chat still exists
      if (!isOwnerDm && primaryChannel.validateChat) {
        const alive = await primaryChannel.validateChat(chatId);
        if (!alive) {
          removeLinkedGroup(config, chatId);
          await saveConfig(config);
          return { ok: false, error: "Group no longer exists or bot was removed from it" };
        }
      }

      // Disconnect old session from this channel if taken
      const oldRemote = sessionManager.getAttachedRemote(chatId);
      if (oldRemote && oldRemote.id !== sessionId) {
        return {
          ok: false,
          error: `Channel is busy with ${sessionLabel(oldRemote.command, oldRemote.cwd)}`,
        };
      }

      // Remove auto-attached DM if binding to a different chat
      if (remote.chatId !== chatId) {
        sessionManager.detach(remote.chatId);
      }
      sessionManager.attach(chatId, sessionId);
      if (isLinkedTarget) {
        sessionManager.subscribeGroup(sessionId, chatId);
      }
      primaryChannel.send(chatId, `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(sessionLabel(remote.command, remote.cwd)))} connected`);
      return { ok: true };
    },
    canUserAccessSession(userId: ChannelUserId, sessionId: string): boolean {
      return sessionManager.canUserAccessSession(userId, sessionId);
    },
    drainRemoteInput(sessionId: string): string[] {
      return sessionManager.drainRemoteInput(sessionId);
    },
    pushRemoteInput(sessionId: string, text: string): boolean {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return false;
      remote.inputQueue.push(text);
      return true;
    },
    hasRemote(sessionId: string): boolean {
      return !!sessionManager.getRemote(sessionId);
    },
    endRemote(sessionId: string, exitCode: number | null): void {
      const remote = sessionManager.getRemote(sessionId);
      if (remote) {
        const status = exitCode === 0 ? "disconnected" : `disconnected (code ${exitCode ?? "unknown"})`;
        const msg = `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(sessionLabel(remote.command, remote.cwd)))} ${fmt.escape(status)}`;
        const boundChat = sessionManager.getBoundChat(sessionId);
        if (boundChat) {
          primaryChannel.send(boundChat, msg);
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
    getBoundChat(sessionId: string): string | null {
      return sessionManager.getBoundChat(sessionId);
    },
    async sendFileToSession(sessionId: string, filePath: string, caption?: string): Promise<{ ok: boolean; error?: string }> {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return { ok: false, error: "Session not found" };
      if (!primaryChannel.sendDocument) {
        return { ok: false, error: `Channel ${primaryChannel.type} does not support file sending` };
      }

      let fileStats;
      try {
        fileStats = await stat(filePath);
      } catch {
        return { ok: false, error: `File not found: ${filePath}` };
      }
      if (!fileStats.isFile()) return { ok: false, error: `Not a file: ${filePath}` };
      if (fileStats.size <= 0) return { ok: false, error: "File is empty" };
      if (fileStats.size > 50 * 1024 * 1024) return { ok: false, error: "File exceeds 50MB Telegram limit" };

      const targets = new Set<ChannelChatId>();
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      if (targetChat) targets.add(targetChat);
      for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
        targets.add(groupChatId);
      }
      if (targets.size === 0) return { ok: false, error: "No bound channel for this session" };

      const finalCaption = (caption && caption.trim()) || basename(filePath);
      for (const cid of targets) {
        await primaryChannel.sendDocument(cid, filePath, finalCaption);
      }
      return { ok: true };
    },
    handleToolCall(sessionId: string, name: string, input: Record<string, unknown>): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targetChat = sessionManager.getBoundChat(sessionId);
      if (!targetChat) return;
      const html = formatToolCall(fmt, name, input);
      if (!html) return;
      primaryChannel.send(targetChat, html);
      // Re-assert typing — send() clears it on Telegram's side
      primaryChannel.setTyping(targetChat, true);
    },
    handleApprovalNeeded(sessionId: string, name: string, input: Record<string, unknown>, promptText?: string, pollOptions?: string[]): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targetChat = sessionManager.getBoundChat(sessionId);
      if (!targetChat) return;
      if (!primaryChannel.sendPoll) return;
      // Use the prompt text from Claude Code's terminal if available
      let question: string;
      if (promptText) {
        question = promptText.slice(0, 300);
      } else {
        const detail = (input.command as string) || (input.file_path as string)
          || (input.pattern as string) || (input.query as string)
          || (input.url as string) || (input.description as string) || "";
        const label = detail.length > 200 ? detail.slice(0, 200) + "..." : detail;
        question = (label ? `${name}: ${label}` : name).slice(0, 300);
      }
      const options = pollOptions && pollOptions.length >= 2 ? pollOptions : ["Yes", "Yes, don't ask again", "No"];
      primaryChannel.sendPoll(targetChat, question, options, false).then(
        ({ pollId, messageId }) => {
          sessionManager.registerPoll(pollId, {
            sessionId,
            chatId: targetChat,
            messageId,
            questionIndex: 0,
            totalQuestions: 1,
            multiSelect: false,
            optionCount: 3,
          });
        }
      ).catch((e) => {
        logger.error("Failed to send tool approval poll", { sessionId, error: (e as Error).message });
      });
    },
    handleThinking(sessionId: string, text: string): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targetChat = sessionManager.getBoundChat(sessionId);
      if (!targetChat) return;
      const truncated = text.length > 1000 ? text.slice(0, 1000) + "..." : text;
      primaryChannel.send(targetChat, `${fmt.bold("Thinking")}\n${fmt.italic(fmt.escape(truncated))}`);
    },
    handleAssistantText(sessionId: string, text: string): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;

      const targets = new Set<ChannelChatId>();
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      if (targetChat) targets.add(targetChat);
      for (const groupChatId of sessionManager.getSubscribedGroups(sessionId)) {
        targets.add(groupChatId);
      }
      if (targets.size === 0) return;

      const html = fmt.fromMarkdown(text);
      for (const cid of targets) {
        primaryChannel.setTyping(cid, false);
        primaryChannel.send(cid, html);
      }
    },
    handleToolResult(sessionId: string, toolName: string, content: string, isError = false): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targetChat = sessionManager.getBoundChat(sessionId);
      if (!targetChat) return;
      const maxLen = 1500;
      const truncated = content.length > maxLen ? content.slice(0, maxLen) + "\n..." : content;
      const label = isError
        ? `${toolName || "Tool"} error`
        : (toolName === "Bash" ? "Output" : `${toolName} result`);
      primaryChannel.send(targetChat, `${fmt.bold(fmt.escape(label))}\n${fmt.pre(fmt.escape(truncated))}`);
      // Re-assert typing only for non-error results.
      if (!isError) primaryChannel.setTyping(targetChat, true);
    },
    handleQuestion(sessionId: string, questions: unknown[]): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      // Parse raw questions into AskQuestion format
      const parsed: AskQuestion[] = questions.map((q: unknown) => {
        const raw = q as Record<string, unknown>;
        const options = ((raw.options as Array<Record<string, unknown>>) || []).map((o) => ({
          label: (o.label as string) || "",
          description: o.description as string | undefined,
        }));
        return {
          question: (raw.question as string) || "",
          options,
          multiSelect: (raw.multiSelect as boolean) || false,
        };
      });
      const targetChat = sessionManager.getBoundChat(sessionId) || remote.chatId;
      sessionManager.setPendingQuestions(sessionId, parsed, targetChat);
      sendNextPoll(sessionId);
    },
  });

  // Start receiving on all channels
  for (const channel of channels) {
    channel.startReceiving(async (msg) => {
      await refreshConfig();
      await routeMessage(msg, { config, sessionManager, channel });
    });
  }

  await logger.info("Daemon started successfully");
}
