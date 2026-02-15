import { describe, expect, it } from "bun:test";
import { __cliRunTestUtils } from "../cli/run";

describe("background job parser", () => {
  it("extracts running background jobs from Claude tool results", () => {
    __cliRunTestUtils.resetParserState();

    __cliRunTestUtils.parseJsonlMessage({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_123",
            name: "Bash",
            input: { command: "npm run dev", run_in_background: true },
          },
        ],
      },
    });

    const parsed = __cliRunTestUtils.parseJsonlMessage({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            is_error: false,
            content:
              "Command running in background with ID: bg_abc123. Output is being written to: /tmp/bg_abc123.output\nDetected URLs:\n- http://localhost:5173/",
          },
        ],
      },
      toolUseResult: { backgroundTaskId: "bg_abc123" },
    });

    expect(parsed.backgroundJobEvents).toEqual([
      {
        taskId: "bg_abc123",
        status: "running",
        command: "npm run dev",
        outputFile: "/tmp/bg_abc123.output",
        urls: ["http://localhost:5173/"],
      },
    ]);
  });

  it("extracts stop events from queue task notifications", () => {
    __cliRunTestUtils.resetParserState();

    const parsed = __cliRunTestUtils.parseJsonlMessage({
      type: "queue-operation",
      operation: "enqueue",
      content:
        "<task-notification>\n<task-id>bg_stop_me</task-id>\n<output-file>/tmp/bg_stop_me.output</output-file>\n<status>killed</status>\n<summary>Background command stopped</summary>\n</task-notification>",
    });

    expect(parsed.backgroundJobEvents).toEqual([
      {
        taskId: "bg_stop_me",
        status: "killed",
        outputFile: "/tmp/bg_stop_me.output",
        summary: "Background command stopped",
      },
    ]);
  });
});
