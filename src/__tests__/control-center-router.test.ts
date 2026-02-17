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

function createCtx(sent: string[], overrides?: Record<string, unknown>) {
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
    setTyping: () => {},
    syncCommandMenu: async () => {},
  };

  return {
    config,
    sessionManager,
    channel,
    ...(overrides || {}),
  } as any;
}

describe("camp chat commands", () => {
  it("does not block command handling when command-menu sync hangs", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent, {
      isControlCenterActive: async () => false,
    });
    (ctx.channel as { syncCommandMenu: () => Promise<void> }).syncCommandMenu = () =>
      new Promise<void>(() => {});

    await Promise.race([
      routeMessage(
        {
          userId: "telegram:1",
          chatId: "telegram:-100:4",
          isGroup: true,
          chatTitle: "Dev Team",
          text: "/start codex support-bot",
        },
        ctx
      ),
      Bun.sleep(250).then(() => {
        throw new Error("routeMessage timed out");
      }),
    ]);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Camp is not active");
  });

  it("requires active camp for /start", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent, {
      isControlCenterActive: async () => false,
    });

    await routeMessage(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        isGroup: true,
        chatTitle: "Dev Team",
        text: "/start codex support-bot",
      },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Camp is not active");
  });

  it("normalizes /start@BotName command mentions in groups", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent, {
      isControlCenterActive: async () => false,
    });

    await routeMessage(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        isGroup: true,
        chatTitle: "Dev Team",
        text: "/start@MyBot codex support-bot",
      },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Camp is not active");
  });

  it("starts /start and auto-links unlinked groups when camp is active", async () => {
    const sent: string[] = [];
    const opens: Array<Record<string, unknown>> = [];
    const ctx = createCtx(sent, {
      isControlCenterActive: async () => true,
      openControlCenterNewSession: async (args: Record<string, unknown>) => {
        opens.push(args);
        return { ok: true };
      },
    });

    await routeMessage(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        isGroup: true,
        chatTitle: "Dev Team",
        topicTitle: "Support Bot",
        text: "/start codex support-bot",
      },
      ctx
    );

    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      chatId: "telegram:-100:4",
      userId: "telegram:1",
      suggestedProjectName: "support-bot",
    });
    expect(ctx.config.channels.telegram.linkedGroups.some((g: { chatId: string }) => g.chatId === "telegram:-100:4")).toBe(true);
  });

  it("falls back to direct /start launch when picker is unavailable", async () => {
    const sent: string[] = [];
    const starts: Array<Record<string, unknown>> = [];
    const ctx = createCtx(sent, {
      isControlCenterActive: async () => true,
      startControlCenterSession: async (args: Record<string, unknown>) => {
        starts.push(args);
        return { ok: true, projectPath: "/Users/test/Dev/support-bot" };
      },
    });

    await routeMessage(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        isGroup: true,
        chatTitle: "Dev Team",
        text: "/start codex support-bot",
      },
      ctx
    );

    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      chatId: "telegram:-100:4",
      userId: "telegram:1",
      tool: "codex",
      projectName: "support-bot",
    });
    expect(sent[sent.length - 1]).toContain("Starting codex");
  });

  it("returns owner error on /start when camp rejects caller", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent, {
      isControlCenterActive: async () => true,
      startControlCenterSession: async () => ({
        ok: false,
        error: "Only the Camp owner can start sessions.",
      }),
    });

    await routeMessage(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        isGroup: true,
        chatTitle: "Dev Team",
        text: "/start claude",
      },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Only the Camp owner");
  });

  it("requires tool arg for direct /start launch without picker", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent, {
      isControlCenterActive: async () => true,
      startControlCenterSession: async () => ({ ok: true, projectPath: "/Users/test/Dev/default" }),
    });

    await routeMessage(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        isGroup: true,
        chatTitle: "Dev Team",
        text: "/start",
      },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Usage");
    expect(sent[0]).toContain("/start claude|codex|pi");
  });

  it("shows usage for /start@BotName without args", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent, {
      isControlCenterActive: async () => true,
      startControlCenterSession: async () => ({ ok: true, projectPath: "/Users/test/Dev/default" }),
    });

    await routeMessage(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        isGroup: true,
        chatTitle: "Dev Team",
        text: "/start@TeleTunBot",
      },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Usage");
    expect(sent[0]).toContain("/start claude|codex|pi");
  });

  it("/stop uses chat-bound stop callback", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent, {
      stopSessionForChat: async () => ({ ok: true, sessionId: "r-123abc" }),
    });

    await routeMessage(
      {
        userId: "telegram:1",
        chatId: "telegram:100",
        text: "/stop",
      },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Stop requested");
    expect(sent[0]).toContain("r-123abc");
  });

  it("/stop works without camp callback by using attached session", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);
    const remote = ctx.sessionManager.registerRemote(
      "claude",
      "telegram:100",
      "telegram:1",
      "/tmp/demo"
    );

    await routeMessage(
      {
        userId: "telegram:1",
        chatId: "telegram:100",
        text: "/stop",
      },
      ctx
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Stop requested");
    expect(sent[0]).toContain(remote.id);
  });
});
