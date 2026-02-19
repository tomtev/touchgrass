import type { Formatter } from "../channel/formatter";
import { stripAnsi } from "../utils/ansi";

export type ToolDisplayMode = "simple" | "verbose";

const SIMPLE_TOOL_RESULT_NAMES = new Set([
  "WebSearch",
  "WebFetch",
  "web_search",
  "web_fetch",
]);

const SIMPLE_SUPPRESSED_TOOL_CALLS = new Set([
  "Bash",
  "bash",
  "exec_command",
  "write_stdin",
  "read_stdin",
]);

function relativePath(fp: string, cwd?: string): string {
  if (!cwd) return fp;
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return fp.startsWith(prefix) ? fp.slice(prefix.length) : fp;
}

function truncateText(value: string, max = 180): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function compactWhitespace(value: string): string {
  return value.replace(/\r/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
}

function summarizeToolOutput(content: string, max = 180): string {
  const clean = compactWhitespace(stripAnsi(content));
  return truncateText(clean, max);
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getFirstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function describeTaskChanges(input: Record<string, unknown>): string | undefined {
  const merged: Record<string, unknown> = {};

  const nestedChanges = [
    asRecord(input.updates),
    asRecord(input.update),
    asRecord(input.patch),
    asRecord(input.changes),
    asRecord(input.fields),
  ];
  for (const record of nestedChanges) {
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      merged[key] = value;
    }
  }

  // Some tools pass changed fields directly on root input.
  for (const key of ["title", "description", "status", "priority", "owner", "assignee", "dueDate", "due_date"]) {
    if (input[key] !== undefined) merged[key] = input[key];
  }

  const skip = new Set(["id", "taskId", "task_id", "name"]);
  const parts = Object.entries(merged)
    .filter(([key]) => !skip.has(key))
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .map(([key, value]) => `${key}=${String(value)}`)
    .slice(0, 4);

  if (parts.length === 0) return undefined;
  return truncateText(parts.join(", "), 140);
}

function formatTaskToolCall(
  fmt: Formatter,
  name: string,
  input: Record<string, unknown>,
  mode: ToolDisplayMode
): string {
  const taskId = getFirstString(input, ["taskId", "task_id", "id"]);
  const title = getFirstString(input, ["title", "name", "task", "taskTitle", "summary"]);
  const description = getFirstString(input, ["description", "details"]);
  const status = getFirstString(input, ["status", "state"]);
  const changeSummary = describeTaskChanges(input);

  const parts: string[] = [`${fmt.escape("🧩")} ${fmt.code(fmt.escape(name))}`];
  if (taskId) parts.push(`${fmt.escape("•")} ${fmt.code(fmt.escape(taskId))}`);
  if (status) parts.push(`${fmt.escape("•")} ${fmt.escape(status)}`);
  if (title) parts.push(`${fmt.escape("•")} ${fmt.escape(truncateText(title, mode === "simple" ? 90 : 140))}`);

  let line = parts.join(" ");
  if (name === "TaskUpdate" && changeSummary) {
    line += `\n${fmt.escape("↳")} ${fmt.code(fmt.escape(changeSummary))}`;
  } else if (name === "TaskCreate" && description && mode === "verbose") {
    line += `\n${fmt.italic(fmt.escape(truncateText(description, 200)))}`;
  }
  return line;
}

function labelForToolResult(toolName: string, isError: boolean): string {
  if (isError) return `${toolName || "Tool"} error`;
  if (toolName === "Bash" || toolName === "bash" || toolName === "exec_command") return "Output";
  return `${toolName || "Tool"} result`;
}

function formatTaskResultSimple(fmt: Formatter, content: string): string | null {
  const clean = compactWhitespace(stripAnsi(content));
  if (!clean) return null;
  const agentId = clean.match(/agentId:\s*([A-Za-z0-9-]+)/i)?.[1];

  if (/Async agent launched successfully/i.test(clean)) {
    const parts = [`${fmt.escape("↳")} ${fmt.bold(fmt.escape("Task result"))}`, fmt.escape("sub-agent launched")];
    if (agentId) parts.push(fmt.code(fmt.escape(agentId)));
    return parts.join(` ${fmt.escape("•")} `);
  }

  const hasUsageTail = /<usage>|total_tokens:|duration_ms:/i.test(clean);
  if (agentId && hasUsageTail) {
    const firstLine = content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !/^agentId:/i.test(line) && !/^<usage>/i.test(line) && !/^tool_uses:/i.test(line))
      || "sub-agent completed";
    return [
      `${fmt.escape("↳")} ${fmt.bold(fmt.escape("Task result"))} ${fmt.escape("•")} ${fmt.escape("sub-agent completed")} ${fmt.escape("•")} ${fmt.code(fmt.escape(agentId))}`,
      `${fmt.escape("↳")} ${fmt.code(fmt.escape(truncateText(compactWhitespace(stripAnsi(firstLine)), 160)))}`,
    ].join("\n");
  }

  return null;
}

function formatCodexSubagentResultSimple(
  fmt: Formatter,
  toolName: string,
  content: string
): string | null {
  const parsed = parseJsonObject(content);
  if (!parsed) return null;

  if (toolName === "spawn_agent") {
    const agentId = getFirstString(parsed, ["agent_id", "agentId", "id"]);
    if (!agentId) return null;
    return `${fmt.escape("↳")} ${fmt.bold(fmt.escape("spawn_agent result"))} ${fmt.escape("•")} ${fmt.code(fmt.escape(agentId))}`;
  }

  if (toolName === "send_input") {
    const submissionId = getFirstString(parsed, ["submission_id", "submissionId", "id"]);
    if (!submissionId) return null;
    return `${fmt.escape("↳")} ${fmt.bold(fmt.escape("send_input result"))} ${fmt.escape("•")} ${fmt.code(fmt.escape(submissionId))}`;
  }

  if (toolName === "wait") {
    const timedOut = parsed.timed_out === true;
    const status = asRecord(parsed.status);
    const statusEntries = status ? Object.entries(status) : [];
    if (timedOut) {
      return `${fmt.escape("↳")} ${fmt.bold(fmt.escape("wait result"))} ${fmt.escape("•")} ${fmt.escape("timed out")}`;
    }
    if (statusEntries.length > 0) {
      const [agentId, statusValue] = statusEntries[0];
      let detail = "";
      if (typeof statusValue === "string") detail = statusValue;
      else {
        const valueRecord = asRecord(statusValue);
        if (valueRecord) {
          detail = getFirstString(valueRecord, ["completed", "failed", "status", "message"]) || "";
        }
      }
      const updates = `${statusEntries.length} agent update${statusEntries.length === 1 ? "" : "s"}`;
      if (!detail) {
        return `${fmt.escape("↳")} ${fmt.bold(fmt.escape("wait result"))} ${fmt.escape("•")} ${fmt.escape(updates)}`;
      }
      return [
        `${fmt.escape("↳")} ${fmt.bold(fmt.escape("wait result"))} ${fmt.escape("•")} ${fmt.escape(updates)} ${fmt.escape("•")} ${fmt.code(fmt.escape(agentId))}`,
        `${fmt.escape("↳")} ${fmt.code(fmt.escape(truncateText(compactWhitespace(stripAnsi(detail)), 160)))}`,
      ].join("\n");
    }
    if (parsed.timed_out === false) {
      return `${fmt.escape("↳")} ${fmt.bold(fmt.escape("wait result"))} ${fmt.escape("•")} ${fmt.escape("no pending updates")}`;
    }
  }

  return null;
}

export function formatToolCall(
  fmt: Formatter,
  name: string,
  input: Record<string, unknown>,
  mode: ToolDisplayMode,
  cwd?: string
): string | null {
  if (mode === "simple" && SIMPLE_SUPPRESSED_TOOL_CALLS.has(name)) return null;

  switch (name) {
    case "Edit": {
      const fp = input.file_path as string | undefined;
      if (!fp) return null;
      let msg = `${fmt.escape("✏️")} ${fmt.code(fmt.escape(relativePath(fp, cwd)))}`;
      if (mode === "simple") return msg;
      const oldStr = input.old_string as string | undefined;
      const newStr = input.new_string as string | undefined;
      if (oldStr || newStr) {
        const diffLines: string[] = [];
        if (oldStr) {
          for (const line of oldStr.split("\n").slice(0, 5)) {
            diffLines.push(`- ${line}`);
          }
          if (oldStr.split("\n").length > 5) diffLines.push("- ...");
        }
        if (newStr) {
          for (const line of newStr.split("\n").slice(0, 5)) {
            diffLines.push(`+ ${line}`);
          }
          if (newStr.split("\n").length > 5) diffLines.push("+ ...");
        }
        if (diffLines.length > 0) {
          msg += `\n${fmt.pre(fmt.escape(diffLines.join("\n")))}`;
        }
      }
      return msg;
    }
    case "Write": {
      const fp = input.file_path as string | undefined;
      if (!fp) return null;
      let msg = `${fmt.escape("📄")} ${fmt.code(fmt.escape(relativePath(fp, cwd)))}`;
      if (mode === "simple") return msg;
      const content = input.content as string | undefined;
      if (content) {
        const lines = content.split("\n");
        const preview = lines.slice(0, 5).join("\n");
        const suffix = lines.length > 5 ? "\n..." : "";
        msg += `\n${fmt.pre(fmt.escape(preview + suffix))}`;
      }
      return msg;
    }
    case "Bash":
    case "bash": {
      const cmd = (input.command as string) || (input.cmd as string) || "";
      if (!cmd) return null;
      const truncated = truncateText(cmd, mode === "simple" ? 120 : 200);
      return `$ ${fmt.code(fmt.escape(truncated))}`;
    }
    case "exec_command": {
      let cmd = "";
      if (typeof input.cmd === "string") cmd = input.cmd;
      else if (typeof input.command === "string") cmd = input.command;
      if (!cmd) return null;
      const truncated = truncateText(cmd, mode === "simple" ? 120 : 200);
      return `$ ${fmt.code(fmt.escape(truncated))}`;
    }
    case "apply_patch": {
      const patch = input.content as string | undefined;
      if (!patch) return `${fmt.escape("✏️")} ${fmt.code("apply_patch")}`;
      const fileMatch = patch.match(/\*\*\* (?:Update|Add) File: (.+)/);
      const fp = fileMatch?.[1] || "file";
      const displayFp = relativePath(fp, cwd);
      if (mode === "simple") return `${fmt.escape("✏️")} ${fmt.code(fmt.escape(displayFp))}`;
      const preview = patch.split("\n").slice(0, 8).join("\n");
      const suffix = patch.split("\n").length > 8 ? "\n..." : "";
      return `${fmt.escape("✏️")} ${fmt.code(fmt.escape(displayFp))}\n${fmt.pre(fmt.escape(preview + suffix))}`;
    }
    case "write_stdin":
      if (mode === "simple") return null;
      return `${fmt.escape("⌨️")} ${fmt.code("write_stdin")}`;
    case "Read": {
      const fp = input.file_path as string | undefined;
      if (!fp) return null;
      return `${fmt.escape("📖")} ${fmt.code(fmt.escape(relativePath(fp, cwd)))}`;
    }
    case "Glob": {
      const pattern = input.pattern as string | undefined;
      if (!pattern) return null;
      const path = input.path as string | undefined;
      const inPart = path ? ` in ${fmt.code(fmt.escape(relativePath(path, cwd)))}` : "";
      return `${fmt.escape("🔍")} ${fmt.code(fmt.escape(pattern))}${inPart}`;
    }
    case "Grep": {
      const pattern = input.pattern as string | undefined;
      if (!pattern) return null;
      const glob = input.glob as string | undefined;
      const path = input.path as string | undefined;
      const parts: string[] = [`${fmt.escape("🔍")} ${fmt.code(fmt.escape(pattern))}`];
      if (glob) parts.push(`in ${fmt.code(fmt.escape(glob))}`);
      else if (path) parts.push(`in ${fmt.code(fmt.escape(relativePath(path, cwd)))}`);
      return parts.join(" ");
    }
    case "Task": {
      const desc = input.description as string | undefined;
      if (!desc) return null;
      const prompt = input.prompt as string | undefined;
      // Show first line of prompt only, truncated
      const firstPromptLine = prompt?.split("\n")[0];
      const promptLine = firstPromptLine
        ? `\n${fmt.escape("↳")} ${fmt.escape(truncateText(firstPromptLine, mode === "simple" ? 100 : 200))}`
        : "";
      if (mode === "simple") {
        return `${fmt.escape("🤖")} ${fmt.italic(fmt.escape(truncateText(desc, 140)))}${promptLine}`;
      }
      return `${fmt.escape("🤖")} ${fmt.italic(fmt.escape(desc))}${promptLine}`;
    }
    case "spawn_agent": {
      const agentType = getFirstString(input, ["agent_type", "type"]);
      const message = getFirstString(input, ["message", "prompt", "description"]);
      const parts = [`${fmt.escape("🤖")} ${fmt.code(fmt.escape("spawn_agent"))}`];
      if (agentType) parts.push(`${fmt.escape("•")} ${fmt.escape(agentType)}`);
      let line = parts.join(" ");
      if (message) {
        line += `\n${fmt.escape("↳")} ${fmt.italic(fmt.escape(truncateText(message, mode === "simple" ? 140 : 220)))}`;
      }
      return line;
    }
    case "send_input": {
      const receiver = getFirstString(input, ["id", "receiver", "agent_id"]);
      const message = getFirstString(input, ["message", "prompt", "input"]);
      const parts = [`${fmt.escape("📨")} ${fmt.code(fmt.escape("send_input"))}`];
      if (receiver) parts.push(`${fmt.escape("•")} ${fmt.code(fmt.escape(receiver))}`);
      if (input.interrupt === true) parts.push(`${fmt.escape("•")} ${fmt.escape("interrupt")}`);
      let line = parts.join(" ");
      if (message) {
        line += `\n${fmt.escape("↳")} ${fmt.escape(truncateText(message, mode === "simple" ? 140 : 220))}`;
      }
      return line;
    }
    case "wait": {
      const ids = Array.isArray(input.ids)
        ? input.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : [];
      const timeoutValue = input.timeout_ms ?? input.timeout;
      const timeoutLabel = typeof timeoutValue === "number"
        ? `${timeoutValue}ms`
        : (typeof timeoutValue === "string" && timeoutValue.trim() ? timeoutValue.trim() : undefined);
      const parts = [`${fmt.escape("⏳")} ${fmt.code(fmt.escape("wait"))}`];
      if (ids.length > 0) parts.push(`${fmt.escape("•")} ${fmt.escape(`${ids.length} agent${ids.length === 1 ? "" : "s"}`)}`);
      if (timeoutLabel) parts.push(`${fmt.escape("•")} ${fmt.code(fmt.escape(timeoutLabel))}`);
      return parts.join(" ");
    }
    case "TaskCreate":
    case "TaskUpdate":
      return formatTaskToolCall(fmt, name, input, mode);
    case "LSP": {
      const op = input.operation as string | undefined;
      const fp = input.filePath as string | undefined;
      if (!op || !fp) return null;
      return `${fmt.escape("🔗")} ${fmt.escape(op)} ${fmt.code(fmt.escape(relativePath(fp, cwd)))}`;
    }
    case "WebSearch":
    case "web_search": {
      const query = input.query as string | undefined;
      if (!query) return null;
      return `${fmt.escape("🌐")} ${fmt.code(fmt.escape(truncateText(query, mode === "simple" ? 100 : 180)))}`;
    }
    case "WebFetch":
    case "web_fetch": {
      const url = input.url as string | undefined;
      if (!url) return null;
      return `${fmt.escape("🌐")} ${fmt.code(fmt.escape(truncateText(url, mode === "simple" ? 100 : 180)))}`;
    }
    default:
      if (name.startsWith("Task")) {
        return formatTaskToolCall(fmt, name, input, mode);
      }
      if (mode === "simple") return `${fmt.escape("🔧")} ${fmt.code(fmt.escape(name))}`;
      return `${fmt.escape("🔧")} ${fmt.code(fmt.escape(name))}`;
  }
}

export function formatSimpleToolResult(
  fmt: Formatter,
  toolName: string,
  content: string,
  isError = false
): string | null {
  if (!isError) {
    if (toolName === "Task") {
      const taskSummary = formatTaskResultSimple(fmt, content);
      if (taskSummary) return taskSummary;
    }
    if (toolName === "spawn_agent" || toolName === "send_input" || toolName === "wait") {
      const codexSummary = formatCodexSubagentResultSimple(fmt, toolName, content);
      if (codexSummary) return codexSummary;
    }
  }
  if (!isError && !SIMPLE_TOOL_RESULT_NAMES.has(toolName)) return null;
  const summary = summarizeToolOutput(content, isError ? 220 : 180);
  const label = labelForToolResult(toolName, isError);
  if (!summary) {
    return `${fmt.escape(isError ? "❌" : "↳")} ${fmt.bold(fmt.escape(label))}`;
  }
  return `${fmt.escape(isError ? "❌" : "↳")} ${fmt.bold(fmt.escape(label))} ${fmt.escape("•")} ${fmt.code(fmt.escape(summary))}`;
}
