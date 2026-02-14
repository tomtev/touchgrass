import { describe, expect, it } from "bun:test";
import { mergeRemoteControlAction, parseRemoteControlAction } from "../session/remote-control";

describe("parseRemoteControlAction", () => {
  it("accepts stop and kill", () => {
    expect(parseRemoteControlAction("stop")).toBe("stop");
    expect(parseRemoteControlAction("kill")).toBe("kill");
  });

  it("rejects invalid values", () => {
    expect(parseRemoteControlAction("STOP")).toBeNull();
    expect(parseRemoteControlAction("")).toBeNull();
    expect(parseRemoteControlAction(undefined)).toBeNull();
  });
});

describe("mergeRemoteControlAction", () => {
  it("prefers kill over stop", () => {
    expect(mergeRemoteControlAction(null, "stop")).toBe("stop");
    expect(mergeRemoteControlAction("stop", "kill")).toBe("kill");
    expect(mergeRemoteControlAction("kill", "stop")).toBe("kill");
  });
});

