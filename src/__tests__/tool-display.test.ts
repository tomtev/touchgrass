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
});
