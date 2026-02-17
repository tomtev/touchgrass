import { describe, expect, it } from "bun:test";
import { __cliRunTestUtils } from "../cli/run";

describe("codex resume arg parsing", () => {
  it("detects resume ID when resume subcommand appears after global flags", () => {
    const parsed = __cliRunTestUtils.parseCodexResumeArgs([
      "--dangerously-bypass-approvals-and-sandbox",
      "resume",
      "019c56ac-417b-7180-bd3f-2ed6e25885e3",
    ]);

    expect(parsed.resumeId).toBe("019c56ac-417b-7180-bd3f-2ed6e25885e3");
    expect(parsed.useResumeLast).toBe(false);
    expect(parsed.baseArgs).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
  });

  it("detects resume --last even when mixed with other flags", () => {
    const parsed = __cliRunTestUtils.parseCodexResumeArgs([
      "--dangerously-bypass-approvals-and-sandbox",
      "resume",
      "--last",
    ]);

    expect(parsed.resumeId).toBeNull();
    expect(parsed.useResumeLast).toBe(true);
    expect(parsed.baseArgs).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
  });

  it("supports explicit --resume forms", () => {
    const fromPair = __cliRunTestUtils.parseCodexResumeArgs(["--resume", "abc123", "--foo"]);
    expect(fromPair.resumeId).toBe("abc123");
    expect(fromPair.baseArgs).toEqual(["--foo"]);

    const fromEq = __cliRunTestUtils.parseCodexResumeArgs(["--resume=def456", "--foo"]);
    expect(fromEq.resumeId).toBe("def456");
    expect(fromEq.baseArgs).toEqual(["--foo"]);
  });

  it("removes exec/json transport args from base args", () => {
    const parsed = __cliRunTestUtils.parseCodexResumeArgs(["exec", "--json", "--foo"]);
    expect(parsed.resumeId).toBeNull();
    expect(parsed.useResumeLast).toBe(false);
    expect(parsed.baseArgs).toEqual(["--foo"]);
  });
});

describe("remote terminal input encoding", () => {
  it("wraps chat input as bracketed paste to avoid picker shortcuts", () => {
    const encoded = __cliRunTestUtils.encodeBracketedPaste("hello @");
    expect(encoded.toString()).toBe("\x1b[200~hello @\x1b[201~");
  });
});

describe("resume restart arg building", () => {
  it("preserves claude dangerous flags while swapping resume target", () => {
    const args = __cliRunTestUtils.buildResumeCommandArgs(
      "claude",
      ["--dangerously-skip-permissions", "--resume", "old-id", "--append-system-prompt", "AGENTS.md"],
      "new-id"
    );

    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("AGENTS.md");
    expect(args.slice(-2)).toEqual(["--resume", "new-id"]);
    expect(args).not.toContain("old-id");
  });

  it("preserves codex dangerous flags while swapping resume target", () => {
    const args = __cliRunTestUtils.buildResumeCommandArgs(
      "codex",
      ["--dangerously-bypass-approvals-and-sandbox", "resume", "019c-old"],
      "019c-new"
    );

    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args.slice(-2)).toEqual(["resume", "019c-new"]);
    expect(args).not.toContain("019c-old");
  });

  it("uses --session for pi and preserves other args", () => {
    const args = __cliRunTestUtils.buildResumeCommandArgs(
      "pi",
      ["--provider", "google", "--session", "/tmp/old.jsonl"],
      "/tmp/new.jsonl"
    );

    expect(args).toContain("--provider");
    expect(args).toContain("google");
    expect(args.slice(-2)).toEqual(["--session", "/tmp/new.jsonl"]);
    expect(args).not.toContain("/tmp/old.jsonl");
  });
});

describe("auto context injection", () => {
  it("injects append system prompt for claude by default", () => {
    const args = __cliRunTestUtils.applyTouchgrassAutoContextArgs("claude", ["--dangerously-skip-permissions"]);
    expect(args[0]).toBe("--append-system-prompt");
    expect(args[1]).toContain("touchgrass bridge context");
    expect(args[1]).toContain("tg send $TG_SESSION_ID");
    expect(args[1]).toContain("tg send --file $TG_SESSION_ID");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("does not duplicate append system prompt for claude", () => {
    const args = __cliRunTestUtils.applyTouchgrassAutoContextArgs("claude", [
      "--append-system-prompt",
      "custom prompt",
      "--dangerously-skip-permissions",
    ]);
    expect(args).toEqual(["--append-system-prompt", "custom prompt", "--dangerously-skip-permissions"]);
  });

  it("does not duplicate append system prompt for claude equals form", () => {
    const args = __cliRunTestUtils.applyTouchgrassAutoContextArgs("claude", [
      "--append-system-prompt=custom-eq",
      "--dangerously-skip-permissions",
    ]);
    expect(args).toEqual(["--append-system-prompt=custom-eq", "--dangerously-skip-permissions"]);
  });

  it("injects developer instructions config for codex by default", () => {
    const args = __cliRunTestUtils.applyTouchgrassAutoContextArgs("codex", [
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
    expect(args[0]).toBe("-c");
    expect(args[1]).toContain("developer_instructions=");
    expect(args[1]).toContain("touchgrass bridge context");
    expect(args[1]).toContain("tg send $TG_SESSION_ID");
    expect(args[1]).toContain("tg send --file $TG_SESSION_ID");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("does not duplicate developer instructions for codex", () => {
    const args = __cliRunTestUtils.applyTouchgrassAutoContextArgs("codex", [
      "-c",
      "developer_instructions=\"custom\"",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
    expect(args).toEqual([
      "-c",
      "developer_instructions=\"custom\"",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });

  it("does not duplicate developer instructions for codex --config= form", () => {
    const args = __cliRunTestUtils.applyTouchgrassAutoContextArgs("codex", [
      "--config=developer_instructions=\"custom2\"",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
    expect(args).toEqual([
      "--config=developer_instructions=\"custom2\"",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });

  it("injects developer instructions for codex when other config keys exist", () => {
    const args = __cliRunTestUtils.applyTouchgrassAutoContextArgs("codex", [
      "-c",
      "model=\"o3\"",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
    expect(args[0]).toBe("-c");
    expect(args[1]).toContain("developer_instructions=");
    expect(args).toEqual([
      "-c",
      expect.stringContaining("developer_instructions="),
      "-c",
      "model=\"o3\"",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });

  it("injects append system prompt for pi by default", () => {
    const args = __cliRunTestUtils.applyTouchgrassAutoContextArgs("pi", ["--provider", "google"]);
    expect(args[0]).toBe("--append-system-prompt");
    expect(args[1]).toContain("touchgrass bridge context");
    expect(args[1]).toContain("tg send $TG_SESSION_ID");
    expect(args[1]).toContain("tg send --file $TG_SESSION_ID");
    expect(args.slice(2)).toEqual(["--provider", "google"]);
  });

  it("does not duplicate append system prompt for pi equals form", () => {
    const args = __cliRunTestUtils.applyTouchgrassAutoContextArgs("pi", [
      "--append-system-prompt=custom-pi",
      "--provider",
      "google",
    ]);
    expect(args).toEqual(["--append-system-prompt=custom-pi", "--provider", "google"]);
  });
});

describe("run setup preflight", () => {
  it("fails when telegram token is missing", () => {
    const result = __cliRunTestUtils.validateRunSetupPreflight({
      channels: {
        telegram: {
          type: "telegram",
          credentials: {},
          pairedUsers: [{ userId: "telegram:123", pairedAt: "2026-02-16T00:00:00.000Z" }],
          linkedGroups: [],
        },
      },
      settings: {
        outputBatchMinMs: 300,
        outputBatchMaxMs: 800,
        outputBufferMaxChars: 4096,
        maxSessions: 10,
        defaultShell: "/bin/zsh",
      },
      chatPreferences: {},
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Telegram setup is incomplete");
  });

  it("passes when token and paired owner are present", () => {
    const result = __cliRunTestUtils.validateRunSetupPreflight({
      channels: {
        telegram: {
          type: "telegram",
          credentials: { botToken: "123:abc" },
          pairedUsers: [{ userId: "telegram:123", pairedAt: "2026-02-16T00:00:00.000Z" }],
          linkedGroups: [],
        },
      },
      settings: {
        outputBatchMinMs: 300,
        outputBatchMaxMs: 800,
        outputBufferMaxChars: 4096,
        maxSessions: 10,
        defaultShell: "/bin/zsh",
      },
      chatPreferences: {},
    });

    expect(result.ok).toBe(true);
  });
});
