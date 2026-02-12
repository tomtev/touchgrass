import { describe, it, expect } from "bun:test";
import {
  getAllLinkedGroups,
  addLinkedGroup,
  removeLinkedGroup,
  isLinkedGroup,
  updateLinkedGroupTitle,
  type TgConfig,
  type ChannelConfig,
  defaultSettings,
} from "../config/schema";

function makeChannel(type: string, groups: ChannelConfig["linkedGroups"] = []): ChannelConfig {
  return {
    type,
    credentials: { botToken: "test-token" },
    pairedUsers: [],
    linkedGroups: groups,
  };
}

function makeConfig(channels: Record<string, ChannelConfig> = {}): TgConfig {
  return { channels, settings: { ...defaultSettings } };
}

describe("getAllLinkedGroups", () => {
  it("returns empty array when no channels", () => {
    const config = makeConfig();
    expect(getAllLinkedGroups(config)).toEqual([]);
  });

  it("returns empty array when channels have no groups", () => {
    const config = makeConfig({ telegram: makeChannel("telegram") });
    expect(getAllLinkedGroups(config)).toEqual([]);
  });

  it("flattens groups across multiple channels", () => {
    const config = makeConfig({
      telegram: makeChannel("telegram", [
        { chatId: "telegram:-100", title: "Group A", linkedAt: "2024-01-01" },
      ]),
      discord: makeChannel("discord", [
        { chatId: "discord:200", title: "Server B", linkedAt: "2024-01-02" },
      ]),
    });
    const groups = getAllLinkedGroups(config);
    expect(groups).toHaveLength(2);
    expect(groups[0].chatId).toBe("telegram:-100");
    expect(groups[1].chatId).toBe("discord:200");
  });

  it("handles channels with undefined linkedGroups", () => {
    const config = makeConfig({
      telegram: { type: "telegram", credentials: {}, pairedUsers: [] } as unknown as ChannelConfig,
    });
    // linkedGroups is undefined — should not throw
    expect(getAllLinkedGroups(config)).toEqual([]);
  });
});

describe("addLinkedGroup", () => {
  it("adds a group to the matching channel", () => {
    const config = makeConfig({ telegram: makeChannel("telegram") });
    const result = addLinkedGroup(config, "telegram:-100", "My Group");
    expect(result).toBe(true);
    expect(config.channels.telegram.linkedGroups).toHaveLength(1);
    expect(config.channels.telegram.linkedGroups[0].chatId).toBe("telegram:-100");
    expect(config.channels.telegram.linkedGroups[0].title).toBe("My Group");
  });

  it("rejects duplicate chatId", () => {
    const config = makeConfig({
      telegram: makeChannel("telegram", [
        { chatId: "telegram:-100", title: "Existing", linkedAt: "2024-01-01" },
      ]),
    });
    const result = addLinkedGroup(config, "telegram:-100", "Duplicate");
    expect(result).toBe(false);
    expect(config.channels.telegram.linkedGroups).toHaveLength(1);
  });

  it("returns false when no matching channel exists", () => {
    const config = makeConfig({ telegram: makeChannel("telegram") });
    const result = addLinkedGroup(config, "discord:200", "Discord Group");
    expect(result).toBe(false);
  });

  it("handles topics (chatIds with thread suffix)", () => {
    const config = makeConfig({ telegram: makeChannel("telegram") });
    const result = addLinkedGroup(config, "telegram:-100:42", "Topic Thread");
    expect(result).toBe(true);
    expect(config.channels.telegram.linkedGroups[0].chatId).toBe("telegram:-100:42");
  });

  it("initializes linkedGroups array if missing", () => {
    const config = makeConfig({
      telegram: { type: "telegram", credentials: {}, pairedUsers: [] } as unknown as ChannelConfig,
    });
    const result = addLinkedGroup(config, "telegram:-100", "New Group");
    expect(result).toBe(true);
    expect(config.channels.telegram.linkedGroups).toHaveLength(1);
  });
});

describe("removeLinkedGroup", () => {
  it("removes an existing group", () => {
    const config = makeConfig({
      telegram: makeChannel("telegram", [
        { chatId: "telegram:-100", title: "Group A", linkedAt: "2024-01-01" },
        { chatId: "telegram:-200", title: "Group B", linkedAt: "2024-01-02" },
      ]),
    });
    const result = removeLinkedGroup(config, "telegram:-100");
    expect(result).toBe(true);
    expect(config.channels.telegram.linkedGroups).toHaveLength(1);
    expect(config.channels.telegram.linkedGroups[0].chatId).toBe("telegram:-200");
  });

  it("returns false when group not found", () => {
    const config = makeConfig({ telegram: makeChannel("telegram") });
    const result = removeLinkedGroup(config, "telegram:-999");
    expect(result).toBe(false);
  });

  it("returns false when channel has no linkedGroups", () => {
    const config = makeConfig({
      telegram: { type: "telegram", credentials: {}, pairedUsers: [] } as unknown as ChannelConfig,
    });
    const result = removeLinkedGroup(config, "telegram:-100");
    expect(result).toBe(false);
  });
});

describe("isLinkedGroup", () => {
  it("returns true for a linked group", () => {
    const config = makeConfig({
      telegram: makeChannel("telegram", [
        { chatId: "telegram:-100", title: "Group A", linkedAt: "2024-01-01" },
      ]),
    });
    expect(isLinkedGroup(config, "telegram:-100")).toBe(true);
  });

  it("returns false for an unlinked chatId", () => {
    const config = makeConfig({ telegram: makeChannel("telegram") });
    expect(isLinkedGroup(config, "telegram:-100")).toBe(false);
  });

  it("returns false when no channels exist", () => {
    const config = makeConfig();
    expect(isLinkedGroup(config, "telegram:-100")).toBe(false);
  });
});

describe("updateLinkedGroupTitle", () => {
  it("updates title when it changed", () => {
    const config = makeConfig({
      telegram: makeChannel("telegram", [
        { chatId: "telegram:-100", title: "Old Title", linkedAt: "2024-01-01" },
      ]),
    });
    const result = updateLinkedGroupTitle(config, "telegram:-100", "New Title");
    expect(result).toBe(true);
    expect(config.channels.telegram.linkedGroups[0].title).toBe("New Title");
  });

  it("returns false when title is the same", () => {
    const config = makeConfig({
      telegram: makeChannel("telegram", [
        { chatId: "telegram:-100", title: "Same Title", linkedAt: "2024-01-01" },
      ]),
    });
    const result = updateLinkedGroupTitle(config, "telegram:-100", "Same Title");
    expect(result).toBe(false);
  });

  it("returns false when group not found", () => {
    const config = makeConfig({ telegram: makeChannel("telegram") });
    const result = updateLinkedGroupTitle(config, "telegram:-999", "New Title");
    expect(result).toBe(false);
  });

  it("sets title when previously undefined", () => {
    const config = makeConfig({
      telegram: makeChannel("telegram", [
        { chatId: "telegram:-100", linkedAt: "2024-01-01" },
      ]),
    });
    const result = updateLinkedGroupTitle(config, "telegram:-100", "First Title");
    expect(result).toBe(true);
    expect(config.channels.telegram.linkedGroups[0].title).toBe("First Title");
  });
});
