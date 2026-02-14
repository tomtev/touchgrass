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

  it("supports second-based interval and every durations", () => {
    const parsed = __heartbeatTestUtils.parseHeartbeatConfig(
      `<agent-heartbeat interval="10s">
<run workflow="quick-check" every="20s" />
</agent-heartbeat>`
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.intervalMinutes).toBeCloseTo(10 / 60, 6);
    expect(parsed?.runs[0]?.everyMinutes).toBeCloseTo(20 / 60, 6);

    const state = __heartbeatTestUtils.createRuntimeState();
    const first = __heartbeatTestUtils.resolveHeartbeatTick(
      `<agent-heartbeat interval="10s">
<run workflow="quick-check" every="20s" />
</agent-heartbeat>`,
      new Date("2026-02-13T10:00:00"),
      10 / 60,
      state,
      () => "Run quick check."
    );
    expect(first.workflows).toHaveLength(1);

    const second = __heartbeatTestUtils.resolveHeartbeatTick(
      `<agent-heartbeat interval="10s">
<run workflow="quick-check" every="20s" />
</agent-heartbeat>`,
      new Date("2026-02-13T10:00:10"),
      10 / 60,
      state,
      () => "Run quick check."
    );
    expect(second.workflows).toHaveLength(0);

    const third = __heartbeatTestUtils.resolveHeartbeatTick(
      `<agent-heartbeat interval="10s">
<run workflow="quick-check" every="20s" />
</agent-heartbeat>`,
      new Date("2026-02-13T10:00:20"),
      10 / 60,
      state,
      () => "Run quick check."
    );
    expect(third.workflows).toHaveLength(1);
  });

  it("defaults <run> to always when no schedule attrs are provided", () => {
    const parsed = __heartbeatTestUtils.parseHeartbeatConfig(
      `<agent-heartbeat interval="15">
<run workflow="default-always" />
</agent-heartbeat>`
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.runs).toHaveLength(1);
    expect(parsed?.runs[0]?.always).toBe(true);

    const state = __heartbeatTestUtils.createRuntimeState();
    const first = __heartbeatTestUtils.resolveHeartbeatTick(
      `<agent-heartbeat interval="15">
<run workflow="default-always" />
</agent-heartbeat>`,
      new Date("2026-02-13T10:00:00"),
      15,
      state,
      () => "Always run."
    );
    expect(first.workflows).toHaveLength(1);

    const second = __heartbeatTestUtils.resolveHeartbeatTick(
      `<agent-heartbeat interval="15">
<run workflow="default-always" />
</agent-heartbeat>`,
      new Date("2026-02-13T10:10:00"),
      15,
      state,
      () => "Always run."
    );
    expect(second.workflows).toHaveLength(1);
  });

  it("runs <run at=\"HH:MM\" on=\"weekdays\"> only on matching day/time and once per day", () => {
    const state = __heartbeatTestUtils.createRuntimeState();
    const raw = `<agent-heartbeat interval="15">
<run workflow="weekday-check" at="10:00" on="weekdays" />
</agent-heartbeat>`;

    // Friday at 10:05 within 15m tick window => due.
    const friday = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:05:00"),
      15,
      state,
      () => "Weekday workflow."
    );
    expect(friday.workflows).toHaveLength(1);
    expect(friday.workflows[0]?.workflow).toBe("weekday-check");

    // Same day, still inside window, but should not run twice.
    const fridayAgain = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:10:00"),
      15,
      state,
      () => "Weekday workflow."
    );
    expect(fridayAgain.workflows).toHaveLength(0);

    // Saturday should be blocked by on="weekdays".
    const saturday = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-14T10:05:00"),
      15,
      state,
      () => "Weekday workflow."
    );
    expect(saturday.workflows).toHaveLength(0);
  });

  it("includes only due workflows when multiple <run> entries are present", () => {
    const state = __heartbeatTestUtils.createRuntimeState();
    const raw = `<agent-heartbeat interval="10s">
Shared preface
<run workflow="alpha" every="10s" />
<run workflow="beta" at="23:59" />
<run workflow="gamma" on="weekends" at="10:00" />
</agent-heartbeat>`;

    const tick = __heartbeatTestUtils.resolveHeartbeatTick(
      raw,
      new Date("2026-02-13T10:00:00"), // Friday
      10 / 60,
      state,
      (workflowPath) => {
        if (workflowPath.includes("alpha.md")) return "Alpha body";
        if (workflowPath.includes("beta.md")) return "Beta body";
        if (workflowPath.includes("gamma.md")) return "Gamma body";
        return null;
      }
    );

    expect(tick.workflows).toHaveLength(1);
    expect(tick.workflows[0]?.workflow).toBe("alpha");
    expect(tick.workflows[0]?.context).toBe("Shared preface\n\nAlpha body");
    expect(tick.workflows.some((w) => w.workflow === "beta")).toBe(false);
    expect(tick.workflows.some((w) => w.workflow === "gamma")).toBe(false);
  });
});
