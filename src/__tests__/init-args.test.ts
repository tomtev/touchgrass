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

  it("parses --channel <name>", () => {
    const parsed = __initTestUtils.parseSetupArgs(["--channel", "bot2"]);
    expect(parsed.channelName).toBe("bot2");
  });

  it("parses --channel=<name>", () => {
    const parsed = __initTestUtils.parseSetupArgs(["--channel=ops_bot"]);
    expect(parsed.channelName).toBe("ops_bot");
  });

  it("parses --list-channels", () => {
    const parsed = __initTestUtils.parseSetupArgs(["--list-channels"]);
    expect(parsed.listChannels).toBe(true);
  });

  it("parses --show", () => {
    const parsed = __initTestUtils.parseSetupArgs(["--show"]);
    expect(parsed.showChannel).toBe(true);
    expect(parsed.channelName).toBe("telegram");
  });

  it("throws when --telegram value is missing", () => {
    expect(() => __initTestUtils.parseSetupArgs(["--telegram"]))
      .toThrow("--telegram requires a token value.");
  });

  it("throws on unknown option", () => {
    expect(() => __initTestUtils.parseSetupArgs(["--unknown"]))
      .toThrow("Unknown option for tg setup: --unknown");
  });

  it("throws when --channel value is missing", () => {
    expect(() => __initTestUtils.parseSetupArgs(["--channel"]))
      .toThrow("--channel requires a channel name.");
  });

  it("throws on invalid channel value", () => {
    expect(() => __initTestUtils.parseSetupArgs(["--channel", "123"]))
      .toThrow("Invalid --channel value");
  });

  it("throws when --list-channels is used with --telegram", () => {
    expect(() => __initTestUtils.parseSetupArgs(["--list-channels", "--telegram", "123:abc"]))
      .toThrow("--list-channels cannot be used with --telegram.");
  });

  it("throws when --show is used with --telegram", () => {
    expect(() => __initTestUtils.parseSetupArgs(["--show", "--telegram", "123:abc"]))
      .toThrow("--show cannot be used with --telegram.");
  });

  it("throws when --list-channels and --show are combined", () => {
    expect(() => __initTestUtils.parseSetupArgs(["--list-channels", "--show"]))
      .toThrow("Use either --list-channels or --show, not both.");
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
