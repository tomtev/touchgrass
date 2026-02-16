import { describe, expect, it } from "bun:test";
import { TelegramChannel, __telegramChannelTestUtils } from "../channels/telegram/channel";

describe("TelegramChannel actions", () => {
  it("uses inline keyboard for single-select actions and clears keyboard on close", async () => {
    const calls: string[] = [];
    const channel = new TelegramChannel("bot-token");
    const anyChannel = channel as unknown as {
      api: {
        sendInlineKeyboard: (
          chatId: number,
          text: string,
          buttons: Array<Array<{ text: string; callback_data: string }>>,
          threadId?: number
        ) => Promise<{ message_id: number }>;
        sendPoll: (...args: unknown[]) => Promise<unknown>;
        editMessageReplyMarkup: (chatId: number, messageId: number, markup: Record<string, unknown>) => Promise<void>;
        stopPoll: (chatId: number, messageId: number) => Promise<void>;
      };
    };

    anyChannel.api = {
      sendInlineKeyboard: async (_chatId, _text, buttons) => {
        calls.push("sendInlineKeyboard");
        expect(buttons).toHaveLength(2);
        expect(buttons[0]?.[0]?.callback_data).toMatch(/^tgp:/);
        return { message_id: 123 };
      },
      sendPoll: async () => {
        calls.push("sendPoll");
        return { message_id: 999, poll: { id: "tg-real-poll" } };
      },
      editMessageReplyMarkup: async () => {
        calls.push("editMessageReplyMarkup");
      },
      stopPoll: async () => {
        calls.push("stopPoll");
      },
    };

    const sent = await channel.sendPoll("telegram:100", "Proceed?", ["Yes", "No"], false);
    expect(sent.messageId).toBe("123");
    expect(sent.pollId).toMatch(/^tgp-/);
    expect(calls).toEqual(["sendInlineKeyboard"]);

    await channel.closePoll("telegram:100", "123");
    expect(calls).toEqual(["sendInlineKeyboard", "editMessageReplyMarkup"]);
  });

  it("uses native Telegram polls for multi-select actions", async () => {
    const calls: string[] = [];
    const channel = new TelegramChannel("bot-token");
    const anyChannel = channel as unknown as {
      api: {
        sendInlineKeyboard: (...args: unknown[]) => Promise<unknown>;
        sendPoll: (chatId: number, question: string, options: string[], multiSelect: boolean) => Promise<{
          message_id: number;
          poll: { id: string };
        }>;
      };
    };

    anyChannel.api = {
      sendInlineKeyboard: async () => {
        calls.push("sendInlineKeyboard");
        return { message_id: 1 };
      },
      sendPoll: async () => {
        calls.push("sendPoll");
        return { message_id: 456, poll: { id: "tg-native-poll" } };
      },
    };

    const sent = await channel.sendPoll("telegram:100", "Pick many", ["A", "B"], true);
    expect(sent).toEqual({ pollId: "tg-native-poll", messageId: "456" });
    expect(calls).toEqual(["sendPoll"]);
  });
});

describe("Telegram command menus", () => {
  it("builds context-aware command lists without help/sessions", () => {
    const names = (cmds: Array<{ command: string }>) => cmds.map((c) => c.command);

    expect(names(__telegramChannelTestUtils.buildCommandMenu({
      isPaired: false,
      isGroup: false,
      isLinkedGroup: false,
    }))).toEqual(["pair"]);

    expect(names(__telegramChannelTestUtils.buildCommandMenu({
      isPaired: true,
      isGroup: false,
      isLinkedGroup: false,
    }))).toEqual(["files", "resume", "background_jobs"]);

    expect(names(__telegramChannelTestUtils.buildCommandMenu({
      isPaired: true,
      isGroup: true,
      isLinkedGroup: false,
    }))).toEqual(["files", "resume", "background_jobs", "link"]);

    expect(names(__telegramChannelTestUtils.buildCommandMenu({
      isPaired: true,
      isGroup: true,
      isLinkedGroup: true,
    }))).toEqual(["files", "resume", "background_jobs", "unlink"]);
  });

  it("syncs chat-member command menu and skips duplicate updates", async () => {
    const channel = new TelegramChannel("bot-token");
    const calls: Array<{ commands: string[]; scope: { type: string; chat_id: number; user_id: number } }> = [];
    const anyChannel = channel as unknown as {
      api: {
        setMyCommands: (
          commands: Array<{ command: string; description: string }>,
          scope?: { type: string; chat_id: number; user_id: number }
        ) => Promise<true>;
      };
    };

    anyChannel.api = {
      setMyCommands: async (commands, scope) => {
        calls.push({
          commands: commands.map((c) => c.command),
          scope: scope as { type: string; chat_id: number; user_id: number },
        });
        return true;
      },
    };

    await channel.syncCommandMenu?.({
      userId: "telegram:7",
      chatId: "telegram:-100:4",
      isPaired: true,
      isGroup: true,
      isLinkedGroup: false,
    });
    await channel.syncCommandMenu?.({
      userId: "telegram:7",
      chatId: "telegram:-100:4",
      isPaired: true,
      isGroup: true,
      isLinkedGroup: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.commands).toEqual(["files", "resume", "background_jobs", "link"]);
    expect(calls[0]?.scope).toEqual({
      type: "chat_member",
      chat_id: -100,
      user_id: 7,
    });

    await channel.syncCommandMenu?.({
      userId: "telegram:7",
      chatId: "telegram:-100:4",
      isPaired: true,
      isGroup: true,
      isLinkedGroup: true,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.commands).toEqual(["files", "resume", "background_jobs", "unlink"]);
  });
});
