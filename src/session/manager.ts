import { randomBytes } from "crypto";
import type { ChannelChatId, ChannelUserId } from "../channel/types";
import { Session } from "./session";
import type { SessionInfo, SessionEvents } from "./types";
import type { TgSettings } from "../config/schema";
import { logger } from "../daemon/logger";

export interface RemoteSession {
  id: string;
  command: string;
  cwd: string;
  chatId: ChannelChatId;
  ownerUserId: ChannelUserId;
  inputQueue: string[];
}

export interface PendingPoll {
  sessionId: string;
  chatId: ChannelChatId;
  messageId: string;
  questionIndex: number;
  totalQuestions: number;
  multiSelect: boolean;
  optionCount: number; // number of real options (excluding "Other")
}

export interface AskQuestion {
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect: boolean;
}

export interface PendingQuestionSet {
  questions: AskQuestion[];
  currentIndex: number;
  chatId: ChannelChatId;
  answers: number[][]; // collected option_ids per question
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private remotes: Map<string, RemoteSession> = new Map();
  // Map: channelChatId → sessionId (attached session)
  private attachments: Map<ChannelChatId, string> = new Map();
  // Map: sessionId → set of group chatIds subscribed to output
  private groupSubscriptions: Map<string, Set<ChannelChatId>> = new Map();
  // Map: pollId → poll metadata (for routing poll answers)
  private pendingPolls: Map<string, PendingPoll> = new Map();
  // Map: sessionId → pending question set (for multi-question flows)
  private pendingQuestions: Map<string, PendingQuestionSet> = new Map();
  private settings: TgSettings;
  private eventHandlers: SessionEvents | null = null;

  constructor(settings: TgSettings) {
    this.settings = settings;
  }

  setEventHandlers(handlers: SessionEvents): void {
    this.eventHandlers = handlers;
  }

  spawn(command: string, args: string[], ownerChatId: ChannelChatId, ownerUserId: ChannelUserId): Session | null {
    if (this.sessions.size >= this.settings.maxSessions) {
      return null;
    }

    const events: SessionEvents = {
      onOutput: (id, data) => this.eventHandlers?.onOutput(id, data),
      onExit: (id, exitCode) => {
        this.eventHandlers?.onExit(id, exitCode);
        // Auto-detach users from this session
        for (const [userId, sid] of this.attachments) {
          if (sid === id) this.attachments.delete(userId);
        }
        // Clean up exited sessions after a delay
        setTimeout(() => {
          this.sessions.delete(id);
          this.groupSubscriptions.delete(id);
        }, 60000);
      },
    };

    const session = new Session(command, args, ownerChatId, ownerUserId, events, {
      minMs: this.settings.outputBatchMinMs,
      maxMs: this.settings.outputBatchMaxMs,
      maxChars: this.settings.outputBufferMaxChars,
    });

    this.sessions.set(session.id, session);
    // Auto-attach owner
    this.attachments.set(ownerChatId, session.id);

    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    const regular = Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      command: s.command,
      state: s.state as SessionInfo["state"],
      createdAt: s.createdAt,
      exitCode: s.exitCode,
      ownerChatId: s.ownerChatId,
      ownerUserId: s.ownerUserId,
    }));
    const remote = Array.from(this.remotes.values()).map((r) => ({
      id: r.id,
      command: r.command,
      state: "remote" as SessionInfo["state"],
      createdAt: "",
      exitCode: null,
      ownerChatId: r.chatId,
      ownerUserId: r.ownerUserId,
    }));
    return [...regular, ...remote];
  }

  listForUser(userId: ChannelUserId): SessionInfo[] {
    return this.list().filter((s) => s.ownerUserId === userId);
  }

  getAttached(chatId: ChannelChatId): Session | undefined {
    const id = this.attachments.get(chatId);
    if (!id || id.startsWith("r-")) return undefined;
    const session = this.sessions.get(id);
    if (!session || session.state === "exited") {
      this.attachments.delete(chatId);
      return undefined;
    }
    return session;
  }

  getAttachedRemote(chatId: ChannelChatId): RemoteSession | undefined {
    const id = this.attachments.get(chatId);
    if (!id || !id.startsWith("r-")) return undefined;
    const remote = this.remotes.get(id);
    if (!remote) {
      this.attachments.delete(chatId);
      return undefined;
    }
    return remote;
  }

  attach(chatId: ChannelChatId, sessionId: string): boolean {
    if (sessionId.startsWith("r-")) {
      if (!this.remotes.has(sessionId)) return false;
      this.removeChatFromAllGroupSubscriptions(chatId);
      this.attachments.set(chatId, sessionId);
      return true;
    }
    const session = this.sessions.get(sessionId);
    if (!session || session.state === "exited") return false;
    this.removeChatFromAllGroupSubscriptions(chatId);
    this.attachments.set(chatId, sessionId);
    return true;
  }

  detach(chatId: ChannelChatId): boolean {
    this.removeChatFromAllGroupSubscriptions(chatId);
    return this.attachments.delete(chatId);
  }

  // Reverse lookup: find which chat a session is bound to
  getBoundChat(sessionId: string): ChannelChatId | null {
    for (const [chatId, id] of this.attachments) {
      if (id === sessionId) return chatId;
    }
    return null;
  }

  stopSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.state !== "running") return false;
    session.stop();
    return true;
  }

  killSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.state !== "running") return false;
    session.kill();
    return true;
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.destroy();
    }
    this.sessions.clear();
    this.remotes.clear();
    this.attachments.clear();
    this.groupSubscriptions.clear();
  }

  registerRemote(
    command: string,
    chatId: ChannelChatId,
    ownerUserId: ChannelUserId,
    cwd: string = ""
  ): RemoteSession {
    const id = "r-" + randomBytes(3).toString("hex");
    const remote: RemoteSession = { id, command, cwd, chatId, ownerUserId, inputQueue: [] };
    this.remotes.set(id, remote);
    // Only auto-attach if no existing attachment (don't overwrite)
    if (!this.attachments.has(chatId)) {
      this.attachments.set(chatId, id);
    }
    return remote;
  }

  getRemote(id: string): RemoteSession | undefined {
    return this.remotes.get(id);
  }

  drainRemoteInput(id: string): string[] {
    const remote = this.remotes.get(id);
    if (!remote) return [];
    const lines = remote.inputQueue.splice(0);
    return lines;
  }

  removeRemote(id: string): void {
    const remote = this.remotes.get(id);
    if (remote) {
      for (const [chatId, sid] of this.attachments) {
        if (sid === id) this.attachments.delete(chatId);
      }
      this.remotes.delete(id);
      this.groupSubscriptions.delete(id);
      this.clearPendingQuestions(id);
    }
  }

  remoteCount(): number {
    return this.remotes.size;
  }

  runningCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.state === "running") count++;
    }
    return count;
  }

  listRemotes(): RemoteSession[] {
    return Array.from(this.remotes.values());
  }

  listRemotesForUser(userId: ChannelUserId): RemoteSession[] {
    return Array.from(this.remotes.values()).filter((r) => r.ownerUserId === userId);
  }

  canUserAccessSession(userId: ChannelUserId, sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) return session.ownerUserId === userId;
    const remote = this.remotes.get(sessionId);
    if (remote) return remote.ownerUserId === userId;
    return false;
  }

  subscribeGroup(sessionId: string, chatId: ChannelChatId): void {
    let groups = this.groupSubscriptions.get(sessionId);
    if (!groups) {
      groups = new Set();
      this.groupSubscriptions.set(sessionId, groups);
    }
    groups.add(chatId);
  }

  getSubscribedGroups(sessionId: string): ChannelChatId[] {
    const groups = this.groupSubscriptions.get(sessionId);
    return groups ? Array.from(groups) : [];
  }

  unsubscribeGroup(sessionId: string, chatId: ChannelChatId): void {
    const groups = this.groupSubscriptions.get(sessionId);
    if (groups) {
      groups.delete(chatId);
      if (groups.size === 0) this.groupSubscriptions.delete(sessionId);
    }
  }

  private removeChatFromAllGroupSubscriptions(chatId: ChannelChatId): void {
    for (const [sessionId, groups] of this.groupSubscriptions) {
      groups.delete(chatId);
      if (groups.size === 0) this.groupSubscriptions.delete(sessionId);
    }
  }

  setPendingQuestions(sessionId: string, questions: AskQuestion[], chatId: ChannelChatId): void {
    this.pendingQuestions.set(sessionId, { questions, currentIndex: 0, chatId, answers: [] });
  }

  getPendingQuestions(sessionId: string): PendingQuestionSet | undefined {
    return this.pendingQuestions.get(sessionId);
  }

  clearPendingQuestions(sessionId: string): void {
    // Also remove any associated polls
    for (const [pollId, poll] of this.pendingPolls) {
      if (poll.sessionId === sessionId) this.pendingPolls.delete(pollId);
    }
    this.pendingQuestions.delete(sessionId);
  }

  registerPoll(pollId: string, poll: PendingPoll): void {
    this.pendingPolls.set(pollId, poll);
  }

  getPollByPollId(pollId: string): PendingPoll | undefined {
    return this.pendingPolls.get(pollId);
  }

  removePoll(pollId: string): void {
    this.pendingPolls.delete(pollId);
  }

  getActivePollForSession(sessionId: string): { pollId: string; poll: PendingPoll } | undefined {
    for (const [pollId, poll] of this.pendingPolls) {
      if (poll.sessionId === sessionId) return { pollId, poll };
    }
    return undefined;
  }

}
