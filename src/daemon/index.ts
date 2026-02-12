import { loadConfig } from "../config/store";
import { getTelegramBotToken, getAllLinkedGroups, isLinkedGroup } from "../config/schema";
import { logger } from "./logger";
import { writePidFile, installSignalHandlers, onShutdown, removeAuthToken, removePidFile, removeSocket } from "./lifecycle";
import { startControlServer } from "./control-server";
import { routeMessage } from "../bot/command-router";
import { SessionManager } from "../session/manager";
import { generatePairingCode } from "../security/pairing";
import { isUserPaired } from "../security/allowlist";
import { rotateDaemonAuthToken } from "../security/daemon-auth";
import { TelegramChannel } from "../channels/telegram/channel";
import { escapeHtml } from "../channels/telegram/formatter";
import type { Channel, ChannelChatId, ChannelUserId } from "../channel/types";
import type { AskQuestion } from "../session/manager";
import type { TelegramPollAnswer } from "../channels/telegram/api";

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
  const daemonAuthToken = await rotateDaemonAuthToken();

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
        await removeAuthToken();
        await removePidFile();
        await removeSocket();
        process.exit(0);
      }
    }, AUTO_STOP_DELAY);
  }

  // Use the first channel for sending notifications (daemon-initiated messages)
  const primaryChannel = channels[0];

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
    // Build options for Telegram poll (max 10 real options, Telegram limit is 10)
    const optionLabels = q.options.slice(0, 9).map((o) => o.label);
    optionLabels.push("Other (type a reply)");

    const tgChannel = primaryChannel as TelegramChannel;
    try {
      const questionText = q.question.length > 300 ? q.question.slice(0, 297) + "..." : q.question;
      const { pollId, messageId } = await tgChannel.sendPoll(
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

  function handlePollAnswer(answer: TelegramPollAnswer) {
    const poll = sessionManager.getPollByPollId(answer.poll_id);
    if (!poll) return;
    const answerUserId = `telegram:${answer.user.id}`;
    if (!isUserPaired(config, answerUserId)) {
      logger.warn("Ignoring poll answer from unpaired user", { userId: answerUserId, pollId: answer.poll_id });
      return;
    }

    const remote = sessionManager.getRemote(poll.sessionId);
    if (!remote) return;
    if (remote.ownerUserId !== answerUserId) {
      logger.warn("Ignoring poll answer from non-owner", {
        userId: answerUserId,
        sessionId: poll.sessionId,
        ownerUserId: remote.ownerUserId,
      });
      return;
    }

    const tgChannel = primaryChannel as TelegramChannel;

    // Close the poll
    tgChannel.closePoll(poll.chatId, poll.messageId).catch(() => {});
    sessionManager.removePoll(answer.poll_id);

    const otherIdx = poll.optionCount; // "Other" is the last option
    const selectedOther = answer.option_ids.includes(otherIdx);

    if (selectedOther) {
      // User chose "Other" — push marker, wait for text message
      remote.inputQueue.push("\x1b[POLL_OTHER]");
      // Don't advance to next question; text handler will do that
      sessionManager.clearPendingQuestions(poll.sessionId);
    } else {
      // Encode selected options
      const encoded = `\x1b[POLL:${answer.option_ids.join(",")}:${poll.multiSelect ? "1" : "0"}]`;
      remote.inputQueue.push(encoded);

      // For multi-select, need to navigate Down to "Next"/"Submit" and press Enter
      // (single-select Enter already advances automatically)
      // Encode last cursor position and option count so CLI can calculate Downs needed
      if (poll.multiSelect) {
        const lastPos = answer.option_ids.length > 0 ? Math.max(...answer.option_ids) : 0;
        remote.inputQueue.push(`\x1b[POLL_NEXT:${lastPos}:${poll.optionCount}]`);
      }

      // Record answer and advance
      const pending = sessionManager.getPendingQuestions(poll.sessionId);
      if (pending) {
        pending.answers.push(answer.option_ids);
        pending.currentIndex++;
        sendNextPoll(poll.sessionId);
      }
    }
  }

  // Wire poll answer handler on all Telegram channels
  for (const channel of channels) {
    if (channel instanceof TelegramChannel) {
      channel.onPollAnswer = handlePollAnswer;
    }
  }

  function formatToolCall(name: string, input: Record<string, unknown>): string | null {
    switch (name) {
      // --- Claude: Edit ---
      case "Edit": {
        const fp = input.file_path as string | undefined;
        if (!fp) return null;
        let html = `✏️ <code>${escapeHtml(fp)}</code>`;
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
            html += `\n<pre>${escapeHtml(diffLines.join("\n"))}</pre>`;
          }
        }
        return html;
      }
      // --- Claude: Write ---
      case "Write": {
        const fp = input.file_path as string | undefined;
        if (!fp) return null;
        let html = `📄 <code>${escapeHtml(fp)}</code>`;
        const content = input.content as string | undefined;
        if (content) {
          const lines = content.split("\n");
          const preview = lines.slice(0, 5).join("\n");
          const suffix = lines.length > 5 ? "\n..." : "";
          html += `\n<pre>${escapeHtml(preview + suffix)}</pre>`;
        }
        return html;
      }
      // --- Claude: Bash, PI: bash ---
      case "Bash":
      case "bash": {
        const cmd = (input.command as string) || (input.cmd as string) || "";
        if (!cmd) return null;
        const truncated = cmd.length > 200 ? cmd.slice(0, 200) + "..." : cmd;
        return `$ <code>${escapeHtml(truncated)}</code>`;
      }
      // --- Codex: exec_command ---
      case "exec_command": {
        let cmd = "";
        if (typeof input.cmd === "string") cmd = input.cmd;
        else if (typeof input.command === "string") cmd = input.command;
        if (!cmd) return null;
        const truncated = cmd.length > 200 ? cmd.slice(0, 200) + "..." : cmd;
        return `$ <code>${escapeHtml(truncated)}</code>`;
      }
      // --- Codex: apply_patch (file edits) ---
      case "apply_patch": {
        const patch = input.content as string | undefined;
        if (!patch) return `✏️ <code>apply_patch</code>`;
        // Extract file path from patch header: "*** Update File: path"
        const fileMatch = patch.match(/\*\*\* (?:Update|Add) File: (.+)/);
        const fp = fileMatch?.[1] || "file";
        const preview = patch.split("\n").slice(0, 8).join("\n");
        const suffix = patch.split("\n").length > 8 ? "\n..." : "";
        return `✏️ <code>${escapeHtml(fp)}</code>\n<pre>${escapeHtml(preview + suffix)}</pre>`;
      }
      // --- Codex: write_stdin ---
      case "write_stdin":
        return `⌨️ <code>write_stdin</code>`;
      // --- Claude: Read ---
      case "Read": {
        const fp = input.file_path as string | undefined;
        if (!fp) return null;
        return `📖 <code>${escapeHtml(fp)}</code>`;
      }
      // --- Claude: Glob ---
      case "Glob": {
        const pattern = input.pattern as string | undefined;
        if (!pattern) return null;
        const path = input.path as string | undefined;
        const inPart = path ? ` in <code>${escapeHtml(path)}</code>` : "";
        return `🔍 <code>${escapeHtml(pattern)}</code>${inPart}`;
      }
      // --- Claude: Grep ---
      case "Grep": {
        const pattern = input.pattern as string | undefined;
        if (!pattern) return null;
        const glob = input.glob as string | undefined;
        const path = input.path as string | undefined;
        const parts: string[] = [`🔍 <code>${escapeHtml(pattern)}</code>`];
        if (glob) parts.push(`in <code>${escapeHtml(glob)}</code>`);
        else if (path) parts.push(`in <code>${escapeHtml(path)}</code>`);
        return parts.join(" ");
      }
      // --- Claude: Task ---
      case "Task": {
        const desc = input.description as string | undefined;
        if (!desc) return null;
        return `🤖 <i>${escapeHtml(desc)}</i>`;
      }
      case "LSP": {
        const op = input.operation as string | undefined;
        const fp = input.filePath as string | undefined;
        if (!op || !fp) return null;
        return `🔗 ${escapeHtml(op)} <code>${escapeHtml(fp)}</code>`;
      }
      case "WebSearch": {
        const query = input.query as string | undefined;
        if (!query) return null;
        return `🌐 <code>${escapeHtml(query)}</code>`;
      }
      case "WebFetch": {
        const url = input.url as string | undefined;
        if (!url) return null;
        return `🌐 <code>${escapeHtml(url.length > 100 ? url.slice(0, 100) + "..." : url)}</code>`;
      }
      default:
        return `🔧 <code>${escapeHtml(name)}</code>`;
    }
  }

  onShutdown(async () => {
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
      process.exit(0);
    },
    generatePairingCode() {
      return generatePairingCode();
    },
    registerRemote(command: string, chatId: ChannelChatId, ownerUserId: ChannelUserId, cwd: string, name: string): { sessionId: string; dmBusy: boolean; linkedGroups: Array<{ chatId: string; title?: string }>; allLinkedGroups: Array<{ chatId: string; title?: string }> } {
      cancelAutoStop();
      const remote = sessionManager.registerRemote(command, chatId, ownerUserId, cwd, name);

      const existingBound = sessionManager.getAttachedRemote(chatId);
      const dmBusy = !!existingBound && existingBound.id !== remote.id;

      const allLinkedGroups = getAllLinkedGroups(config).map((g) => ({
        chatId: g.chatId,
        title: g.title,
      }));
      const linkedGroups = allLinkedGroups.filter((g) => {
        const bound = sessionManager.getAttachedRemote(g.chatId);
        return !bound || bound.id === remote.id;
      });

      return { sessionId: remote.id, dmBusy, linkedGroups, allLinkedGroups };
    },
    bindChat(sessionId: string, chatId: ChannelChatId): boolean {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return false;
      const isOwnerDm = remote.chatId === chatId;
      const isLinkedTarget = isLinkedGroup(config, chatId);
      if (!isOwnerDm && !isLinkedTarget) return false;
      // Remove auto-attached DM if binding to a different chat
      if (remote.chatId !== chatId) {
        sessionManager.detach(remote.chatId);
      }
      sessionManager.attach(chatId, sessionId);
      if (isLinkedTarget) {
        sessionManager.subscribeGroup(sessionId, chatId);
      }
      const label = remote.name || remote.cwd.split("/").pop() || remote.cwd;
      const tool = remote.command.split(" ")[0];
      primaryChannel.send(chatId, `⛳️ <b>${escapeHtml(label)}</b> [${escapeHtml(tool)}] started`);
      return true;
    },
    canUserAccessSession(userId: ChannelUserId, sessionId: string): boolean {
      return sessionManager.canUserAccessSession(userId, sessionId);
    },
    drainRemoteInput(sessionId: string): string[] {
      return sessionManager.drainRemoteInput(sessionId);
    },
    endRemote(sessionId: string, exitCode: number | null): void {
      const remote = sessionManager.getRemote(sessionId);
      if (remote) {
        const label = remote.name || remote.cwd.split("/").pop() || remote.cwd;
        const tool = remote.command.split(" ")[0];
        const status = exitCode === 0 ? "exited" : `exited with code ${exitCode ?? "unknown"}`;
        const msg = `⛳️ <b>${escapeHtml(label)}</b> [${escapeHtml(tool)}] ${escapeHtml(status)}`;
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
    handleToolCall(sessionId: string, name: string, input: Record<string, unknown>): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targetChat = sessionManager.getBoundChat(sessionId);
      if (!targetChat) return;
      const html = formatToolCall(name, input);
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
      const tgChannel = primaryChannel as TelegramChannel;
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
      tgChannel.sendPoll(targetChat, question, options, false).then(
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
      const html = `<b>Thinking</b>\n<i>${escapeHtml(truncated)}</i>`;
      primaryChannel.send(targetChat, html);
    },
    handleToolResult(sessionId: string, toolName: string, content: string): void {
      const remote = sessionManager.getRemote(sessionId);
      if (!remote) return;
      const targetChat = sessionManager.getBoundChat(sessionId);
      if (!targetChat) return;
      const maxLen = 1500;
      const truncated = content.length > maxLen ? content.slice(0, maxLen) + "\n..." : content;
      const label = toolName === "Bash" ? "Output" : `${toolName} result`;
      const html = `<b>${escapeHtml(label)}</b>\n<pre>${escapeHtml(truncated)}</pre>`;
      primaryChannel.send(targetChat, html);
      // Re-assert typing — agent is still working after tool result
      primaryChannel.setTyping(targetChat, true);
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
      await routeMessage(msg, { config, sessionManager, channel });
    });
  }

  await logger.info("Daemon started successfully");
}
