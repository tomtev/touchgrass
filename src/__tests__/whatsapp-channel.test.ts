import { describe, expect, it } from "bun:test";
import { WhatsAppChannel } from "../channels/whatsapp/channel";
import type { InboundMessage } from "../channel/types";

describe("WhatsAppChannel", () => {
  it("sends messages via socket.sendMessage using normalized jid targets", async () => {
    const channel = new WhatsAppChannel("/tmp/tg-test-whatsapp");
    const calls: Array<{ jid: string; content: Record<string, unknown> }> = [];

    const anyChannel = channel as unknown as {
      connected: boolean;
      socket: { sendMessage: (jid: string, content: Record<string, unknown>) => Promise<void> };
    };
    anyChannel.connected = true;
    anyChannel.socket = {
      sendMessage: async (jid, content) => {
        calls.push({ jid, content });
      },
    };

    await channel.send("whatsapp:+15551234567", "hello");

    expect(calls).toEqual([
      {
        jid: "15551234567@s.whatsapp.net",
        content: { text: "hello" },
      },
    ]);
  });

  it("validates group chats using groupMetadata", async () => {
    const channel = new WhatsAppChannel("/tmp/tg-test-whatsapp");
    const calls: string[] = [];

    const anyChannel = channel as unknown as {
      connected: boolean;
      socket: { groupMetadata: (jid: string) => Promise<{ subject: string }> };
    };
    anyChannel.connected = true;
    anyChannel.socket = {
      groupMetadata: async (jid) => {
        calls.push(jid);
        return { subject: "Ops Team" };
      },
    };

    await expect(channel.validateChat("whatsapp:120363401234567890@g.us")).resolves.toBe(true);
    expect(calls).toEqual(["120363401234567890@g.us"]);
  });

  it("validates direct chats using onWhatsApp lookup", async () => {
    const channel = new WhatsAppChannel("/tmp/tg-test-whatsapp");
    const calls: string[] = [];

    const anyChannel = channel as unknown as {
      connected: boolean;
      socket: { onWhatsApp: (jid: string) => Promise<Array<{ exists?: boolean }>> };
    };
    anyChannel.connected = true;
    anyChannel.socket = {
      onWhatsApp: async (jid) => {
        calls.push(jid);
        return [{ exists: true }];
      },
    };

    await expect(channel.validateChat("whatsapp:+4799999999")).resolves.toBe(true);
    expect(calls).toEqual(["4799999999@s.whatsapp.net"]);
  });

  it("maps inbound group messages into channel-agnostic InboundMessage objects", async () => {
    const received: InboundMessage[] = [];
    const channel = new WhatsAppChannel("/tmp/tg-test-whatsapp");

    const anyChannel = channel as unknown as {
      connected: boolean;
      socket: { groupMetadata: (jid: string) => Promise<{ subject: string }> };
      handleMessagesUpsert: (upsert: unknown, onMessage: (msg: InboundMessage) => Promise<void>) => Promise<void>;
    };
    anyChannel.connected = true;
    anyChannel.socket = {
      groupMetadata: async () => ({ subject: "Build Team" }),
    };

    await anyChannel.handleMessagesUpsert(
      {
        type: "notify",
        messages: [
          {
            key: {
              remoteJid: "120363401234567890@g.us",
              participant: "15551234567@s.whatsapp.net",
              fromMe: false,
            },
            pushName: "Tommy",
            message: {
              conversation: "deploy status?",
            },
          },
        ],
      },
      async (msg) => {
        received.push(msg);
      }
    );

    expect(received).toEqual([
      {
        userId: "whatsapp:+15551234567",
        chatId: "whatsapp:120363401234567890@g.us",
        username: "Tommy",
        text: "deploy status?",
        isGroup: true,
        chatTitle: "Build Team",
      },
    ]);
  });

  it("ignores outbound/self messages in inbound upserts", async () => {
    const received: InboundMessage[] = [];
    const channel = new WhatsAppChannel("/tmp/tg-test-whatsapp");

    const anyChannel = channel as unknown as {
      handleMessagesUpsert: (upsert: unknown, onMessage: (msg: InboundMessage) => Promise<void>) => Promise<void>;
    };

    await anyChannel.handleMessagesUpsert(
      {
        type: "notify",
        messages: [
          {
            key: {
              remoteJid: "15551234567@s.whatsapp.net",
              fromMe: true,
            },
            pushName: "Me",
            message: {
              conversation: "should be ignored",
            },
          },
        ],
      },
      async (msg) => {
        received.push(msg);
      }
    );

    expect(received).toHaveLength(0);
  });
});
