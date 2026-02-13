import { describe, expect, it } from "bun:test";
import { __heartbeatTestUtils } from "../cli/run";

describe("heartbeat tick resolution", () => {
  it("includes workflow context when a run is due", () => {
    const state = __heartbeatTestUtils.createRuntimeState();
    const raw = `<agent-heartbeat interval="15">
Shared context
<run workflow="email-check" always="true" />
</agent-heartbeat>`;

    const tick = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:00:00"),
      15,
      state,
      (workflowPath) => workflowPath.includes("email-check.md") ? "Review unread mail and summarize." : null
    );

    expect(tick.plainText).toBeNull();
    expect(tick.workflows).toHaveLength(1);
    expect(tick.workflows[0].workflow).toBe("email-check");
    expect(tick.workflows[0].context).toBe(
      "Shared context\n\nReview unread mail and summarize."
    );
  });

  it("skips tick when heartbeat has runs but none are due", () => {
    const state = __heartbeatTestUtils.createRuntimeState();
    const raw = `<agent-heartbeat interval="15">
<run workflow="email-check" every="30m" />
</agent-heartbeat>`;

    const first = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:00:00"),
      15,
      state,
      () => "Run email check."
    );
    expect(first.workflows).toHaveLength(1);

    const second = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:10:00"),
      15,
      state,
      () => "Run email check."
    );
    expect(second.workflows).toHaveLength(0);
    expect(second.plainText).toBeNull();
  });

  it("skips tick for empty heartbeat block", () => {
    const state = __heartbeatTestUtils.createRuntimeState();
    const raw = `<agent-heartbeat interval="15">
</agent-heartbeat>`;

    const tick = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:00:00"),
      15,
      state,
      () => null
    );

    expect(tick.workflows).toHaveLength(0);
    expect(tick.plainText).toBeNull();
  });

  it("skips tick for comment-only heartbeat file", () => {
    const state = __heartbeatTestUtils.createRuntimeState();
    const raw = `/*
comment only
*/`;

    const tick = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:00:00"),
      15,
      state,
      () => null
    );

    expect(tick.workflows).toHaveLength(0);
    expect(tick.plainText).toBeNull();
  });

  it("uses plain text when heartbeat contains text and no runs", () => {
    const state = __heartbeatTestUtils.createRuntimeState();
    const raw = `<agent-heartbeat interval="15">
Do a quick status sweep.
</agent-heartbeat>`;

    const tick = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:00:00"),
      15,
      state,
      () => null
    );

    expect(tick.workflows).toHaveLength(0);
    expect(tick.plainText).toBe("Do a quick status sweep.");
  });

  it("ignores AGENTS.md content outside <agent-heartbeat>", () => {
    const state = __heartbeatTestUtils.createRuntimeState();
    const raw = `<agent-owner>
Owner name: "Tommy"
</agent-owner>

<agent-context version="1.0">
General instructions.
</agent-context>

<agent-heartbeat interval="15">
<run workflow="session-checkin" always="true" />
</agent-heartbeat>`;

    const tick = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:00:00"),
      15,
      state,
      () => "Ping all active sessions."
    );

    expect(tick.workflows).toHaveLength(1);
    expect(tick.workflows[0]?.workflow).toBe("session-checkin");
  });
});
