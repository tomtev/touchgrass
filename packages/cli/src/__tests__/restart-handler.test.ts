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

describe("restart session management command", () => {
  it("queues a resume restart for attached session by inferring current tool session", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);
    const remote = ctx.sessionManager.registerRemote(
      "claude --dangerously-skip-permissions --resume old-claude",
      "telegram:100",
      "telegram:1",
      "/tmp/project",
      "r-restart01"
    );

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "tg restart" },
      ctx
    );

    expect(sent[0]).toContain("Requested restart");
    const action = ctx.sessionManager.drainRemoteControl(remote.id);
    expect(action).toEqual({ type: "resume", sessionRef: "old-claude" });
  });

  it("infers resume session ref from existing command when --session is omitted", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);
    const remote = ctx.sessionManager.registerRemote(
      "codex --dangerously-bypass-approvals-and-sandbox resume 019c-old",
      "telegram:100",
      "telegram:1",
      "/tmp/project",
      "r-restart02"
    );

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "tg restart" },
      ctx
    );

    expect(sent[0]).toContain("Requested restart");
    const action = ctx.sessionManager.drainRemoteControl(remote.id);
    expect(action).toEqual({ type: "resume", sessionRef: "019c-old" });
  });

  it("shows guidance when restart ref cannot be inferred", async () => {
    const sent: string[] = [];
    const ctx = createCtx(sent);
    ctx.sessionManager.registerRemote(
      "claude --dangerously-skip-permissions",
      "telegram:100",
      "telegram:1",
      "/tmp/project",
      "r-restart03"
    );

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "tg restart" },
      ctx
    );

    expect(sent[0]).toContain("Could not infer a tool session ID");
  });
});
