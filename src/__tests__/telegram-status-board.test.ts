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
});
