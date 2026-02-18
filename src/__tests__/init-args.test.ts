import { describe, expect, it } from "bun:test";
import { __initTestUtils } from "../cli/init";

describe("setup arg parsing", () => {
  it("parses --telegram <token>", () => {
    const parsed = __initTestUtils.parseSetupArgs(["--telegram", "123:abc"]);
    expect(parsed.telegramToken).toBe("123:abc");
    expect(parsed.help).toBe(false);
  });

  it("parses --telegram=<token>", () => {
    const parsed = __initTestUtils.parseSetupArgs(["--telegram=123:def"]);
    expect(parsed.telegramToken).toBe("123:def");
  });

  it("parses --help", () => {
    const parsed = __initTestUtils.parseSetupArgs(["--help"]);
    expect(parsed.help).toBe(true);
  });

  it("throws when --telegram value is missing", () => {
    expect(() => __initTestUtils.parseSetupArgs(["--telegram"]))
      .toThrow("--telegram requires a token value.");
  });

  it("throws on unknown option", () => {
    expect(() => __initTestUtils.parseSetupArgs(["--unknown"]))
      .toThrow("Unknown option for tg setup: --unknown");
  });
});

describe("setup daemon session counting", () => {
  it("counts running and remote sessions only", () => {
    const count = __initTestUtils.countActiveDaemonSessions({
      sessions: [
        { state: "running" },
        { state: "remote" },
        { state: "disconnected" },
        { state: "stopped" },
        null,
        "invalid",
      ],
    });
    expect(count).toBe(2);
  });
});
