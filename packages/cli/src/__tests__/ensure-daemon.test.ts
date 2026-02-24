import { describe, expect, it } from "bun:test";
import { __ensureDaemonTestUtils } from "../cli/ensure-daemon";

describe("ensure-daemon version restart policy", () => {
  it("detects active sessions from daemon status", () => {
    expect(__ensureDaemonTestUtils.hasActiveSessions({ sessions: [] })).toBe(false);
    expect(
      __ensureDaemonTestUtils.hasActiveSessions({
        sessions: [{ id: "r-1", state: "remote" }],
      })
    ).toBe(true);
    expect(
      __ensureDaemonTestUtils.hasActiveSessions({
        sessions: [{ id: "abc", state: "running" }],
      })
    ).toBe(true);
    expect(
      __ensureDaemonTestUtils.hasActiveSessions({
        sessions: [{ id: "abc", state: "exited" }],
      })
    ).toBe(false);
  });

  it("restarts only when daemon is stale, status is available, and there are no active sessions", () => {
    expect(
      __ensureDaemonTestUtils.shouldRestartDaemonForVersion(
        1000,
        1200,
        { sessions: [] }
      )
    ).toBe(true);

    expect(
      __ensureDaemonTestUtils.shouldRestartDaemonForVersion(
        1000,
        900,
        { sessions: [] }
      )
    ).toBe(false);

    expect(
      __ensureDaemonTestUtils.shouldRestartDaemonForVersion(
        1000,
        1200,
        { sessions: [{ state: "remote" }] }
      )
    ).toBe(false);

    expect(
      __ensureDaemonTestUtils.shouldRestartDaemonForVersion(
        1000,
        1200,
        null
      )
    ).toBe(false);
  });

  it("parses only touchgrass daemon pids from ps output", () => {
    const output = [
      "61093 /Users/tommyvedvik/.local/bin/tg __daemon__ --tg-home /srv/tg/bot-a",
      "61024 /Users/tommyvedvik/.local/bin/tg __daemon__ --tg-home /srv/tg/bot-b",
      "70000 /usr/bin/python some_daemon.py",
      "80000 /usr/local/bin/tg codex",
      "90000 /tmp/other __daemon__",
    ].join("\n");

    expect(__ensureDaemonTestUtils.parseDaemonPidsFromPs(output)).toEqual([
      { pid: 61093, home: "/srv/tg/bot-a" },
      { pid: 61024, home: "/srv/tg/bot-b" },
    ]);
  });

  it("reaps only daemons that share the same TOUCHGRASS_HOME", () => {
    const daemons = [
      { pid: 61093, home: "/srv/tg/bot-a" },
      { pid: 61024, home: "/srv/tg/bot-a" },
      { pid: 71000, home: "/srv/tg/bot-b" },
    ];

    expect(__ensureDaemonTestUtils.selectDuplicateDaemonPids(1234, daemons, "/srv/tg/bot-a")).toEqual([]);
    expect(__ensureDaemonTestUtils.selectDuplicateDaemonPids(61093, daemons, "/srv/tg/bot-a")).toEqual([61024]);
    expect(__ensureDaemonTestUtils.selectDuplicateDaemonPids(61093, daemons, "/srv/tg/bot-b")).toEqual([]);
  });
});
