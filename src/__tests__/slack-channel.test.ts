import { describe, expect, it } from "bun:test";
import { SlackChannel } from "../channels/slack/channel";
import type { InboundMessage } from "../channel/types";

interface MockSlackApi {
  openDm?: (userId: string) => Promise<string>;
  sendMessage?: (channel: string, text: string, threadTs?: string) => Promise<{ channel: string; ts: string }>;
  updateMessage?: (channel: string, ts: string, text: string) => Promise<void>;
  sendFile?: (channel: string, filePath: string, caption?: string, threadTs?: string) => Promise<void>;
  getConversationInfo?: (channel: string) => Promise<{ id: string; name?: string }>;
  getUserInfo?: (userId: string) => Promise<{ id: string; name?: string }>;
}

function createChannelWithApi(mockApi: MockSlackApi): SlackChannel {
  const channel = new SlackChannel("xoxb-test", "xapp-test");
  const anyChannel = channel as unknown as Record<string, unknown>;
  anyChannel.api = mockApi;
  return channel;
}

describe("SlackChannel", () => {
  it("sends DM messages via conversations.open + chat.postMessage", async () => {
    const calls: Array<{ kind: string; args: unknown[] }> = [];
    const channel = createChannelWithApi({
      openDm: async (userId) => {
        calls.push({ kind: "openDm", args: [userId] });
        return "D123";
      },
      sendMessage: async (target, text, threadTs) => {
        calls.push({ kind: "sendMessage", args: [target, text, threadTs] });
        return { channel: target, ts: "1.1" };
      },
    });

    await channel.send("slack:U111", "hello from test");

    expect(calls[0]).toEqual({ kind: "openDm", args: ["U111"] });
    expect(calls[1]).toEqual({ kind: "sendMessage", args: ["D123", "hello from test", undefined] });
  });

  it("sends thread messages to a channel with thread_ts", async () => {
    const calls: Array<{ kind: string; args: unknown[] }> = [];
    const channel = createChannelWithApi({
      sendMessage: async (target, text, threadTs) => {
        calls.push({ kind: "sendMessage", args: [target, text, threadTs] });
        return { channel: target, ts: "1.2" };
      },
    });

    await channel.send("slack:C123:1700000000.000010", "thread hello");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: "sendMessage",
      args: ["C123", "thread hello", "1700000000.000010"],
    });
  });

  it("normalizes inbound Slack mention and group metadata", async () => {
    const received: InboundMessage[] = [];
    const channel = createChannelWithApi({
      getConversationInfo: async (id) => ({ id, name: "Dev Team" }),
    });

    const anyChannel = channel as unknown as {
      botUserId?: string;
      handleMessageEvent: (
        event: Record<string, unknown>,
        onMessage: (msg: InboundMessage) => Promise<void>
      ) => Promise<void>;
    };

    anyChannel.botUserId = "UBOT";
    await anyChannel.handleMessageEvent(
      {
        type: "message",
        channel: "C123",
        user: "U999",
        text: "<@UBOT> tg link",
        ts: "1700000000.000001",
      },
      async (msg) => {
        received.push(msg);
      }
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      userId: "slack:U999",
      chatId: "slack:C123",
      username: undefined,
      text: "tg link",
      fileUrls: undefined,
      isGroup: true,
      chatTitle: "Dev Team",
      topicTitle: undefined,
    });
  });

  it("maps poll replies to poll answer callbacks", async () => {
    const channel = createChannelWithApi({
      openDm: async () => "D222",
      sendMessage: async (target, _text, _threadTs) => ({ channel: target, ts: "1700000000.000002" }),
    });

    const pollAnswers: Array<{ pollId: string; userId: string; optionIds: number[] }> = [];
    channel.onPollAnswer = (answer) => {
      pollAnswers.push(answer);
    };

    const poll = await channel.sendPoll("slack:U777", "Pick one", ["A", "B", "C"], false);
    expect(poll.pollId).toMatch(/^slack-poll-/);

    const anyChannel = channel as unknown as {
      handleMessageEvent: (
        event: Record<string, unknown>,
        onMessage: (msg: InboundMessage) => Promise<void>
      ) => Promise<void>;
    };

    await anyChannel.handleMessageEvent(
      {
        type: "message",
        channel: "D222",
        user: "U777",
        text: "2",
        ts: "1700000000.000003",
      },
      async () => {}
    );

    expect(pollAnswers).toHaveLength(1);
    expect(pollAnswers[0]?.userId).toBe("slack:U777");
    expect(pollAnswers[0]?.optionIds).toEqual([1]);
    expect(pollAnswers[0]?.pollId).toBe(poll.pollId);
  });

  it("validates user and channel chat IDs using the right Slack API calls", async () => {
    const calls: Array<{ kind: string; id: string }> = [];
    const channel = createChannelWithApi({
      getUserInfo: async (userId) => {
        calls.push({ kind: "user", id: userId });
        return { id: userId };
      },
      getConversationInfo: async (channelId) => {
        calls.push({ kind: "channel", id: channelId });
        return { id: channelId, name: "dev" };
      },
    });

    await expect(channel.validateChat("slack:U999")).resolves.toBe(true);
    await expect(channel.validateChat("slack:C999")).resolves.toBe(true);
    expect(calls).toEqual([
      { kind: "user", id: "U999" },
      { kind: "channel", id: "C999" },
    ]);
  });

  it("returns false from validateChat when Slack API lookup fails", async () => {
    const channel = createChannelWithApi({
      getConversationInfo: async () => {
        throw new Error("channel_not_found");
      },
    });

    await expect(channel.validateChat("slack:C404")).resolves.toBe(false);
  });
});
