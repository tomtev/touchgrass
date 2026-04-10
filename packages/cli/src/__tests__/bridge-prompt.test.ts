import { describe, expect, it } from "bun:test";
import { __cliRunTestUtils } from "../cli/run";

describe("bridge prompt injection", () => {
  it("detects gemini initial prompt", () => {
    const shouldInject = __cliRunTestUtils.shouldInjectBridgePrompt("gemini", "> ", "some previous output > ");
    expect(shouldInject).toBe(true);
  });

  it("detects pi initial prompt", () => {
    const shouldInject = __cliRunTestUtils.shouldInjectBridgePrompt("pi", "? ", "What is the plan? ");
    expect(shouldInject).toBe(true);
  });

  it("detects fallback prompt (e.g. for unknown tools)", () => {
    // Falls back to ["> ", "? "]
    const shouldInject = __cliRunTestUtils.shouldInjectBridgePrompt("unknown", "> ", "> ");
    expect(shouldInject).toBe(true);
  });

  it("does not detect prompt when it's not present", () => {
    const shouldInject = __cliRunTestUtils.shouldInjectBridgePrompt("gemini", "Calculating...", "Calculating...");
    expect(shouldInject).toBe(false);
  });

  it("detects prompt when it's part of a larger buffer", () => {
    const shouldInject = __cliRunTestUtils.shouldInjectBridgePrompt("kimi", "Done! ? ", "previous output. Done! ? ");
    expect(shouldInject).toBe(true);
  });

  it("returns the correct bridge prompt text", () => {
    const text = __cliRunTestUtils.getBridgePromptText();
    expect(text).toContain("terminal bridge");
    expect(text).toContain("proxied from a chat interface");
    expect(text).toContain("touchgrass");
  });
});
