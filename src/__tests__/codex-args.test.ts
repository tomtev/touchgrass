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
