import { describe, it, expect, mock } from "bun:test";
import { SessionManager } from "../session/manager";
import {
  getAllLinkedGroups,
  isLinkedGroup,
  removeLinkedGroup,
  addLinkedGroup,
  defaultSettings,
  type TgConfig,
  type ChannelConfig,
} from "../config/schema";
import type { ChannelChatId, ChannelUserId } from "../channel/types";

function makeChannel(groups: ChannelConfig["linkedGroups"] = []): ChannelConfig {
  return {
    type: "telegram",
    credentials: { botToken: "test-token" },
    pairedUsers: [{ userId: "telegram:100", pairedAt: "2024-01-01" }],
    linkedGroups: groups,
  };
}

function makeConfig(groups: ChannelConfig["linkedGroups"] = []): TgConfig {
  return {
    channels: { telegram: makeChannel(groups) },
    settings: { ...defaultSettings },
  };
}

/**
 * Simulates the daemon's registerRemote handler logic (from daemon/index.ts lines 377-408).
 * Uses a mock validateChat function instead of a real TelegramChannel.
 */
async function simulateRegisterRemote(
  sessionManager: SessionManager,
  config: TgConfig,
  validateChat: (chatId: string) => Promise<boolean>,
  command: string,
  chatId: ChannelChatId,
  ownerUserId: ChannelUserId,
  cwd: string,
): Promise<{
  sessionId: string;
  dmBusy: boolean;
  linkedGroups: Array<{ chatId: string; title?: string }>;
  allLinkedGroups: Array<{ chatId: string; title?: string }>;
  configModified: boolean;
}> {
  const remote = sessionManager.registerRemote(command, chatId, ownerUserId, cwd);
  const existingBound = sessionManager.getAttachedRemote(chatId);
  const dmBusy = !!existingBound && existingBound.id !== remote.id;

  const rawGroups = getAllLinkedGroups(config);
  let configModified = false;

  const validGroups: Array<{ chatId: string; title?: string }> = [];
  for (const g of rawGroups) {
    const alive = await validateChat(g.chatId);
    if (alive) {
      validGroups.push({ chatId: g.chatId, title: g.title });
    } else {
      removeLinkedGroup(config, g.chatId);
      configModified = true;
    }
  }

  const allLinkedGroups = validGroups;
  const linkedGroups = allLinkedGroups.filter((g) => {
    const bound = sessionManager.getAttachedRemote(g.chatId as ChannelChatId);
    return !bound || bound.id === remote.id;
  });

  return { sessionId: remote.id, dmBusy, linkedGroups, allLinkedGroups, configModified };
}

/**
 * Simulates the daemon's bindChat handler logic (from daemon/index.ts lines 409-440).
 */
async function simulateBindChat(
  sessionManager: SessionManager,
  config: TgConfig,
  validateChat: (chatId: string) => Promise<boolean>,
  sessionId: string,
  chatId: ChannelChatId,
): Promise<{ ok: boolean; error?: string; configModified: boolean }> {
  const remote = sessionManager.getRemote(sessionId);
  if (!remote) return { ok: false, error: "Session not found", configModified: false };

  const isOwnerDm = remote.chatId === chatId;
  const isLinkedTarget = isLinkedGroup(config, chatId);
  if (!isOwnerDm && !isLinkedTarget) return { ok: false, error: "Group is not linked", configModified: false };

  let configModified = false;
  if (!isOwnerDm) {
    const alive = await validateChat(chatId);
    if (!alive) {
      removeLinkedGroup(config, chatId);
      configModified = true;
      return { ok: false, error: "Group no longer exists or bot was removed from it", configModified };
    }
  }

  const oldRemote = sessionManager.getAttachedRemote(chatId);
  if (oldRemote && oldRemote.id !== sessionId) {
    return { ok: false, error: `Channel is busy with ${oldRemote.command}`, configModified };
  }

  if (remote.chatId !== chatId) {
    sessionManager.detach(remote.chatId);
  }
  sessionManager.attach(chatId, sessionId);
  if (isLinkedTarget) {
    sessionManager.subscribeGroup(sessionId, chatId);
  }
  return { ok: true, configModified };
}

describe("registerRemote handler — group validation", () => {
  it("keeps alive groups and removes dead ones from config", async () => {
    const config = makeConfig([
      { chatId: "telegram:-100", title: "Alive Group", linkedAt: "2024-01-01" },
      { chatId: "telegram:-200", title: "Dead Group", linkedAt: "2024-01-02" },
      { chatId: "telegram:-300", title: "Also Alive", linkedAt: "2024-01-03" },
    ]);
    const mgr = new SessionManager({ ...defaultSettings });
    const validateChat = mock(async (chatId: string) => chatId !== "telegram:-200");

    const result = await simulateRegisterRemote(
      mgr, config, validateChat,
      "claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId, "/project",
    );

    expect(result.allLinkedGroups).toHaveLength(2);
    expect(result.allLinkedGroups.map((g) => g.chatId)).toEqual(["telegram:-100", "telegram:-300"]);
    expect(result.configModified).toBe(true);
    // Dead group removed from config
    expect(isLinkedGroup(config, "telegram:-200")).toBe(false);
    // Alive groups still in config
    expect(isLinkedGroup(config, "telegram:-100")).toBe(true);
    expect(isLinkedGroup(config, "telegram:-300")).toBe(true);
    expect(validateChat).toHaveBeenCalledTimes(3);
  });

  it("returns all groups as available when none are bound", async () => {
    const config = makeConfig([
      { chatId: "telegram:-100", title: "Group A", linkedAt: "2024-01-01" },
      { chatId: "telegram:-200", title: "Group B", linkedAt: "2024-01-02" },
    ]);
    const mgr = new SessionManager({ ...defaultSettings });
    const validateChat = mock(async () => true);

    const result = await simulateRegisterRemote(
      mgr, config, validateChat,
      "claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId, "/project",
    );

    expect(result.linkedGroups).toHaveLength(2);
    expect(result.allLinkedGroups).toHaveLength(2);
  });

  it("filters out groups bound to other sessions", async () => {
    const config = makeConfig([
      { chatId: "telegram:-100", title: "Group A", linkedAt: "2024-01-01" },
    ]);
    const mgr = new SessionManager({ ...defaultSettings });
    const validateChat = mock(async () => true);

    // First session binds to the group
    const first = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    mgr.attach("telegram:-100" as ChannelChatId, first.id);

    // Second session registers — group should be filtered from linkedGroups but still in allLinkedGroups
    const result = await simulateRegisterRemote(
      mgr, config, validateChat,
      "codex", "telegram:200" as ChannelChatId, "telegram:200" as ChannelUserId, "/other",
    );

    expect(result.allLinkedGroups).toHaveLength(1);
    expect(result.linkedGroups).toHaveLength(0);
  });

  it("handles no linked groups gracefully", async () => {
    const config = makeConfig([]);
    const mgr = new SessionManager({ ...defaultSettings });
    const validateChat = mock(async () => true);

    const result = await simulateRegisterRemote(
      mgr, config, validateChat,
      "claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId, "/project",
    );

    expect(result.linkedGroups).toEqual([]);
    expect(result.allLinkedGroups).toEqual([]);
    expect(validateChat).not.toHaveBeenCalled();
  });
});

describe("bindChat handler — group validation", () => {
  it("returns error for dead group and removes it from config", async () => {
    const config = makeConfig([
      { chatId: "telegram:-100", title: "Dead Group", linkedAt: "2024-01-01" },
    ]);
    const mgr = new SessionManager({ ...defaultSettings });
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    const validateChat = mock(async () => false);

    const result = await simulateBindChat(
      mgr, config, validateChat,
      remote.id, "telegram:-100" as ChannelChatId,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no longer exists");
    expect(result.configModified).toBe(true);
    expect(isLinkedGroup(config, "telegram:-100")).toBe(false);
  });

  it("succeeds for alive group and subscribes it", async () => {
    const config = makeConfig([
      { chatId: "telegram:-100", title: "Live Group", linkedAt: "2024-01-01" },
    ]);
    const mgr = new SessionManager({ ...defaultSettings });
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    const validateChat = mock(async () => true);

    const result = await simulateBindChat(
      mgr, config, validateChat,
      remote.id, "telegram:-100" as ChannelChatId,
    );

    expect(result.ok).toBe(true);
    expect(mgr.getSubscribedGroups(remote.id)).toContain("telegram:-100");
    // DM attachment should be removed (binding to different chat)
    expect(mgr.getAttachedRemote("telegram:100" as ChannelChatId)).toBeUndefined();
  });

  it("skips validation for DM (owner's chat)", async () => {
    const config = makeConfig([]);
    const mgr = new SessionManager({ ...defaultSettings });
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    // Detach so we can re-bind
    mgr.detach("telegram:100" as ChannelChatId);
    const validateChat = mock(async () => true);

    const result = await simulateBindChat(
      mgr, config, validateChat,
      remote.id, "telegram:100" as ChannelChatId,
    );

    expect(result.ok).toBe(true);
    // validateChat should NOT have been called for DM
    expect(validateChat).not.toHaveBeenCalled();
  });

  it("returns error for unlinked group", async () => {
    const config = makeConfig([]);
    const mgr = new SessionManager({ ...defaultSettings });
    const remote = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    const validateChat = mock(async () => true);

    const result = await simulateBindChat(
      mgr, config, validateChat,
      remote.id, "telegram:-999" as ChannelChatId,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Group is not linked");
  });

  it("returns error for nonexistent session", async () => {
    const config = makeConfig([]);
    const mgr = new SessionManager({ ...defaultSettings });
    const validateChat = mock(async () => true);

    const result = await simulateBindChat(
      mgr, config, validateChat,
      "r-nonexist", "telegram:-100" as ChannelChatId,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Session not found");
  });

  it("returns error when target channel is already bound by another session", async () => {
    const config = makeConfig([
      { chatId: "telegram:-100", title: "Live Group", linkedAt: "2024-01-01" },
    ]);
    const mgr = new SessionManager({ ...defaultSettings });
    const first = mgr.registerRemote("claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId);
    const second = mgr.registerRemote("codex", "telegram:200" as ChannelChatId, "telegram:200" as ChannelUserId);
    mgr.attach("telegram:-100" as ChannelChatId, first.id);
    const validateChat = mock(async () => true);

    const result = await simulateBindChat(
      mgr, config, validateChat,
      second.id, "telegram:-100" as ChannelChatId,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Channel is busy");
    expect(mgr.getBoundChat(first.id)).toBe("telegram:-100");
  });
});

describe("config refresh simulation", () => {
  it("picks up externally added groups", async () => {
    const config = makeConfig([]);
    const mgr = new SessionManager({ ...defaultSettings });

    // Simulate external config change (like `tg link` in another terminal)
    addLinkedGroup(config, "telegram:-500", "New Group");

    const validateChat = mock(async () => true);
    const result = await simulateRegisterRemote(
      mgr, config, validateChat,
      "claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId, "/project",
    );

    expect(result.allLinkedGroups).toHaveLength(1);
    expect(result.allLinkedGroups[0].chatId).toBe("telegram:-500");
  });

  it("handles all groups being dead", async () => {
    const config = makeConfig([
      { chatId: "telegram:-100", title: "Dead 1", linkedAt: "2024-01-01" },
      { chatId: "telegram:-200", title: "Dead 2", linkedAt: "2024-01-02" },
    ]);
    const mgr = new SessionManager({ ...defaultSettings });
    const validateChat = mock(async () => false);

    const result = await simulateRegisterRemote(
      mgr, config, validateChat,
      "claude", "telegram:100" as ChannelChatId, "telegram:100" as ChannelUserId, "/project",
    );

    expect(result.allLinkedGroups).toEqual([]);
    expect(result.linkedGroups).toEqual([]);
    expect(result.configModified).toBe(true);
    expect(getAllLinkedGroups(config)).toEqual([]);
  });
});
