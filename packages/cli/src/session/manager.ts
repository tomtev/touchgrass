import { randomBytes } from "crypto";
import type { ChannelChatId, ChannelUserId } from "../channel/types";
import type { SessionInfo } from "./types";
import type { TgSettings } from "../config/schema";
import { mergeRemoteControlAction, type RemoteControlAction } from "./remote-control";

export interface RemoteSession {
  id: string;
  command: string;
  cwd: string;
  name?: string;
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
  question?: string;
  optionLabels?: string[];
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

export type PendingFilePickerOption =
  | { kind: "toggle"; mention: string }
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "clear" }
  | { kind: "cancel" };

export interface ResumeSessionCandidate {
  sessionRef: string;
  label: string;
  mtimeMs: number;
}

export type PendingResumePickerOption =
  | { kind: "session"; sessionRef: string; label: string }
  | { kind: "more"; nextOffset: number };

export interface PendingFilePicker {
  pollId: string;
  messageId: string;
  chatId: ChannelChatId;
  ownerUserId: ChannelUserId;
  sessionId: string;
  files: string[];
  query: string;
  page: number;
  pageSize: number;
  totalPages: number;
  selectedMentions: string[];
  options: PendingFilePickerOption[];
}

export interface PendingResumePicker {
  pollId: string;
  messageId: string;
  chatId: ChannelChatId;
  ownerUserId: ChannelUserId;
  sessionId: string;
  tool: string;
  sessions: ResumeSessionCandidate[];
  offset: number;
  options: PendingResumePickerOption[];
}

export interface PendingOutputModePicker {
  pollId: string;
  messageId: string;
  chatId: ChannelChatId;
  ownerUserId: ChannelUserId;
  options: Array<"compact" | "verbose">;
}

export interface PendingRecentMessagesPoll {
  sessionId: string;
  chatId: ChannelChatId;
  messageId: string;
}

export type RemoteControlPickerOption =
  | { kind: "session"; sessionId: string; label: string }
  | { kind: "exit" };

export interface PendingRemoteControlPicker {
  pollId: string;
  messageId: string;
  chatId: ChannelChatId;
  ownerUserId: ChannelUserId;
  options: RemoteControlPickerOption[];
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
  // Map: pollId → pending resume picker metadata
  private pendingResumePickers: Map<string, PendingResumePicker> = new Map();
  // Map: pollId → pending output mode picker metadata
  private pendingOutputModePickers: Map<string, PendingOutputModePicker> = new Map();
  // Map: pollId → pending remote control picker metadata
  private pendingRemoteControlPickers: Map<string, PendingRemoteControlPicker> = new Map();
  // Map: pollId → pending "load recent messages?" poll metadata
  private pendingRecentMessagesPolls: Map<string, PendingRecentMessagesPoll> = new Map();
  // Map: sessionId|chatId|userId → file mentions to prepend on next text input
  private pendingFileMentions: Map<string, string[]> = new Map();

  constructor(_settings: TgSettings) {}

  list(): SessionInfo[] {
    const remote = Array.from(this.remotes.values()).map((r) => ({
      id: r.id,
      command: r.command,
      name: r.name,
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
    for (const [existingChatId, existingSessionId] of this.attachments) {
      if (existingSessionId === sessionId) {
        this.attachments.delete(existingChatId);
      }
    }
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

  requestRemoteResume(id: string, sessionRef: string): boolean {
    const remote = this.remotes.get(id);
    if (!remote) return false;
    remote.controlAction = mergeRemoteControlAction(remote.controlAction, {
      type: "resume",
      sessionRef,
    });
    return true;
  }

  killAll(): void {
    this.remotes.clear();
    this.attachments.clear();
    this.groupSubscriptions.clear();
    this.pendingFilePickers.clear();
    this.pendingResumePickers.clear();
    this.pendingOutputModePickers.clear();
    this.pendingRemoteControlPickers.clear();
    this.pendingRecentMessagesPolls.clear();
    this.pendingFileMentions.clear();
  }

  registerRemote(
    command: string,
    chatId: ChannelChatId,
    ownerUserId: ChannelUserId,
    cwd: string = "",
    existingId?: string,
    name?: string
  ): RemoteSession {
    // If re-registering with an existing ID, return it if it already exists (idempotent)
    if (existingId) {
      const existing = this.remotes.get(existingId);
      if (existing) return existing;
    }
    const id = existingId || "r-" + randomBytes(8).toString("hex");
    const remote: RemoteSession = {
      id,
      command,
      cwd,
      name,
      chatId,
      ownerUserId,
      inputQueue: [],
      controlAction: null,
      lastSeenAt: Date.now(),
    };
    this.remotes.set(id, remote);
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
      for (const [pollId, picker] of this.pendingResumePickers) {
        if (picker.sessionId === id) this.pendingResumePickers.delete(pollId);
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

  registerResumePicker(picker: PendingResumePicker): void {
    this.pendingResumePickers.set(picker.pollId, picker);
  }

  getResumePickerByPollId(pollId: string): PendingResumePicker | undefined {
    return this.pendingResumePickers.get(pollId);
  }

  removeResumePicker(pollId: string): void {
    this.pendingResumePickers.delete(pollId);
  }

  registerOutputModePicker(picker: PendingOutputModePicker): void {
    this.pendingOutputModePickers.set(picker.pollId, picker);
  }

  getOutputModePickerByPollId(pollId: string): PendingOutputModePicker | undefined {
    return this.pendingOutputModePickers.get(pollId);
  }

  removeOutputModePicker(pollId: string): void {
    this.pendingOutputModePickers.delete(pollId);
  }

  registerRemoteControlPicker(picker: PendingRemoteControlPicker): void {
    this.pendingRemoteControlPickers.set(picker.pollId, picker);
  }

  getRemoteControlPickerByPollId(pollId: string): PendingRemoteControlPicker | undefined {
    return this.pendingRemoteControlPickers.get(pollId);
  }

  removeRemoteControlPicker(pollId: string): void {
    this.pendingRemoteControlPickers.delete(pollId);
  }

  registerRecentMessagesPoll(pollId: string, poll: PendingRecentMessagesPoll): void {
    this.pendingRecentMessagesPolls.set(pollId, poll);
  }

  getRecentMessagesPoll(pollId: string): PendingRecentMessagesPoll | undefined {
    return this.pendingRecentMessagesPolls.get(pollId);
  }

  removeRecentMessagesPoll(pollId: string): void {
    this.pendingRecentMessagesPolls.delete(pollId);
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

  /** Returns all sessions that currently need user input (approval poll or question). */
  getInputNeeded(): Array<{ sessionId: string; command: string; type: 'approval' | 'question' }> {
    const result: Array<{ sessionId: string; command: string; type: 'approval' | 'question' }> = [];
    const seen = new Set<string>();

    // Check for pending questions
    for (const [sessionId, _qs] of this.pendingQuestions) {
      const remote = this.remotes.get(sessionId);
      if (remote) {
        result.push({ sessionId, command: remote.command, type: 'question' });
        seen.add(sessionId);
      }
    }

    // Check for pending approval polls
    for (const [_pollId, poll] of this.pendingPolls) {
      if (!seen.has(poll.sessionId)) {
        const remote = this.remotes.get(poll.sessionId);
        if (remote) {
          result.push({ sessionId: poll.sessionId, command: remote.command, type: 'approval' });
          seen.add(poll.sessionId);
        }
      }
    }

    return result;
  }

  reapStaleRemotes(maxAgeMs: number): Array<RemoteSession & { boundChatId: ChannelChatId | null }> {
    const now = Date.now();
    const reaped: Array<RemoteSession & { boundChatId: ChannelChatId | null }> = [];
    for (const remote of this.remotes.values()) {
      if (now - remote.lastSeenAt > maxAgeMs) {
        const boundChatId = this.getBoundChat(remote.id);
        reaped.push({ ...remote, boundChatId });
        this.removeRemote(remote.id);
      }
    }
    return reaped;
  }

}
