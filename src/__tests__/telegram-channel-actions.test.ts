import { describe, expect, it } from "bun:test";
import { TelegramChannel } from "../channels/telegram/channel";

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

