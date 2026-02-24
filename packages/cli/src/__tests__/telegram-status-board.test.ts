import { describe, expect, it } from "bun:test";
import { TelegramChannel } from "../channels/telegram/channel";

describe("TelegramChannel status board", () => {
  it("pins a status board and unpins it when cleared", async () => {
    const calls: string[] = [];
    const channel = new TelegramChannel("bot-token");
    const anyChannel = channel as unknown as {
      api: {
        sendMessage: (chatId: number, text: string, parseMode: "HTML" | "MarkdownV2" | "", threadId?: number) => Promise<{ message_id: number }>;
        editMessageText: (chatId: number, messageId: number, text: string, parseMode: "HTML" | "MarkdownV2" | "", threadId?: number) => Promise<true>;
        pinChatMessage: (chatId: number, messageId: number, disableNotification?: boolean) => Promise<boolean>;
        unpinChatMessage: (chatId: number, messageId: number) => Promise<boolean>;
      };
    };

    anyChannel.api = {
      sendMessage: async () => {
        calls.push("sendMessage");
        return { message_id: 777 };
      },
      editMessageText: async () => {
        calls.push("editMessageText");
        return true;
      },
      pinChatMessage: async () => {
        calls.push("pinChatMessage");
        return true;
      },
      unpinChatMessage: async () => {
        calls.push("unpinChatMessage");
        return true;
      },
    };

    await channel.upsertStatusBoard?.("telegram:123", "background:r-1", "<b>running</b>", { pin: true });
    await channel.upsertStatusBoard?.("telegram:123", "background:r-1", "<b>still running</b>", { pin: true });
    await channel.clearStatusBoard?.("telegram:123", "background:r-1", { unpin: true });

    expect(calls).toEqual(["sendMessage", "pinChatMessage", "editMessageText", "unpinChatMessage"]);
  });

  it("can clear an externally tracked pinned board using explicit message id", async () => {
    const calls: string[] = [];
    const channel = new TelegramChannel("bot-token");
    const anyChannel = channel as unknown as {
      api: {
        unpinChatMessage: (chatId: number, messageId: number) => Promise<boolean>;
      };
    };

    anyChannel.api = {
      unpinChatMessage: async () => {
        calls.push("unpinChatMessage");
        return true;
      },
    };

    await channel.clearStatusBoard?.("telegram:123", "background:r-2", {
      unpin: true,
      messageId: "999",
      pinned: true,
    });

    expect(calls).toEqual(["unpinChatMessage"]);
  });

  it("returns pinError when pinning fails so daemon can surface permission issues", async () => {
    const channel = new TelegramChannel("bot-token");
    const anyChannel = channel as unknown as {
      api: {
        sendMessage: (chatId: number, text: string, parseMode: "HTML" | "MarkdownV2" | "", threadId?: number) => Promise<{ message_id: number }>;
        pinChatMessage: (chatId: number, messageId: number, disableNotification?: boolean) => Promise<boolean>;
      };
    };

    anyChannel.api = {
      sendMessage: async () => ({ message_id: 1234 }),
      pinChatMessage: async () => {
        throw new Error("Telegram API pinChatMessage: not enough rights");
      },
    };

    const result = await channel.upsertStatusBoard?.(
      "telegram:-1001:4",
      "background:r-1",
      "<b>Background jobs</b>",
      { pin: true }
    );

    expect(result?.messageId).toBe("1234");
    expect(result?.pinned).toBe(false);
    expect(result?.pinError).toContain("not enough rights");
  });

  it("does not send a duplicate board when Telegram reports message is not modified", async () => {
    const calls: string[] = [];
    const channel = new TelegramChannel("bot-token");
    const anyChannel = channel as unknown as {
      api: {
        sendMessage: (chatId: number, text: string, parseMode: "HTML" | "MarkdownV2" | "", threadId?: number) => Promise<{ message_id: number }>;
        editMessageText: (chatId: number, messageId: number, text: string, parseMode: "HTML" | "MarkdownV2" | "", threadId?: number) => Promise<true>;
      };
    };

    anyChannel.api = {
      sendMessage: async () => {
        calls.push("sendMessage");
        return { message_id: 555 };
      },
      editMessageText: async () => {
        calls.push("editMessageText");
        throw new Error("Telegram API editMessageText failed (400): {\"ok\":false,\"description\":\"Bad Request: message is not modified\"}");
      },
    };

    await channel.upsertStatusBoard?.("telegram:123", "background:r-loop", "<b>same</b>", {
      pin: false,
      messageId: "555",
      pinned: false,
    });

    expect(calls).toEqual(["editMessageText"]);
  });
});
