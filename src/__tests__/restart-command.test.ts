import { describe, expect, it } from "bun:test";
import { __restartTestUtils } from "../cli/restart";

describe("restart command arg parsing", () => {
  it("parses optional session id", () => {
    const parsed = __restartTestUtils.parseRestartArgs([
      "r-ab12cd"
    ]);
    expect(parsed).toEqual({
      sessionIdPartial: "r-ab12cd",
    });
  });

  it("allows no args", () => {
    const parsed = __restartTestUtils.parseRestartArgs([]);
    expect(parsed).toEqual({
      sessionIdPartial: null,
    });
  });

  it("rejects unknown options", () => {
    expect(() =>
      __restartTestUtils.parseRestartArgs(["--unknown"])
    ).toThrow("Unknown option for tg restart: --unknown");
  });

  it("rejects multiple session ids", () => {
    expect(() =>
      __restartTestUtils.parseRestartArgs(["r-one", "r-two"])
    ).toThrow("Only one session ID may be provided.");
  });
});

describe("restart command resume extraction", () => {
  it("extracts claude resume ref from --resume with dangerous flags", () => {
    const tool = __restartTestUtils.detectTool(
      "claude --dangerously-skip-permissions --resume claude-session-1"
    );
    expect(tool).toBe("claude");
    expect(__restartTestUtils.extractResumeRef("claude", "claude --dangerously-skip-permissions --resume claude-session-1")).toBe("claude-session-1");
  });

  it("extracts codex resume ref from resume subcommand with dangerous flags", () => {
    const command = "codex --dangerously-bypass-approvals-and-sandbox resume 019c56ac-417b-7180-bd3f-2ed6e25885e3";
    const tool = __restartTestUtils.detectTool(command);
    expect(tool).toBe("codex");
    expect(__restartTestUtils.extractResumeRef("codex", command)).toBe("019c56ac-417b-7180-bd3f-2ed6e25885e3");
  });

  it("extracts pi and kimi session refs from --session/-S flags", () => {
    expect(
      __restartTestUtils.extractResumeRef("pi", "pi --provider google --session /tmp/pi-session.jsonl")
    ).toBe("/tmp/pi-session.jsonl");

    expect(
      __restartTestUtils.extractResumeRef("kimi", "kimi --model kimi-k2 -S kimi-session-1")
    ).toBe("kimi-session-1");
  });
});

describe("restart session resolution", () => {
  it("resolves by unique partial", () => {
    const target = __restartTestUtils.resolveSessionTarget(
      [
        { id: "r-aaa111", command: "claude", state: "remote" },
        { id: "r-bbb222", command: "codex", state: "remote" },
      ],
      "bbb"
    );
    expect(target.id).toBe("r-bbb222");
  });

  it("requires explicit id when multiple sessions exist and no target is provided", () => {
    expect(() =>
      __restartTestUtils.resolveSessionTarget(
        [
          { id: "r-aaa111", command: "claude", state: "remote" },
          { id: "r-bbb222", command: "codex", state: "remote" },
        ],
        null
      )
    ).toThrow("Multiple sessions are active");
  });
});
