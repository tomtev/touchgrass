import { describe, expect, it } from "bun:test";
import { mergeRemoteControlAction, parseRemoteControlAction } from "../session/remote-control";

describe("parseRemoteControlAction", () => {
  it("accepts stop and kill", () => {
    expect(parseRemoteControlAction("stop")).toBe("stop");
    expect(parseRemoteControlAction("kill")).toBe("kill");
  });

  it("accepts resume action objects", () => {
    expect(
      parseRemoteControlAction({ type: "resume", sessionRef: "abc-123" })
    ).toEqual({ type: "resume", sessionRef: "abc-123" });
  });

  it("rejects invalid values", () => {
    expect(parseRemoteControlAction("STOP")).toBeNull();
    expect(parseRemoteControlAction("")).toBeNull();
    expect(parseRemoteControlAction({ type: "resume" })).toBeNull();
    expect(parseRemoteControlAction(undefined)).toBeNull();
  });
});

describe("mergeRemoteControlAction", () => {
  it("prefers kill over stop", () => {
    expect(mergeRemoteControlAction(null, "stop")).toBe("stop");
    expect(mergeRemoteControlAction("stop", "kill")).toBe("kill");
    expect(mergeRemoteControlAction("kill", "stop")).toBe("kill");
  });

  it("keeps resume requests over stop", () => {
    const resume = { type: "resume", sessionRef: "id-1" } as const;
    expect(mergeRemoteControlAction(null, resume)).toEqual(resume);
    expect(mergeRemoteControlAction(resume, "stop")).toEqual(resume);
  });

  it("keeps kill as the highest priority action", () => {
    const resume = { type: "resume", sessionRef: "id-2" } as const;
    expect(mergeRemoteControlAction("kill", resume)).toBe("kill");
    expect(mergeRemoteControlAction(resume, "kill")).toBe("kill");
  });
});
