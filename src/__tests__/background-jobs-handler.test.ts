import { describe, expect, it } from "bun:test";
import {
  emptyBackgroundJobsMessage,
  formatBackgroundJobs,
  handleBackgroundJobsCommand,
  type BackgroundJobSessionSummary,
} from "../bot/handlers/background-jobs";
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

describe("background jobs handler", () => {
  it("renders an empty-state message", async () => {
    const sent: string[] = [];
    const ctx = {
      channel: {
        fmt,
        send: async (_chatId: string, content: string) => sent.push(content),
      },
      listBackgroundJobs: () => [],
    } as any;

    await handleBackgroundJobsCommand(
      { userId: "telegram:1", chatId: "telegram:100", text: "/background-jobs" },
      ctx
    );

    expect(sent).toEqual([emptyBackgroundJobsMessage(fmt)]);
  });

  it("formats running jobs grouped by session", () => {
    const sessions: BackgroundJobSessionSummary[] = [{
      sessionId: "r-abc123",
      command: "claude --dangerously-skip-permissions",
      cwd: "/tmp/touchgrass",
      jobs: [
        {
          taskId: "bg_1",
          command: "npm run dev",
          urls: ["http://localhost:3000"],
          updatedAt: Date.now() - 8_000,
        },
        {
          taskId: "bg_2",
          command: "bun test --watch",
          updatedAt: Date.now() - 16_000,
        },
      ],
    }];

    const rendered = formatBackgroundJobs(fmt, sessions);
    expect(rendered).toContain("Background jobs (2 running)");
    expect(rendered).toContain("claude (touchgrass) • r-abc123");
    expect(rendered).toContain("bg_1 (");
    expect(rendered).toContain("bg_2 — bun test --watch");
    expect(rendered).toContain("http://localhost:3000");
    expect(rendered).not.toContain("bg_1 — npm run dev");
  });

  it("caps rendered jobs per session and shortens long command previews", () => {
    const longCmd = "node -e \"const http=require('http');http.createServer((req,res)=>res.end('long')).listen(9999,()=>console.log('http://localhost:9999'));setInterval(()=>{},1<<30);\"";
    const now = Date.now();
    const sessions: BackgroundJobSessionSummary[] = [{
      sessionId: "r-cap123",
      command: "claude --dangerously-skip-permissions",
      cwd: "/tmp/touchgrass",
      jobs: [
        { taskId: "bg_1", command: longCmd, updatedAt: now - 1_000 },
        { taskId: "bg_2", command: longCmd, updatedAt: now - 2_000 },
        { taskId: "bg_3", command: longCmd, updatedAt: now - 3_000 },
        { taskId: "bg_4", command: longCmd, updatedAt: now - 4_000 },
        { taskId: "bg_5", command: longCmd, updatedAt: now - 5_000 },
        { taskId: "bg_6", command: longCmd, updatedAt: now - 6_000 },
      ],
    }];

    const rendered = formatBackgroundJobs(fmt, sessions);
    expect(rendered).toContain("bg_1 — node -e");
    expect(rendered).toContain("...");
    expect(rendered).toContain("+1 more");
    expect(rendered).not.toContain("bg_6 —");
  });

  it("routes tg background-jobs alias through command router", async () => {
    const sent: string[] = [];
    const config = {
      channels: {
        telegram: {
          type: "telegram",
          credentials: {},
          pairedUsers: [{ userId: "telegram:1", pairedAt: new Date().toISOString() }],
          linkedGroups: [],
        },
      },
      settings: defaultSettings,
    };
    const sessionManager = new SessionManager(defaultSettings);
    const ctx = {
      config,
      sessionManager,
      channel: {
        fmt,
        send: async (_chatId: string, content: string) => sent.push(content),
      },
      listBackgroundJobs: () => [{
        sessionId: "r-abc123",
        command: "claude",
        cwd: "/tmp/touchgrass",
        jobs: [{ taskId: "bg_42", updatedAt: Date.now() - 1_000 }],
      }],
    } as any;

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "tg background-jobs" },
      ctx
    );

    expect(sent[0]).toContain("Background jobs (1 running)");
    expect(sent[0]).toContain("bg_42");
  });

  it("routes /background_jobs command through command router", async () => {
    const sent: string[] = [];
    const config = {
      channels: {
        telegram: {
          type: "telegram",
          credentials: {},
          pairedUsers: [{ userId: "telegram:1", pairedAt: new Date().toISOString() }],
          linkedGroups: [],
        },
      },
      settings: defaultSettings,
    };
    const sessionManager = new SessionManager(defaultSettings);
    const ctx = {
      config,
      sessionManager,
      channel: {
        fmt,
        send: async (_chatId: string, content: string) => sent.push(content),
      },
      listBackgroundJobs: () => [{
        sessionId: "r-def456",
        command: "claude",
        cwd: "/tmp/touchgrass",
        jobs: [{ taskId: "bg_99", updatedAt: Date.now() - 1_000 }],
      }],
    } as any;

    await routeMessage(
      { userId: "telegram:1", chatId: "telegram:100", text: "/background_jobs" },
      ctx
    );

    expect(sent[0]).toContain("Background jobs (1 running)");
    expect(sent[0]).toContain("bg_99");
  });
});
