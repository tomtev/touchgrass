import { randomBytes } from "crypto";
import type { ChannelChatId, ChannelUserId } from "../channel/types";
import type { SessionInfo } from "./types";
import type { TgSettings } from "../config/schema";
import { mergeRemoteControlAction, type RemoteControlAction } from "./remote-control";

export interface RemoteSession {
  id: string;
  command: string;
  cwd: string;
  chatId: ChannelChatId;
  ownerUserId: ChannelUserId;
  inputQueue: string[];
  controlAction: RemoteControlAction | null;
  lastSeenAt: number;
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

export interface PendingFilePicker {
  pollId: string;
  messageId: string;
  chatId: ChannelChatId;
  ownerUserId: ChannelUserId;
  sessionId: string;
  fileMentions: string[];
}

export class SessionManager {
  private remotes: Map<string, RemoteSession> = new Map();
  // Map: channelChatId → sessionId (attached session)
  private attachments: Map<ChannelChatId, string> = new Map();
  // Map: sessionId → set of group chatIds subscribed to output
  private groupSubscriptions: Map<string, Set<ChannelChatId>> = new Map();
  // Map: pollId → poll metadata (for routing poll answers)
  private pendingPolls: Map<string, PendingPoll> = new Map();
  // Map: sessionId → pending question set (for multi-question flows)
  private pendingQuestions: Map<string, PendingQuestionSet> = new Map();
  // Map: pollId → pending file picker metadata
  private pendingFilePickers: Map<string, PendingFilePicker> = new Map();
  // Map: sessionId|chatId|userId → file mentions to prepend on next text input
  private pendingFileMentions: Map<string, string[]> = new Map();

  constructor(_settings: TgSettings) {}

  list(): SessionInfo[] {
    const remote = Array.from(this.remotes.values()).map((r) => ({
      id: r.id,
      command: r.command,
      state: "remote" as SessionInfo["state"],
      createdAt: "",
      exitCode: null,
      ownerChatId: r.chatId,
      ownerUserId: r.ownerUserId,
    }));
    return remote;
  }

  listForUser(userId: ChannelUserId): SessionInfo[] {
    return this.list().filter((s) => s.ownerUserId === userId);
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
    if (!sessionId.startsWith("r-")) return false;
    if (!this.remotes.has(sessionId)) return false;
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
    // For remote sessions, prefer an explicitly attached non-owner chat
    // (group/topic) over owner DM if both are attached.
    const remote = this.remotes.get(sessionId);
    if (remote) {
      let ownerDmAttached = false;
      for (const [chatId, id] of this.attachments) {
        if (id !== sessionId) continue;
        if (chatId === remote.chatId) {
          ownerDmAttached = true;
          continue;
        }
        return chatId;
      }
      return ownerDmAttached ? remote.chatId : null;
    }

    for (const [chatId, id] of this.attachments) {
      if (id === sessionId) return chatId;
    }
    return null;
  }

  requestRemoteStop(id: string): boolean {
    const remote = this.remotes.get(id);
    if (!remote) return false;
    remote.controlAction = mergeRemoteControlAction(remote.controlAction, "stop");
    return true;
  }

  requestRemoteKill(id: string): boolean {
    const remote = this.remotes.get(id);
    if (!remote) return false;
    remote.controlAction = mergeRemoteControlAction(remote.controlAction, "kill");
    return true;
  }

  killAll(): void {
    this.remotes.clear();
    this.attachments.clear();
    this.groupSubscriptions.clear();
    this.pendingFilePickers.clear();
    this.pendingFileMentions.clear();
  }

  registerRemote(
    command: string,
    chatId: ChannelChatId,
    ownerUserId: ChannelUserId,
    cwd: string = "",
    existingId?: string
  ): RemoteSession {
    // If re-registering with an existing ID, return it if it already exists (idempotent)
    if (existingId) {
      const existing = this.remotes.get(existingId);
      if (existing) return existing;
    }
    const id = existingId || "r-" + randomBytes(3).toString("hex");
    const remote: RemoteSession = {
      id,
      command,
      cwd,
      chatId,
      ownerUserId,
      inputQueue: [],
      controlAction: null,
      lastSeenAt: Date.now(),
    };
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
    remote.lastSeenAt = Date.now();
    const lines = remote.inputQueue.splice(0);
    return lines;
  }

  drainRemoteControl(id: string): RemoteControlAction | null {
    const remote = this.remotes.get(id);
    if (!remote) return null;
    remote.lastSeenAt = Date.now();
    const action = remote.controlAction;
    remote.controlAction = null;
    return action;
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
      for (const [pollId, picker] of this.pendingFilePickers) {
        if (picker.sessionId === id) this.pendingFilePickers.delete(pollId);
      }
      for (const key of this.pendingFileMentions.keys()) {
        if (key.startsWith(`${id}|`)) this.pendingFileMentions.delete(key);
      }
    }
  }

  remoteCount(): number {
    return this.remotes.size;
  }

  listRemotes(): RemoteSession[] {
    return Array.from(this.remotes.values());
  }

  listRemotesForUser(userId: ChannelUserId): RemoteSession[] {
    return Array.from(this.remotes.values()).filter((r) => r.ownerUserId === userId);
  }

  canUserAccessSession(userId: ChannelUserId, sessionId: string): boolean {
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

  registerFilePicker(picker: PendingFilePicker): void {
    this.pendingFilePickers.set(picker.pollId, picker);
  }

  getFilePickerByPollId(pollId: string): PendingFilePicker | undefined {
    return this.pendingFilePickers.get(pollId);
  }

  removeFilePicker(pollId: string): void {
    this.pendingFilePickers.delete(pollId);
  }

  setPendingFileMentions(
    sessionId: string,
    chatId: ChannelChatId,
    userId: ChannelUserId,
    mentions: string[]
  ): void {
    const key = `${sessionId}|${chatId}|${userId}`;
    const normalized = mentions.map((m) => m.trim()).filter(Boolean);
    if (normalized.length === 0) {
      this.pendingFileMentions.delete(key);
      return;
    }
    this.pendingFileMentions.set(key, normalized);
  }

  consumePendingFileMentions(
    sessionId: string,
    chatId: ChannelChatId,
    userId: ChannelUserId
  ): string[] {
    const key = `${sessionId}|${chatId}|${userId}`;
    const mentions = this.pendingFileMentions.get(key);
    if (!mentions) return [];
    this.pendingFileMentions.delete(key);
    return mentions;
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

  reapStaleRemotes(maxAgeMs: number): RemoteSession[] {
    const now = Date.now();
    const reaped: RemoteSession[] = [];
    for (const remote of this.remotes.values()) {
      if (now - remote.lastSeenAt > maxAgeMs) {
        reaped.push({ ...remote });
        this.removeRemote(remote.id);
      }
    }
    return reaped;
  }

}
