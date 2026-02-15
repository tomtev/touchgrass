import { describe, expect, it } from "bun:test";
import { handleStdinInput } from "../bot/handlers/stdin-input";
import { SessionManager } from "../session/manager";
import { createDefaultConfig, defaultSettings } from "../config/schema";

describe("stdin input pending file mentions", () => {
  it("prepends selected file mention using '<mentions> - <text>' format", async () => {
    const config = createDefaultConfig();
    const sessionManager = new SessionManager(defaultSettings);
    const remote = sessionManager.registerRemote(
      "codex",
      "telegram:-100:4",
      "telegram:1",
      "/tmp/repo",
      "r-test01"
    );
    sessionManager.attach("telegram:-100:4", remote.id);
    sessionManager.setPendingFileMentions(remote.id, "telegram:-100:4", "telegram:1", ["@README.md"]);

    const sent: string[] = [];
    const ctx = {
      config,
      sessionManager,
      channel: {
        fmt: {
          code: (v: string) => v,
          escape: (v: string) => v,
        },
        send: async (_chatId: string, text: string) => {
          sent.push(text);
        },
      },
    } as any;

    await handleStdinInput(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        text: "Whats in the file",
        isGroup: true,
      },
      ctx
    );

    expect(remote.inputQueue[0]).toBe("@README.md - Whats in the file");
    expect(sent.length).toBe(0);
  });

  it("consumes pending file mentions once", async () => {
    const config = createDefaultConfig();
    const sessionManager = new SessionManager(defaultSettings);
    const remote = sessionManager.registerRemote(
      "codex",
      "telegram:-100:4",
      "telegram:1",
      "/tmp/repo",
      "r-test02"
    );
    sessionManager.attach("telegram:-100:4", remote.id);
    sessionManager.setPendingFileMentions(remote.id, "telegram:-100:4", "telegram:1", ["@README.md"]);

    const ctx = {
      config,
      sessionManager,
      channel: {
        fmt: {
          code: (v: string) => v,
          escape: (v: string) => v,
        },
        send: async () => {},
      },
    } as any;

    await handleStdinInput(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        text: "first",
      },
      ctx
    );
    await handleStdinInput(
      {
        userId: "telegram:1",
        chatId: "telegram:-100:4",
        text: "second",
      },
      ctx
    );

    expect(remote.inputQueue[0]).toBe("@README.md - first");
    expect(remote.inputQueue[1]).toBe("second");
  });
});
