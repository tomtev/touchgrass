import { describe, expect, it } from "bun:test";
import { formatSimpleToolResult, formatToolCall } from "../daemon/tool-display";

const fmt = {
  bold: (value: string) => `<b>${value}</b>`,
  italic: (value: string) => `<i>${value}</i>`,
  code: (value: string) => `<code>${value}</code>`,
  pre: (value: string) => `<pre>${value}</pre>`,
  link: (value: string) => value,
  escape: (value: string) => value,
  fromMarkdown: (value: string) => value,
};

describe("tool display formatting", () => {
  it("keeps simple edit notifications compact", () => {
    const rendered = formatToolCall(
      fmt,
      "Edit",
      { file_path: "README.md", old_string: "old", new_string: "new" },
      "simple"
    );

    expect(rendered).toContain("README.md");
    expect(rendered).not.toContain("<pre>");
  });

  it("includes edit previews in verbose mode", () => {
    const rendered = formatToolCall(
      fmt,
      "Edit",
      { file_path: "README.md", old_string: "old", new_string: "new" },
      "verbose"
    );

    expect(rendered).toContain("README.md");
    expect(rendered).toContain("<pre>");
  });

  it("shows unknown tool calls in simple mode as generic tool entries", () => {
    const rendered = formatToolCall(fmt, "UnknownTool", {}, "simple");
    expect(rendered).toContain("UnknownTool");
  });

  it("formats concise result summaries for web tools", () => {
    const rendered = formatSimpleToolResult(
      fmt,
      "WebFetch",
      "first line\nsecond line",
      false
    );

    expect(rendered).toContain("WebFetch result");
    expect(rendered).toContain("first line second line");
    expect(rendered).not.toContain("<pre>");
  });

  it("suppresses bash/exec tool calls in simple mode", () => {
    expect(formatToolCall(fmt, "Bash", { command: "echo hi" }, "simple")).toBeNull();
    expect(formatToolCall(fmt, "bash", { command: "echo hi" }, "simple")).toBeNull();
    expect(formatToolCall(fmt, "exec_command", { cmd: "echo hi" }, "simple")).toBeNull();
    expect(formatToolCall(fmt, "write_stdin", {}, "simple")).toBeNull();
  });

  it("suppresses bash/exec tool results in simple mode", () => {
    expect(formatSimpleToolResult(fmt, "Bash", "ok", false)).toBeNull();
    expect(formatSimpleToolResult(fmt, "bash", "ok", false)).toBeNull();
    expect(formatSimpleToolResult(fmt, "exec_command", "ok", false)).toBeNull();
  });

  it("supports lowercase web tool names in simple results", () => {
    const rendered = formatSimpleToolResult(fmt, "web_fetch", "https://www.vg.no", false);
    expect(rendered).toContain("web_fetch result");
    expect(rendered).toContain("https://www.vg.no");
  });

  it("skips non-main tool results in simple mode", () => {
    const rendered = formatSimpleToolResult(fmt, "Read", "file content", false);
    expect(rendered).toBeNull();
  });

  it("always shows tool errors in simple mode", () => {
    const rendered = formatSimpleToolResult(fmt, "Read", "permission denied", true);
    expect(rendered).toContain("error");
    expect(rendered).toContain("permission denied");
  });

  it("shows task create details in simple mode", () => {
    const rendered = formatToolCall(
      fmt,
      "TaskCreate",
      {
        taskId: "task_123",
        title: "Read remaining gray SCSS files",
        status: "running",
      },
      "simple"
    );

    expect(rendered).toContain("TaskCreate");
    expect(rendered).toContain("task_123");
    expect(rendered).toContain("Read remaining gray SCSS files");
    expect(rendered).toContain("running");
  });

  it("shows task update changed fields in simple mode", () => {
    const rendered = formatToolCall(
      fmt,
      "TaskUpdate",
      {
        task_id: "task_123",
        updates: {
          status: "completed",
          summary: "Done reading remaining files",
        },
      },
      "simple"
    );

    expect(rendered).toContain("TaskUpdate");
    expect(rendered).toContain("task_123");
    expect(rendered).toContain("status=completed");
    expect(rendered).toContain("summary=Done reading remaining files");
  });

  it("shows codex sub-agent tool call details in simple mode", () => {
    const spawn = formatToolCall(
      fmt,
      "spawn_agent",
      {
        agent_type: "default",
        message: "You are the HelpScout agent for touchgrass. Be ready to handle tasks.",
      },
      "simple"
    );
    const send = formatToolCall(
      fmt,
      "send_input",
      {
        id: "019c7568-cd07-7200-bb7c-8b1b6033b215",
        interrupt: true,
        message: "Check HelpScout tickets now.",
      },
      "simple"
    );
    const wait = formatToolCall(
      fmt,
      "wait",
      {
        ids: ["019c7568-cd07-7200-bb7c-8b1b6033b215"],
        timeout_ms: 120000,
      },
      "simple"
    );

    expect(spawn).toContain("spawn_agent");
    expect(spawn).toContain("default");
    expect(send).toContain("send_input");
    expect(send).toContain("interrupt");
    expect(wait).toContain("wait");
    expect(wait).toContain("120000ms");
  });

  it("formats Claude Task lifecycle results in simple mode", () => {
    const started = formatSimpleToolResult(
      fmt,
      "Task",
      "Async agent launched successfully.\nagentId: af65706 (internal ID)\nThe agent is working in the background.",
      false
    );
    const completed = formatSimpleToolResult(
      fmt,
      "Task",
      "I now have a complete picture.\nagentId: a4f7269\n<usage>total_tokens: 26709\ntool_uses: 11\nduration_ms: 50132</usage>",
      false
    );

    expect(started).toContain("sub-agent launched");
    expect(started).toContain("af65706");
    expect(completed).toContain("sub-agent completed");
    expect(completed).toContain("a4f7269");
    expect(completed).toContain("I now have a complete picture");
  });

  it("formats codex sub-agent tool results in simple mode", () => {
    const spawnResult = formatSimpleToolResult(
      fmt,
      "spawn_agent",
      "{\"agent_id\":\"019c7568-cd07-7200-bb7c-8b1b6033b215\"}",
      false
    );
    const sendResult = formatSimpleToolResult(
      fmt,
      "send_input",
      "{\"submission_id\":\"019c7569-376b-7cf1-a2f9-f7f5c8e535f3\"}",
      false
    );
    const waitResult = formatSimpleToolResult(
      fmt,
      "wait",
      "{\"status\":{\"019c7568-cd07-7200-bb7c-8b1b6033b215\":{\"completed\":\"blocked: dns issue\"}},\"timed_out\":false}",
      false
    );

    expect(spawnResult).toContain("spawn_agent result");
    expect(spawnResult).toContain("019c7568-cd07-7200-bb7c-8b1b6033b215");
    expect(sendResult).toContain("send_input result");
    expect(sendResult).toContain("019c7569-376b-7cf1-a2f9-f7f5c8e535f3");
    expect(waitResult).toContain("wait result");
    expect(waitResult).toContain("agent update");
    expect(waitResult).toContain("blocked: dns issue");
  });
});
