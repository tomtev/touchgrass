import { describe, expect, it } from "bun:test";
import {
  createRemoteRecoveryController,
  type RemoteRecoveryInput,
} from "../cli/remote-recovery";

function baseInput(overrides: Partial<RemoteRecoveryInput> = {}): RemoteRecoveryInput {
  return {
    remoteId: "r-abc123",
    fullCommand: "claude",
    chatId: "telegram:123",
    ownerUserId: "telegram:123",
    cwd: "/tmp/project",
    subscribedGroups: ["telegram:-100:4"],
    boundChat: "telegram:-100:4",
    ...overrides,
  };
}

describe("remote daemon recovery", () => {
  it("re-registers and re-binds after unknown session", async () => {
    let ensured = 0;
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    const logs: string[] = [];
    const errs: string[] = [];

    const recovery = createRemoteRecoveryController({
      ensureDaemon: async () => {
        ensured++;
      },
      daemonRequest: async (path, method = "GET", body) => {
        calls.push({ path, method, body });
        return { ok: true };
      },
      log: (text) => logs.push(text),
      logErr: (text) => errs.push(text),
    });

    const ok = await recovery.recover("unknown", baseInput());

    expect(ok).toBe(true);
    expect(ensured).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.path).toBe("/remote/register");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body?.sessionId).toBe("r-abc123");
    expect(calls[0]?.body?.subscribedGroups).toEqual(["telegram:-100:4"]);
    expect(calls[1]?.path).toBe("/remote/bind-chat");
    expect(logs).toContain("Lost daemon registration. Attempting re-register...");
    expect(logs).toContain("Reconnected to daemon.");
    expect(errs).toEqual([]);
  });

  it("logs retry failure message for unknown-session recovery errors", async () => {
    const logs: string[] = [];
    const errs: string[] = [];

    const recovery = createRemoteRecoveryController({
      ensureDaemon: async () => {},
      daemonRequest: async () => {
        throw new Error("down");
      },
      log: (text) => logs.push(text),
      logErr: (text) => errs.push(text),
    });

    const ok = await recovery.recover("unknown", baseInput({ boundChat: null }));

    expect(ok).toBe(false);
    expect(logs).toContain("Lost daemon registration. Attempting re-register...");
    expect(errs).toContain("re-registration failed; will retry.");
  });

  it("throttles unreachable recovery attempts", async () => {
    let nowMs = 1_000;
    let ensured = 0;
    const calls: string[] = [];

    const recovery = createRemoteRecoveryController({
      ensureDaemon: async () => {
        ensured++;
      },
      daemonRequest: async (path) => {
        calls.push(path);
        return { ok: true };
      },
      log: () => {},
      logErr: () => {},
      minIntervalMs: 1_500,
      now: () => nowMs,
    });

    expect(await recovery.recover("unreachable", baseInput({ boundChat: null }))).toBe(true);
    expect(await recovery.recover("unreachable", baseInput({ boundChat: null }))).toBe(false);
    nowMs = 2_600;
    expect(await recovery.recover("unreachable", baseInput({ boundChat: null }))).toBe(true);

    expect(ensured).toBe(2);
    expect(calls.filter((p) => p === "/remote/register")).toHaveLength(2);
  });

  it("logs unreachable-daemon warning once until recovery succeeds", async () => {
    let nowMs = 0;
    let requestCount = 0;
    const errs: string[] = [];

    const recovery = createRemoteRecoveryController({
      ensureDaemon: async () => {},
      daemonRequest: async () => {
        requestCount++;
        if (requestCount <= 2) throw new Error("down");
        return { ok: true };
      },
      log: () => {},
      logErr: (text) => errs.push(text),
      minIntervalMs: 1,
      now: () => nowMs,
    });

    expect(await recovery.recover("unreachable", baseInput({ boundChat: null }))).toBe(false);
    nowMs += 10;
    expect(await recovery.recover("unreachable", baseInput({ boundChat: null }))).toBe(false);
    nowMs += 10;
    expect(await recovery.recover("unreachable", baseInput({ boundChat: null }))).toBe(true);
    nowMs += 10;
    // After a successful recovery, warning can be emitted again on a new failure.
    requestCount = 0;
    expect(await recovery.recover("unreachable", baseInput({ boundChat: null }))).toBe(false);

    const warning = "Daemon connection lost. Attempting recovery...";
    expect(errs.filter((e) => e === warning)).toHaveLength(2);
  });

  it("rejects concurrent recovery attempts while one is in flight", async () => {
    let resolveEnsure!: () => void;
    const ensureDaemon = new Promise<void>((resolve) => {
      resolveEnsure = () => resolve();
    });
    let ensureCalls = 0;

    const recovery = createRemoteRecoveryController({
      ensureDaemon: async () => {
        ensureCalls++;
        await ensureDaemon;
      },
      daemonRequest: async () => ({ ok: true }),
      log: () => {},
      logErr: () => {},
      minIntervalMs: 0,
      now: () => 0,
    });

    const first = recovery.recover("unknown", baseInput({ boundChat: null }));
    expect(recovery.isRecovering()).toBe(true);
    const second = await recovery.recover("unknown", baseInput({ boundChat: null }));
    expect(second).toBe(false);

    resolveEnsure();
    expect(await first).toBe(true);
    expect(ensureCalls).toBe(1);
    expect(recovery.isRecovering()).toBe(false);
  });
});
