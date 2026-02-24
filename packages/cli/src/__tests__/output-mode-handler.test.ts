import { describe, expect, it } from "bun:test";
import { routeMessage } from "../bot/command-router";
import { SessionManager } from "../session/manager";
import { defaultSettings } from "../config/schema";

const fmt = {
  bold: (value: string) => value,
  italic: (value: string) => value,
  code: (value: string) => value,
  pre: (value: string) => value,
  link: (value: string) => value,
  escape: (value: string) => value,
  fromMarkdown: (value: string) => value,
};

function createCtx(sent: string[], withPoll = false) {
  const config = {
    channels: {
      telegram: {
        type: "telegram",
        credentials: {},
        pairedUsers: [{ userId: "telegram:1", pairedAt: new Date().toISOString() }],
        linkedGroups: [],
      },
    },
    settings: { ...defaultSettings },
    chatPreferences: {},
  };

  const sessionManager = new SessionManager(defaultSettings);
  const channel: any = {
    fmt,
    send: async (_chatId: string, content: string) => sent.push(content),
  };
  if (withPoll) {
    channel.sendPoll = async () => ({ pollId: "poll-output-mode", messageId: "99" });
  }

  return {
    config,
    sessionManager,
    channel,
  } as any;
}

describe("output mode command", () => {
  it("shows current output mode when called without args (text fallback)", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/output_mode" },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("simple");
    expect(sent[0]).toContain("Usage: /output_mode simple|verbose");
  });

  it("opens picker buttons when /output_mode has no args and polling is supported", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent, true);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/output_mode" },
      ctx
    );

    expect(sent).toHaveLength(0);
    const picker = ctx.sessionManager.getOutputModePickerByPollId("poll-output-mode");
    expect(picker).toBeDefined();
    expect(picker.options).toEqual(["compact", "verbose"]);
  });

  it("accepts tg output-mode alias", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "tg output-mode" },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Output mode for this chat");
  });

  it("rejects invalid output mode values", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/output_mode loud" },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Usage: /output_mode simple|verbose");
    expect(sent[0]).toContain("Current mode: simple");
  });

  it("accepts simple as explicit mode alias", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/output_mode simple" },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Output mode is now simple");
  });

  it("rejects removed messages_only mode", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/output_mode messages_only" },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Usage: /output_mode simple|verbose");
    expect(sent[0]).toContain("Current mode: simple");
  });

});
