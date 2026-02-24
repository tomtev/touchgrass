import { describe, expect, it } from "bun:test";
import { routeMessage } from "../bot/command-router";
import { SessionManager } from "../session/manager";
import { defaultSettings, getChatThinkingEnabled } from "../config/schema";

const fmt = {
  bold: (value: string) => value,
  italic: (value: string) => value,
  code: (value: string) => value,
  pre: (value: string) => value,
  link: (value: string) => value,
  escape: (value: string) => value,
  fromMarkdown: (value: string) => value,
};

function createCtx(sent: string[]) {
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

  return {
    config,
    sessionManager,
    channel,
  } as any;
}

describe("thinking command", () => {
  it("toggles thinking on when no args are provided", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/thinking" },
      ctx
    );

    expect(getChatThinkingEnabled(ctx.config, "telegram:100")).toBe(true);
    expect(sent[0]).toContain("Thinking is now on");
  });

  it("accepts explicit off value", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);
    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/thinking on" },
      ctx
    );
    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/thinking off" },
      ctx
    );

    expect(getChatThinkingEnabled(ctx.config, "telegram:100")).toBe(false);
    expect(sent[sent.length - 1]).toContain("Thinking is now off");
  });

  it("supports tg thinking alias", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "tg thinking on" },
      ctx
    );

    expect(getChatThinkingEnabled(ctx.config, "telegram:100")).toBe(true);
    expect(sent[0]).toContain("Thinking is now on");
  });

  it("shows usage on invalid value", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/thinking maybe" },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Usage: /thinking on|off|toggle");
  });

  it("confirms state change without mode-specific suffix", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/thinking on" },
      ctx
    );

    expect(sent[0]).toContain("Thinking is now on");
    expect(sent[0]).not.toContain("hidden while output mode");
  });
});
