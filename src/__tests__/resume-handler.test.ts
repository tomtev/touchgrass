import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { __resumeTestUtils, handleResumeCommand } from "../bot/handlers/resume";
import type { ResumeSessionCandidate } from "../session/manager";
import { SessionManager } from "../session/manager";
import { createDefaultConfig, defaultSettings } from "../config/schema";

function makeSession(label: string, ref: string, mtimeMs = Date.now()): ResumeSessionCandidate {
  return { label, sessionRef: ref, mtimeMs };
}

describe("resume picker pagination", () => {
  it("uses a More button like /files", () => {
    const sessions = Array.from({ length: 25 }, (_, i) =>
      makeSession(`session-${i + 1}`, `ref-${i + 1}`, Date.now() - i * 1000)
    );

    const page0 = __resumeTestUtils.buildResumePickerPage(sessions, 0, 10);
    expect(page0.optionLabels).toHaveLength(10);
    expect(page0.optionLabels[9]).toBe("➡️ More");
    expect(page0.options[9]).toEqual({ kind: "more", nextOffset: 9 });

    const page1 = __resumeTestUtils.buildResumePickerPage(sessions, 9, 10);
    expect(page1.optionLabels).toHaveLength(10);
    expect(page1.optionLabels[9]).toBe("➡️ More");
    expect(page1.options[9]).toEqual({ kind: "more", nextOffset: 18 });

    const page2 = __resumeTestUtils.buildResumePickerPage(sessions, 18, 10);
    expect(page2.optionLabels).not.toContain("➡️ More");
    expect(page2.optionLabels.length).toBeGreaterThan(0);
  });

  it("omits More when sessions fit on one page", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      makeSession(`session-${i + 1}`, `ref-${i + 1}`, Date.now() - i * 1000)
    );
    const page = __resumeTestUtils.buildResumePickerPage(sessions, 0, 10);
    expect(page.optionLabels).toHaveLength(4);
    expect(page.optionLabels).not.toContain("➡️ More");
  });

  it("clamps out-of-range offsets", () => {
    const sessions = Array.from({ length: 3 }, (_, i) =>
      makeSession(`session-${i + 1}`, `ref-${i + 1}`, Date.now() - i * 1000)
    );
    const page = __resumeTestUtils.buildResumePickerPage(sessions, 999, 10);
    expect(page.offset).toBe(2);
    expect(page.optionLabels[0]).toContain("session-3");
  });
});

describe("resume session discovery", () => {
  it("extracts codex and pi session tokens from filenames", () => {
    expect(
      __resumeTestUtils.parseCodexSessionId(
        "/tmp/rollout-2026-01-12T21-49-45-019bb3f8-cb68-72f0-8542-afbcbb5207f8.jsonl"
      )
    ).toBe("019bb3f8-cb68-72f0-8542-afbcbb5207f8");

    expect(
      __resumeTestUtils.parsePiSessionToken(
        "/tmp/2026-02-11T22-17-53-914Z_4f5814e4-8823-4d1b-ba68-8dbab84c5ca4.jsonl"
      )
    ).toBe("4f5814e4-8823-4d1b-ba68-8dbab84c5ca4");
  });

  it("reads recent sessions from home directories", () => {
    const root = mkdtempSync(join(tmpdir(), "tg-resume-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const claudeDir = join(root, ".claude", "projects", "-tmp-repo");
      mkdirSync(claudeDir, { recursive: true });
      const claudeFile = join(claudeDir, "edc2331d-8b9f-46ce-a96f-caffb470df35.jsonl");
      writeFileSync(
        claudeFile,
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "hello from claude" }] },
        }) + "\n"
      );
      utimesSync(claudeFile, new Date(), new Date("2026-02-15T10:00:00.000Z"));

      const codexDir = join(root, ".codex", "sessions", "2026", "02", "15");
      mkdirSync(codexDir, { recursive: true });
      const codexOld = join(
        codexDir,
        "rollout-2026-02-15T10-00-00-019c56ac-417b-7180-bd3f-2ed6e25885e3.jsonl"
      );
      const codexNew = join(
        codexDir,
        "rollout-2026-02-15T11-00-00-019c56ac-417b-7180-bd3f-2ed6e2589999.jsonl"
      );
      writeFileSync(
        codexOld,
        JSON.stringify({
          type: "event_msg",
          payload: { type: "agent_message", message: "older codex response" },
        }) + "\n"
      );
      writeFileSync(
        codexNew,
        JSON.stringify({
          type: "event_msg",
          payload: { type: "agent_message", message: "latest codex response" },
        }) + "\n"
      );
      utimesSync(codexOld, new Date(), new Date("2026-02-15T10:00:00.000Z"));
      utimesSync(codexNew, new Date(), new Date("2026-02-15T11:00:00.000Z"));

      const piDir = join(root, ".pi", "agent", "sessions", "--tmp-repo--");
      mkdirSync(piDir, { recursive: true });
      const piFile = join(piDir, "2026-02-11T22-17-53-914Z_4f5814e4-8823-4d1b-ba68-8dbab84c5ca4.jsonl");
      writeFileSync(
        piFile,
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "pi says hello" }] },
        }) + "\n"
      );

      const claudeSessions = __resumeTestUtils.listRecentSessions("claude", "/tmp/repo");
      expect(claudeSessions[0]?.sessionRef).toBe("edc2331d-8b9f-46ce-a96f-caffb470df35");
      expect(claudeSessions[0]?.label).toContain("hello from claude");
      expect(claudeSessions[0]?.label).toContain("ago:");

      const codexSessions = __resumeTestUtils.listRecentSessions("codex", "/tmp/repo");
      expect(codexSessions[0]?.sessionRef).toBe("019c56ac-417b-7180-bd3f-2ed6e2589999");
      expect(codexSessions[1]?.sessionRef).toBe("019c56ac-417b-7180-bd3f-2ed6e25885e3");
      expect(codexSessions[0]?.label).toContain("latest codex response");
      expect(codexSessions[0]?.label).toContain("ago:");

      const piSessions = __resumeTestUtils.listRecentSessions("pi", "/tmp/repo");
      expect(piSessions[0]?.sessionRef).toBe(piFile);
      expect(piSessions[0]?.label).toContain("pi says hello");
      expect(piSessions[0]?.label).toContain("ago:");
    } finally {
      process.env.HOME = originalHome;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("extracts assistant previews from all tool JSONL formats", () => {
    const root = mkdtempSync(join(tmpdir(), "tg-resume-preview-"));
    try {
      const claudeFile = join(root, "claude.jsonl");
      writeFileSync(
        claudeFile,
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Claude wrote this response" }] },
        }) + "\n"
      );
      expect(__resumeTestUtils.extractLastAssistantPreview("claude", claudeFile)).toContain("Claude wrote");

      const codexFile = join(root, "codex.jsonl");
      writeFileSync(
        codexFile,
        JSON.stringify({
          type: "event_msg",
          payload: { type: "agent_message", message: "Codex output line" },
        }) + "\n"
      );
      expect(__resumeTestUtils.extractLastAssistantPreview("codex", codexFile)).toContain("Codex output");

      const piFile = join(root, "pi.jsonl");
      writeFileSync(
        piFile,
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "PI output line" }] },
        }) + "\n"
      );
      expect(__resumeTestUtils.extractLastAssistantPreview("pi", piFile)).toContain("PI output");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resume handler", () => {
  it("detects supported tools from command strings", () => {
    expect(__resumeTestUtils.detectTool("claude --dangerously-skip-permissions")).toBe("claude");
    expect(__resumeTestUtils.detectTool("codex resume abc")).toBe("codex");
    expect(__resumeTestUtils.detectTool("pi --mode json")).toBe("pi");
    expect(__resumeTestUtils.detectTool("bash")).toBeNull();
  });

  it("requires a connected remote session", async () => {
    const config = createDefaultConfig();
    const sessionManager = new SessionManager(defaultSettings);
    const sent: string[] = [];
    const ctx = {
      config,
      sessionManager,
      channel: {
        fmt: { code: (v: string) => v, escape: (v: string) => v },
        send: async (_chatId: string, text: string) => sent.push(text),
      },
    } as any;

    await handleResumeCommand(
      { userId: "telegram:1", chatId: "telegram:100", text: "/resume" },
      ctx
    );
    expect(sent[0]).toContain("No connected session");
  });

  it("opens a resume picker and stores pager state", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-resume-handler-"));
    const originalHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const config = createDefaultConfig();
      const sessionManager = new SessionManager(defaultSettings);
      const remote = sessionManager.registerRemote(
        "claude --dangerously-skip-permissions",
        "telegram:100",
        "telegram:1",
        "/tmp/repo",
        "r-resume01"
      );
      sessionManager.attach("telegram:100", remote.id);

      const claudeDir = join(root, ".claude", "projects", "-tmp-repo");
      mkdirSync(claudeDir, { recursive: true });
      for (let i = 0; i < 12; i++) {
        const id = `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
        const f = join(claudeDir, `${id}.jsonl`);
        writeFileSync(f, "{}");
        utimesSync(f, new Date(), new Date(Date.now() - i * 1000));
      }

      const polls: Array<{ title: string; options: string[] }> = [];
      const ctx = {
        config,
        sessionManager,
        channel: {
          fmt: { code: (v: string) => v, escape: (v: string) => v, bold: (v: string) => v },
          send: async () => {},
          sendPoll: async (_chatId: string, title: string, options: string[]) => {
            polls.push({ title, options });
            return { pollId: "resume-poll-1", messageId: "msg-1" };
          },
        },
      } as any;

      await handleResumeCommand(
        { userId: "telegram:1", chatId: "telegram:100", text: "/resume" },
        ctx
      );

      expect(polls).toHaveLength(1);
      expect(polls[0].title).toContain("Resume session");
      expect(polls[0].options).toContain("➡️ More");

      const picker = sessionManager.getResumePickerByPollId("resume-poll-1");
      expect(picker?.sessionId).toBe(remote.id);
      expect(picker?.options.length).toBe(10);
    } finally {
      process.env.HOME = originalHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
