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

  it("extracts stop events from TaskStop tool results", () => {
    __cliRunTestUtils.resetParserState();

    __cliRunTestUtils.parseJsonlMessage({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_stop1",
            name: "TaskStop",
            input: { task_id: "bg_live_1" },
          },
        ],
      },
    });

    const parsed = __cliRunTestUtils.parseJsonlMessage({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_stop1",
            content:
              "{\"message\":\"Successfully stopped task: bg_live_1 (node server.js --port 9001)\",\"task_id\":\"bg_live_1\",\"command\":\"node server.js --port 9001\"}",
          },
        ],
      },
      toolUseResult: {
        task_id: "bg_live_1",
        message: "Successfully stopped task: bg_live_1 (node server.js --port 9001)",
        command: "node server.js --port 9001",
      },
    });

    expect(parsed.backgroundJobEvents).toEqual([
      {
        taskId: "bg_live_1",
        status: "killed",
        command: "node server.js --port 9001",
        urls: ["http://localhost:9001"],
      },
    ]);
  });

  it("infers a localhost URL from the background command when tool output has no URL", () => {
    __cliRunTestUtils.resetParserState();

    __cliRunTestUtils.parseJsonlMessage({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_bg1",
            name: "Bash",
            input: { command: "node server.js --port 8788", run_in_background: true },
          },
        ],
      },
    });

    const parsed = __cliRunTestUtils.parseJsonlMessage({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            tool_use_id: "toolu_bg1",
            type: "tool_result",
            content: "Command running in background with ID: bg_8788. Output is being written to: /tmp/bg_8788.output",
            is_error: false,
          },
        ],
      },
      toolUseResult: { backgroundTaskId: "bg_8788" },
    });

    expect(parsed.backgroundJobEvents).toEqual([
      {
        taskId: "bg_8788",
        status: "running",
        command: "node server.js --port 8788",
        outputFile: "/tmp/bg_8788.output",
        urls: ["http://localhost:8788"],
      },
    ]);
  });

  it("strips trailing quotes from detected URLs", () => {
    __cliRunTestUtils.resetParserState();

    __cliRunTestUtils.parseJsonlMessage({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_q1",
            name: "Bash",
            input: { command: "node server.js --port 8789", run_in_background: true },
          },
        ],
      },
    });

    const parsed = __cliRunTestUtils.parseJsonlMessage({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            tool_use_id: "toolu_q1",
            type: "tool_result",
            content:
              "Command running in background with ID: bg_8789. Output is being written to: /tmp/bg_8789.output\nURL: http://localhost:8789'",
            is_error: false,
          },
        ],
      },
      toolUseResult: { backgroundTaskId: "bg_8789" },
    });

    expect(parsed.backgroundJobEvents).toEqual([
      {
        taskId: "bg_8789",
        status: "running",
        command: "node server.js --port 8789",
        outputFile: "/tmp/bg_8789.output",
        urls: ["http://localhost:8789"],
      },
    ]);
  });

  it("extracts running Codex background terminal events", () => {
    __cliRunTestUtils.resetParserState();

    __cliRunTestUtils.parseJsonlMessage({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call_codex_bg",
        arguments: JSON.stringify({
          cmd: "node server.js --port 8900",
          yield_time_ms: 1000,
        }),
      },
    });

    const parsed = __cliRunTestUtils.parseJsonlMessage({
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_codex_bg",
        output:
          "Chunk ID: x\nWall time: 1.0\nProcess running with session ID 80802\nOriginal token count: 0\nOutput:\n",
      },
    });

    expect(parsed.backgroundJobEvents).toEqual([
      {
        taskId: "80802",
        status: "running",
        command: "node server.js --port 8900",
        urls: ["http://localhost:8900"],
      },
    ]);
  });

  it("extracts completed Codex background terminal events from write_stdin", () => {
    __cliRunTestUtils.resetParserState();

    __cliRunTestUtils.parseJsonlMessage({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call_codex_bg2",
        arguments: JSON.stringify({
          cmd: "docker stop flatsome-platform-app-run",
          yield_time_ms: 10000,
        }),
      },
    });
    __cliRunTestUtils.parseJsonlMessage({
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_codex_bg2",
        output:
          "Chunk ID: x\nWall time: 10.0\nProcess running with session ID 1398\nOriginal token count: 0\nOutput:\n",
      },
    });
    __cliRunTestUtils.parseJsonlMessage({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "write_stdin",
        call_id: "call_codex_bg3",
        arguments: JSON.stringify({
          session_id: 1398,
          chars: "",
          yield_time_ms: 1000,
        }),
      },
    });

    const parsed = __cliRunTestUtils.parseJsonlMessage({
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_codex_bg3",
        output:
          "Chunk ID: y\nWall time: 0.05\nProcess exited with code 0\nOriginal token count: 10\nOutput:\nflatsome-platform-app-run\n",
      },
    });

    expect(parsed.backgroundJobEvents).toEqual([
      {
        taskId: "1398",
        status: "completed",
        command: "docker stop flatsome-platform-app-run",
      },
    ]);
  });
});
