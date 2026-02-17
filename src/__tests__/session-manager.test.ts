import { describe, it, expect } from "bun:test";
import { SessionManager } from "../session/manager";
import { defaultSettings } from "../config/schema";
import type { ChannelChatId, ChannelUserId } from "../channel/types";

function createManager(): SessionManager {
  return new SessionManager({ ...defaultSettings });
}

describe("registerRemote", () => {
  it("creates a remote session with r- prefix", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId, "/tmp");
    expect(remote.id).toMatch(/^r-[a-f0-9]{6}$/);
    expect(remote.command).toBe("claude");
    expect(remote.cwd).toBe("/tmp");
    expect(remote.chatId).toBe("telegram:100");
    expect(remote.ownerUserId).toBe("telegram:100");
    expect(remote.inputQueue).toEqual([]);
    expect(remote.controlAction).toBeNull();
  });

  it("auto-attaches to chatId when no existing attachment", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    const attached = mgr.getAttachedRemote("telegram:100" as ChannelChatId);
    expect(attached).toBeDefined();
    expect(attached!.id).toBe(remote.id);
  });

  it("does not overwrite existing attachment on same chatId", () => {
    const mgr = createManager();
    const first = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    const second = mgr.registerRemote("codex", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    const attached = mgr.getAttachedRemote("telegram:100" as ChannelChatId);
    expect(attached!.id).toBe(first.id);
    // Second session still exists
    expect(mgr.getRemote(second.id)).toBeDefined();
  });
});

describe("attach / detach", () => {
  it("attaches a chat to a remote session", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    // Attach a group to the session
    const result = mgr.attach("telegram:-200" as ChannelChatId, remote.id);
    expect(result).toBe(true);
    const attached = mgr.getAttachedRemote("telegram:-200" as ChannelChatId);
    expect(attached!.id).toBe(remote.id);
  });

  it("returns false when attaching to nonexistent session", () => {
    const mgr = createManager();
    const result = mgr.attach("telegram:100" as ChannelChatId, "r-nonexist");
    expect(result).toBe(false);
  });

  it("detach removes the attachment", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    mgr.detach("telegram:100" as ChannelChatId);
    const attached = mgr.getAttachedRemote("telegram:100" as ChannelChatId);
    expect(attached).toBeUndefined();
  });

  it("detach returns false when chat was not attached", () => {
    const mgr = createManager();
    const result = mgr.detach("telegram:999" as ChannelChatId);
    expect(result).toBe(false);
  });

  it("attach removes chat from group subscriptions", () => {
    const mgr = createManager();
    const r1 = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    const r2 = mgr.registerRemote("codex", "telegram:200" as ChannelChatId, "telegram:200" as ChannelUserId);
    mgr.subscribeGroup(r1.id, "telegram:-300" as ChannelChatId);
    // Now attach that group to r2 — should remove its subscription from r1
    mgr.attach("telegram:-300" as ChannelChatId, r2.id);
    expect(mgr.getSubscribedGroups(r1.id)).toEqual([]);
  });
});

describe("subscribeGroup / getSubscribedGroups", () => {
  it("subscribes a group to a session", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    mgr.subscribeGroup(remote.id, "telegram:-200" as ChannelChatId);
    expect(mgr.getSubscribedGroups(remote.id)).toEqual(["telegram:-200"]);
  });

  it("returns empty array for unknown session", () => {
    const mgr = createManager();
    expect(mgr.getSubscribedGroups("r-unknown")).toEqual([]);
  });

  it("does not duplicate subscriptions", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    mgr.subscribeGroup(remote.id, "telegram:-200" as ChannelChatId);
    mgr.subscribeGroup(remote.id, "telegram:-200" as ChannelChatId);
    expect(mgr.getSubscribedGroups(remote.id)).toEqual(["telegram:-200"]);
  });

  it("tracks multiple groups per session", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    mgr.subscribeGroup(remote.id, "telegram:-200" as ChannelChatId);
    mgr.subscribeGroup(remote.id, "telegram:-300" as ChannelChatId);
    const groups = mgr.getSubscribedGroups(remote.id);
    expect(groups).toHaveLength(2);
    expect(groups).toContain("telegram:-200");
    expect(groups).toContain("telegram:-300");
  });
});

describe("getAttachedRemote", () => {
  it("returns the attached remote session", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    const found = mgr.getAttachedRemote("telegram:100" as ChannelChatId);
    expect(found).toBeDefined();
    expect(found!.id).toBe(remote.id);
  });

  it("returns undefined for non-remote attachment", () => {
    const mgr = createManager();
    // No sessions — nothing attached
    expect(mgr.getAttachedRemote("telegram:100" as ChannelChatId)).toBeUndefined();
  });

  it("cleans up stale attachment when remote was removed", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    mgr.removeRemote(remote.id);
    // Attachment still exists in map but remote is gone — should auto-cleanup
    expect(mgr.getAttachedRemote("telegram:100" as ChannelChatId)).toBeUndefined();
  });
});

describe("canUserAccessSession", () => {
  it("returns true for the owner of a remote session", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    expect(mgr.canUserAccessSession("telegram:100" as ChannelUserId, remote.id)).toBe(true);
  });

  it("returns false for a different user", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    expect(mgr.canUserAccessSession("telegram:999" as ChannelUserId, remote.id)).toBe(false);
  });

  it("returns false for nonexistent session", () => {
    const mgr = createManager();
    expect(mgr.canUserAccessSession("telegram:100" as ChannelUserId, "r-nonexist")).toBe(false);
  });
});

describe("drainRemoteInput", () => {
  it("returns and clears queued input", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    remote.inputQueue.push("hello", "world");
    const drained = mgr.drainRemoteInput(remote.id);
    expect(drained).toEqual(["hello", "world"]);
    expect(mgr.drainRemoteInput(remote.id)).toEqual([]);
  });

  it("returns empty array for unknown session", () => {
    const mgr = createManager();
    expect(mgr.drainRemoteInput("r-unknown")).toEqual([]);
  });

  it("keeps remote control requests separate from input queue", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    remote.inputQueue.push("hello");
    expect(mgr.requestRemoteStop(remote.id)).toBe(true);
    expect(mgr.drainRemoteInput(remote.id)).toEqual(["hello"]);
    expect(mgr.drainRemoteControl(remote.id)).toBe("stop");
    expect(mgr.drainRemoteControl(remote.id)).toBeNull();
  });

  it("remote kill preempts prior remote stop request", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    expect(mgr.requestRemoteStop(remote.id)).toBe(true);
    expect(mgr.requestRemoteKill(remote.id)).toBe(true);
    expect(mgr.drainRemoteControl(remote.id)).toBe("kill");
  });

  it("can enqueue resume control actions", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("codex", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    expect(mgr.requestRemoteResume(remote.id, "019c56ac-417b-7180-bd3f-2ed6e25885e3")).toBe(true);
    expect(mgr.drainRemoteControl(remote.id)).toEqual({
      type: "resume",
      sessionRef: "019c56ac-417b-7180-bd3f-2ed6e25885e3",
    });
  });
});

describe("removeRemote", () => {
  it("removes session and cleans up attachments and subscriptions", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    mgr.subscribeGroup(remote.id, "telegram:-200" as ChannelChatId);
    mgr.removeRemote(remote.id);
    expect(mgr.getRemote(remote.id)).toBeUndefined();
    expect(mgr.getAttachedRemote("telegram:100" as ChannelChatId)).toBeUndefined();
    expect(mgr.getSubscribedGroups(remote.id)).toEqual([]);
    expect(mgr.remoteCount()).toBe(0);
  });

  it("removes pending file/resume pickers and pending mentions for the session", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    mgr.registerFilePicker({
      pollId: "picker-1",
      messageId: "1",
      chatId: "telegram:100" as ChannelChatId,
      ownerUserId: "telegram:100" as ChannelUserId,
      sessionId: remote.id,
      files: ["README.md"],
      query: "",
      page: 0,
      pageSize: 7,
      totalPages: 1,
      selectedMentions: [],
      options: [{ kind: "toggle", mention: "@README.md" }],
    });
    mgr.registerResumePicker({
      pollId: "resume-1",
      messageId: "2",
      chatId: "telegram:100" as ChannelChatId,
      ownerUserId: "telegram:100" as ChannelUserId,
      sessionId: remote.id,
      tool: "claude",
      sessions: [{ sessionRef: "sess-1", label: "sess-1", mtimeMs: Date.now() }],
      offset: 0,
      options: [{ kind: "session", sessionRef: "sess-1", label: "sess-1" }],
    });
    mgr.setPendingFileMentions(
      remote.id,
      "telegram:100" as ChannelChatId,
      "telegram:100" as ChannelUserId,
      ["@README.md"]
    );

    mgr.removeRemote(remote.id);
    expect(mgr.getFilePickerByPollId("picker-1")).toBeUndefined();
    expect(mgr.getResumePickerByPollId("resume-1")).toBeUndefined();
    expect(
      mgr.consumePendingFileMentions(
        remote.id,
        "telegram:100" as ChannelChatId,
        "telegram:100" as ChannelUserId
      )
    ).toEqual([]);
  });
});

describe("file picker selection state", () => {
  it("stores and removes pending file picker", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    mgr.registerFilePicker({
      pollId: "tok-1",
      messageId: "1",
      chatId: "telegram:100" as ChannelChatId,
      ownerUserId: "telegram:100" as ChannelUserId,
      sessionId: remote.id,
      files: ["README.md", "src/app.ts"],
      query: "",
      page: 0,
      pageSize: 7,
      totalPages: 1,
      selectedMentions: ["@README.md"],
      options: [{ kind: "toggle", mention: "@README.md" }],
    });

    const first = mgr.getFilePickerByPollId("tok-1");
    expect(first?.files).toEqual(["README.md", "src/app.ts"]);
    mgr.removeFilePicker("tok-1");
    expect(mgr.getFilePickerByPollId("tok-1")).toBeUndefined();
  });

  it("stores and consumes pending file mentions once", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);

    mgr.setPendingFileMentions(
      remote.id,
      "telegram:100" as ChannelChatId,
      "telegram:100" as ChannelUserId,
      ["@src/app.ts", "@README.md"]
    );

    expect(
      mgr.consumePendingFileMentions(
        remote.id,
        "telegram:100" as ChannelChatId,
        "telegram:100" as ChannelUserId
      )
    ).toEqual(["@src/app.ts", "@README.md"]);

    expect(
      mgr.consumePendingFileMentions(
        remote.id,
        "telegram:100" as ChannelChatId,
        "telegram:100" as ChannelUserId
      )
    ).toEqual([]);
  });
});

describe("output mode picker state", () => {
  it("stores and removes pending output mode picker", () => {
    const mgr = createManager();
    mgr.registerOutputModePicker({
      pollId: "output-1",
      messageId: "1",
      chatId: "telegram:100" as ChannelChatId,
      ownerUserId: "telegram:100" as ChannelUserId,
      options: ["compact", "verbose"],
    });

    const picker = mgr.getOutputModePickerByPollId("output-1");
    expect(picker?.options).toEqual(["compact", "verbose"]);
    mgr.removeOutputModePicker("output-1");
    expect(mgr.getOutputModePickerByPollId("output-1")).toBeUndefined();
  });
});

describe("getBoundChat", () => {
  it("returns the chatId attached to a session", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    expect(mgr.getBoundChat(remote.id)).toBe("telegram:100");
  });

  it("returns null when no chat is attached", () => {
    const mgr = createManager();
    expect(mgr.getBoundChat("r-unknown")).toBeNull();
  });

  it("reflects re-binding to a different chat", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    // Detach DM, attach group
    mgr.detach("telegram:100" as ChannelChatId);
    mgr.attach("telegram:-200" as ChannelChatId, remote.id);
    expect(mgr.getBoundChat(remote.id)).toBe("telegram:-200");
  });

  it("prefers a non-owner bound chat over owner DM when both are attached", () => {
    const mgr = createManager();
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    // Keep owner DM attached and also attach a topic/group chat.
    mgr.attach("telegram:-200:7" as ChannelChatId, remote.id);
    expect(mgr.getBoundChat(remote.id)).toBe("telegram:-200:7");
  });
});
