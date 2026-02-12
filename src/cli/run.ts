import { loadConfig } from "../config/store";
import { getTelegramBotToken, getAllPairedUsers } from "../config/schema";
import { TelegramChannel } from "../channels/telegram/channel";
import { TelegramApi } from "../channels/telegram/api";
import type { Channel, ChannelChatId } from "../channel/types";
import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { escapeHtml, markdownToHtml, stripAnsiReadable } from "../utils/ansi";
import { paths, ensureDirs } from "../config/paths";
import { watch, readdirSync, statSync, readFileSync, type FSWatcher } from "fs";
import { chmod, open, writeFile, unlink } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

// Per-CLI patterns for detecting approval prompts in terminal output.
// Both `promptText` and `optionText` must be present in the PTY buffer to trigger a notification.
// Add entries here when adding support for new CLIs.
// Tools that can actually require user approval in Claude Code.
// Only these tools update `lastToolCall` for approval prompt attribution.
const APPROVABLE_TOOLS = new Set(["Bash", "Edit", "Write", "NotebookEdit"]);

const APPROVAL_PATTERNS: Record<string, { promptText: string; optionText: string }> = {
  claude: { promptText: "Do you want to", optionText: "1. Yes" },
  codex: { promptText: "Would you like to run the following command", optionText: "1. Yes, proceed" },
  // pi: { promptText: "...", optionText: "..." },
};

// Arrow-key picker for terminal selection
function terminalPicker(title: string, options: string[], hint?: string, disabled?: Set<number>): Promise<number> {
  return new Promise((resolve) => {
    const dis = disabled || new Set<number>();
    // Start cursor on first non-disabled option
    let cursor = 0;
    while (dis.has(cursor) && cursor < options.length) cursor++;
    if (cursor >= options.length) cursor = 0;

    const HIDE_CURSOR = "\x1b[?25l";
    const SHOW_CURSOR = "\x1b[?25h";
    const DIM = "\x1b[2m";
    const STRIKETHROUGH = "\x1b[9m";
    const RESET = "\x1b[0m";
    const CYAN = "\x1b[36m";
    const BOLD = "\x1b[1m";
    let totalRows = 0;

    function visRows(text: string): number {
      const cols = process.stdout.columns || 80;
      return Math.max(1, Math.ceil(text.length / cols));
    }

    function render() {
      process.stdout.write(`\x1b[${totalRows}A\x1b[J`);
      draw();
    }

    function draw() {
      totalRows = 0;
      process.stdout.write(`  ${BOLD}${title}${RESET}\n`);
      totalRows += visRows(`  ${title}`);
      for (let i = 0; i < options.length; i++) {
        if (dis.has(i)) {
          process.stdout.write(`  ${DIM}${STRIKETHROUGH}  ${options[i]}${RESET}\n`);
        } else if (i === cursor) {
          process.stdout.write(`  ${CYAN}❯ ${options[i]}${RESET}\n`);
        } else {
          process.stdout.write(`  ${DIM}  ${options[i]}${RESET}\n`);
        }
        totalRows += visRows(`    ${options[i]}`);
      }
      if (hint) {
        process.stdout.write(`\n  ${DIM}${hint}${RESET}\n`);
        totalRows += 1 + visRows(`  ${hint}`);
      }
    }

    function moveUp() {
      for (let i = 0; i < options.length; i++) {
        cursor = (cursor - 1 + options.length) % options.length;
        if (!dis.has(cursor)) return;
      }
    }

    function moveDown() {
      for (let i = 0; i < options.length; i++) {
        cursor = (cursor + 1) % options.length;
        if (!dis.has(cursor)) return;
      }
    }

    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdout.write(HIDE_CURSOR + "\n");
    draw();

    function onData(data: Buffer) {
      const key = data.toString();
      if (key === "\x1b[A" || key === "k") {
        moveUp();
        render();
      } else if (key === "\x1b[B" || key === "j") {
        moveDown();
        render();
      } else if (key === "\r" || key === "\n") {
        if (!dis.has(cursor)) {
          cleanup();
          resolve(cursor);
        }
      } else if (key === "\x03") {
        cleanup();
        process.stdout.write("\n");
        process.exit(130);
      } else if (key === "\x1b") {
        cleanup();
        resolve(-1);
      }
    }

    function cleanup() {
      process.stdin.removeListener("data", onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false);
      process.stdout.write(SHOW_CURSOR);
    }

    process.stdin.on("data", onData);
  });
}

interface SessionManifest {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  jsonlFile: string | null;
  startedAt: string;
}

async function writeManifest(manifest: SessionManifest): Promise<void> {
  await ensureDirs();
  const file = join(paths.sessionsDir, `${manifest.id}.json`);
  await writeFile(file, JSON.stringify(manifest, null, 2), { encoding: "utf-8", mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
}

async function removeManifest(id: string): Promise<void> {
  try {
    await unlink(join(paths.sessionsDir, `${id}.json`));
  } catch {}
}

const SUPPORTED_COMMANDS: Record<string, string[]> = {
  claude: ["claude"],
  codex: ["codex"],
  pi: ["pi"],
};

// Get session JSONL directory for the given command
function getSessionDir(command: string): string {
  const cwd = process.cwd();
  if (command === "codex") {
    // Codex: ~/.codex/sessions/YYYY/MM/DD/
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return join(homedir(), ".codex", "sessions", String(y), m, d);
  }
  if (command === "pi") {
    // PI: ~/.pi/agent/sessions/--<encoded-cwd>--/
    const encoded = "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
    return join(homedir(), ".pi", "agent", "sessions", encoded);
  }
  // Claude: ~/.claude/projects/<encoded-cwd>/
  const encoded = cwd.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

// Extract assistant text from a JSONL line across different formats:
// - Claude: {"type":"assistant", "message":{"content":[{"type":"text","text":"..."}]}}
// - PI:     {"type":"message", "message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
// - Codex:  {"type":"event_msg", "payload":{"type":"agent_message","message":"..."}}
//   or      {"type":"response_item", "payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}]}}
function extractAssistantText(msg: Record<string, unknown>): string | null {
  // Claude format
  if (msg.type === "assistant") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (!m?.content) return null;
    const texts = (m.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "");
    const text = texts.join("\n").trim();
    return text || null;
  }

  // PI format
  if (msg.type === "message") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (m?.role !== "assistant" || !m?.content) return null;
    const texts = (m.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "");
    const text = texts.join("\n").trim();
    return text || null;
  }

  // Codex event_msg format (primary — this is what Codex uses for display)
  if (msg.type === "event_msg") {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (payload?.type === "agent_message" && typeof payload.message === "string") {
      const text = (payload.message as string).trim();
      return text || null;
    }
    return null;
  }

  return null;
}

// Extract thinking text from JSONL messages
// - Claude: content block {"type":"thinking","thinking":"..."}
// - PI: same format inside {"type":"message","message":{"role":"assistant",...}}
// - Codex: {"type":"event_msg","payload":{"type":"agent_reasoning","text":"..."}}
//   or {"type":"response_item","payload":{"type":"reasoning","summary":[{"text":"..."}]}}
function extractThinking(msg: Record<string, unknown>): string | null {
  // Claude & PI: assistant message with thinking content blocks
  if (msg.type === "assistant" || msg.type === "message") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (!m?.content || !Array.isArray(m.content)) return null;
    if (msg.type === "message" && m.role !== "assistant") return null;
    const content = m.content as Array<{ type: string; thinking?: string }>;
    const texts = content
      .filter((b) => b.type === "thinking")
      .map((b) => b.thinking ?? "");
    const text = texts.join("\n").trim();
    return text || null;
  }

  // Codex: event_msg with agent_reasoning
  if (msg.type === "event_msg") {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (payload?.type === "agent_reasoning" && typeof payload.text === "string") {
      return (payload.text as string).trim() || null;
    }
    return null;
  }

  return null;
}

// Extract AskUserQuestion tool_use from a JSONL message (Claude format)
function extractAskUserQuestion(msg: Record<string, unknown>): unknown[] | null {
  if (msg.type !== "assistant") return null;
  const m = msg.message as Record<string, unknown> | undefined;
  if (!m?.content) return null;
  const content = m.content as Array<Record<string, unknown>>;
  for (const block of content) {
    if (block.type === "tool_use" && block.name === "AskUserQuestion") {
      const input = block.input as Record<string, unknown> | undefined;
      if (input?.questions && Array.isArray(input.questions)) {
        return input.questions as unknown[];
      }
    }
  }
  return null;
}

// Extract tool calls from JSONL messages across all formats
// - Claude: content block {"type":"tool_use","name":"...","input":{...},"id":"..."}
// - PI: content block {"type":"toolCall","name":"...","arguments":{...},"id":"..."}
// - Codex: {"type":"response_item","payload":{"type":"function_call","name":"...","arguments":"JSON string","call_id":"..."}}
//   or {"type":"response_item","payload":{"type":"custom_tool_call","name":"...","input":"..."}}
interface ToolCallInfo {
  id: string; // tool_use_id for matching with results
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultInfo {
  toolName: string;
  content: string;
}

// Map tool_use_id/call_id → tool name so we can label tool_results
const toolUseIdToName = new Map<string, string>();

function extractToolCalls(msg: Record<string, unknown>): ToolCallInfo[] {
  // Claude format: top-level type "assistant"
  if (msg.type === "assistant") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (!m?.content || !Array.isArray(m.content)) return [];
    const content = m.content as Array<Record<string, unknown>>;
    const calls: ToolCallInfo[] = [];
    for (const block of content) {
      if (block.type === "tool_use" && typeof block.name === "string") {
        const toolId = (block.id as string) || "";
        if (toolId) toolUseIdToName.set(toolId, block.name);
        if (block.name === "AskUserQuestion") continue; // handled by polls
        calls.push({
          id: toolId,
          name: block.name,
          input: (block.input as Record<string, unknown>) || {},
        });
      }
    }
    capIdMap();
    return calls;
  }

  // PI format: top-level type "message", role "assistant", content block type "toolCall"
  if (msg.type === "message") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (m?.role !== "assistant" || !m?.content || !Array.isArray(m.content)) return [];
    const content = m.content as Array<Record<string, unknown>>;
    const calls: ToolCallInfo[] = [];
    for (const block of content) {
      if (block.type === "toolCall" && typeof block.name === "string") {
        const toolId = (block.id as string) || "";
        if (toolId) toolUseIdToName.set(toolId, block.name);
        calls.push({
          id: toolId,
          name: block.name,
          input: (block.arguments as Record<string, unknown>) || {},
        });
      }
    }
    capIdMap();
    return calls;
  }

  // Codex format: response_item with function_call or custom_tool_call payload
  if (msg.type === "response_item") {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (!payload) return [];

    if (payload.type === "function_call" && typeof payload.name === "string") {
      const callId = (payload.call_id as string) || "";
      if (callId) toolUseIdToName.set(callId, payload.name);
      let input: Record<string, unknown> = {};
      if (typeof payload.arguments === "string") {
        try { input = JSON.parse(payload.arguments); } catch {}
      }
      capIdMap();
      return [{ id: callId, name: payload.name, input }];
    }

    if (payload.type === "custom_tool_call" && typeof payload.name === "string") {
      const callId = (payload.call_id as string) || "";
      if (callId) toolUseIdToName.set(callId, payload.name);
      // custom_tool_call has "input" as a string (e.g. patch content)
      const input: Record<string, unknown> = typeof payload.input === "string"
        ? { content: payload.input }
        : {};
      capIdMap();
      return [{ id: callId, name: payload.name, input }];
    }
  }

  return [];
}

function capIdMap() {
  if (toolUseIdToName.size > 200) {
    const first = toolUseIdToName.keys().next().value!;
    toolUseIdToName.delete(first);
  }
}

// Only forward results for tools where the output is useful to see on Telegram
const FORWARD_RESULT_TOOLS = new Set([
  "WebFetch", "WebSearch", "Bash",   // Claude
  "bash",                             // PI
  "exec_command",                     // Codex
]);

function extractToolResults(msg: Record<string, unknown>): ToolResultInfo[] {
  // Claude format: top-level "user" with tool_result content blocks
  if (msg.type === "user") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (!m?.content || !Array.isArray(m.content)) return [];
    const content = m.content as Array<Record<string, unknown>>;
    const results: ToolResultInfo[] = [];
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const toolName = toolUseIdToName.get(block.tool_use_id as string) ?? "";
      if (!FORWARD_RESULT_TOOLS.has(toolName)) continue;
      let text = "";
      const c = block.content;
      if (typeof c === "string") {
        text = c;
      } else if (Array.isArray(c)) {
        text = (c as Array<{ type: string; text?: string }>)
          .filter((s) => s.type === "text")
          .map((s) => s.text ?? "")
          .join("\n");
      }
      if (text.trim()) results.push({ toolName, content: text.trim() });
    }
    return results;
  }

  // PI format: top-level "message" with role "toolResult"
  if (msg.type === "message") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (m?.role !== "toolResult") return [];
    const toolName = (m.toolName as string) || toolUseIdToName.get(m.toolCallId as string) || "";
    if (!FORWARD_RESULT_TOOLS.has(toolName)) return [];
    const content = m.content as Array<{ type: string; text?: string }> | undefined;
    if (!content || !Array.isArray(content)) return [];
    const text = content
      .filter((s) => s.type === "text")
      .map((s) => s.text ?? "")
      .join("\n")
      .trim();
    return text ? [{ toolName, content: text }] : [];
  }

  // Codex format: response_item with function_call_output or custom_tool_call_output
  if (msg.type === "response_item") {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (!payload) return [];
    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const callId = payload.call_id as string;
      const toolName = toolUseIdToName.get(callId) ?? "";
      if (!FORWARD_RESULT_TOOLS.has(toolName)) return [];
      const output = (payload.output as string) ?? "";
      return output.trim() ? [{ toolName, content: output.trim() }] : [];
    }
  }

  return [];
}

// Detect absolute file paths in assistant text that exist on disk and are within the project directory
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50 MB (Telegram limit)
const SENSITIVE_FILES = new Set([
  ".env", ".env.local", ".env.production", ".env.development", ".env.staging", ".env.test",
  ".npmrc", ".pypirc", ".netrc", ".pgpass", ".my.cnf",
  "credentials.json", "service-account.json", "keyfile.json",
  "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
]);
const SENSITIVE_EXTENSIONS = new Set([
  ".pem", ".key", ".p12", ".pfx", ".jks", ".keystore",
]);

function isSensitiveFile(filePath: string): boolean {
  const name = filePath.split("/").pop() || "";
  if (SENSITIVE_FILES.has(name)) return true;
  if (name.startsWith(".env")) return true;
  for (const ext of SENSITIVE_EXTENSIONS) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

function extractFilePaths(text: string, cwd: string): string[] {
  // Match absolute file paths with extensions — allow backticks, parens, etc. before the path
  const regex = /(?:^|[\s`"'(])(\/[^\s<>"'`)\]]+\.[a-zA-Z0-9]+)/gm;
  const paths: string[] = [];
  const seen = new Set<string>();
  let match;
  while ((match = regex.exec(text)) !== null) {
    const p = match[1];
    if (seen.has(p)) continue;
    seen.add(p);
    // Must be under project directory
    if (!p.startsWith(cwd + "/")) continue;
    // Never send sensitive files
    if (isSensitiveFile(p)) continue;
    try {
      const s = statSync(p);
      if (s.isFile() && s.size > 0 && s.size < MAX_ATTACHMENT_SIZE) {
        paths.push(p);
      }
    } catch {}
  }
  return paths;
}

// Write poll keypresses to the terminal to simulate user selection
async function writePollKeypresses(
  term: { write(data: Buffer): void },
  optionIds: number[],
  multiSelect: boolean
): Promise<void> {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const DOWN = Buffer.from("\x1b[B");
  const SPACE = Buffer.from(" ");
  const ENTER = Buffer.from("\r");

  if (!multiSelect) {
    // Single select: move down to the selected option, then Enter
    const idx = optionIds[0] ?? 0;
    for (let i = 0; i < idx; i++) {
      term.write(DOWN);
      await delay(50);
    }
    term.write(ENTER);
  } else {
    // Multi-select: navigate to each option and press Enter to toggle
    // (Claude Code's AskUserQuestion UI uses Enter to select, not Space)
    // Do NOT press Enter at the end — POLL_SUBMIT handles Tab+Enter for submission
    const sorted = [...optionIds].sort((a, b) => a - b);
    let currentPos = 0;
    for (const idx of sorted) {
      const moves = idx - currentPos;
      for (let i = 0; i < moves; i++) {
        term.write(DOWN);
        await delay(50);
      }
      term.write(ENTER);
      await delay(100);
      currentPos = idx;
    }
  }
}

// Watch a JSONL file for new assistant messages using incremental reads.
// Uses fs.watch + periodic polling fallback for reliability on macOS.
function watchSessionFile(
  filePath: string,
  onAssistant: (text: string) => void,
  onQuestion?: (questions: unknown[]) => void,
  onToolCall?: (calls: ToolCallInfo[]) => void,
  onThinking?: (text: string) => void,
  onToolResult?: (results: ToolResultInfo[]) => void,
  startFromEnd?: boolean,
): FSWatcher {
  // For resumed sessions, skip existing content — only watch new writes
  let byteOffset = 0;
  if (startFromEnd) {
    try {
      byteOffset = statSync(filePath).size;
    } catch {}
  }
  let partial = ""; // Buffer for incomplete trailing line
  let processing = false;
  let pendingRecheck = false; // Set when an event arrives during processing

  async function processNewContent() {
    if (processing) {
      pendingRecheck = true;
      return;
    }
    processing = true;
    try {
      // Loop until no more new data (handles events that arrived during processing)
      let hasMore = true;
      while (hasMore) {
        pendingRecheck = false;
        hasMore = false;

        const stat = statSync(filePath);
        const fileSize = stat.size;

        // File truncated — reset
        if (fileSize < byteOffset) {
          byteOffset = 0;
          partial = "";
        }
        if (fileSize <= byteOffset) break;

        // Read only the new bytes from our last position
        const bytesToRead = fileSize - byteOffset;
        const buffer = Buffer.alloc(bytesToRead);
        const fd = await open(filePath, "r");
        try {
          await fd.read(buffer, 0, bytesToRead, byteOffset);
        } finally {
          await fd.close();
        }
        byteOffset = fileSize;

        // Split into lines, prepending any partial line from last read
        const chunk = partial + buffer.toString("utf-8");
        const lines = chunk.split("\n");

        // Last element is either empty (chunk ended with \n) or a partial line
        partial = lines.pop() ?? "";

        for (const line of lines) {
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            const assistantText = extractAssistantText(msg);
            if (assistantText) onAssistant(assistantText);
            if (onQuestion) {
              const questions = extractAskUserQuestion(msg);
              if (questions) onQuestion(questions);
            }
            // Always run extractToolCalls to populate toolUseIdToName map
            const calls = extractToolCalls(msg);
            if (onToolCall && calls.length > 0) onToolCall(calls);
            if (onToolResult) {
              const results = extractToolResults(msg);
              if (results.length > 0) onToolResult(results);
            }
            if (onThinking) {
              const thinking = extractThinking(msg);
              if (thinking) onThinking(thinking);
            }
          } catch {} // skip malformed JSONL lines
        }

        // Re-check if events arrived while we were processing
        if (pendingRecheck) hasMore = true;
      }
    } catch {} // file may not exist yet
    processing = false;
  }

  function scheduleProcess() {
    // No debounce — process immediately. The processing loop handles coalescing.
    processNewContent();
  }

  // Process any content already in the file (e.g. PI writes response before we find the file)
  processNewContent();

  const watcher = watch(filePath, scheduleProcess);

  // Periodic fallback: fs.watch on macOS can miss events.
  // Poll every 2s to catch anything the watcher dropped.
  const fallbackTimer = setInterval(processNewContent, 2000);

  // Attach cleanup to the watcher so callers can close everything
  const origClose = watcher.close.bind(watcher);
  watcher.close = () => {
    clearInterval(fallbackTimer);
    origClose();
  };

  return watcher;
}

export async function runRun(): Promise<void> {
  // Determine command: `tg claude [args]` or `tg codex [args]`
  const cmdName = process.argv[2];
  let cmdArgs = process.argv.slice(3);

  if (!cmdName || !SUPPORTED_COMMANDS[cmdName]) {
    console.error(`Usage: tg claude [args...], tg codex [args...], or tg pi [args...]`);
    process.exit(1);
  }

  // Extract --tg-* flags (consumed by tg, not passed to the tool)
  let heartbeatEnabled = false;
  let heartbeatInterval = 60; // minutes
  let sendFilesFromAssistant = false;

  const heartbeatIdx = cmdArgs.indexOf("--tg-heartbeat");
  if (heartbeatIdx !== -1) {
    heartbeatEnabled = true;
    cmdArgs = [...cmdArgs.slice(0, heartbeatIdx), ...cmdArgs.slice(heartbeatIdx + 1)];
  }

  const intervalIdx = cmdArgs.indexOf("--tg-interval");
  if (intervalIdx !== -1 && intervalIdx + 1 < cmdArgs.length) {
    heartbeatInterval = parseFloat(cmdArgs[intervalIdx + 1]) || 60;
    cmdArgs = [...cmdArgs.slice(0, intervalIdx), ...cmdArgs.slice(intervalIdx + 2)];
  }

  const sendFilesIdx = cmdArgs.indexOf("--tg-send-files");
  if (sendFilesIdx !== -1) {
    sendFilesFromAssistant = true;
    cmdArgs = [...cmdArgs.slice(0, sendFilesIdx), ...cmdArgs.slice(sendFilesIdx + 1)];
  }

  if (heartbeatEnabled) {
    const heartbeatFile = join(process.cwd(), "HEARTBEAT.md");
    try {
      statSync(heartbeatFile);
    } catch {
      console.log("No HEARTBEAT.md found in current directory.");
      process.stdout.write("Create a default one? (y/n) ");
      const response = await new Promise<string>((resolve) => {
        process.stdin.once("data", (data: Buffer) => resolve(data.toString().trim().toLowerCase()));
      });
      if (response === "y" || response === "yes") {
        const template = `# Heartbeat Instructions

## What is this?
This file is read by your agent on every heartbeat interval.
Edit these instructions to define what the agent should do periodically.

## Instructions

1. Run the test suite and fix any failing tests
2. Check for type errors and fix them
3. Commit any changes with a descriptive message
`;
        await writeFile(heartbeatFile, template, "utf-8");
        console.log("Created HEARTBEAT.md — edit it with your instructions.");
      } else {
        console.error("Cannot use --tg-heartbeat without a HEARTBEAT.md file.");
        process.exit(1);
      }
    }
  }

  const executable = SUPPORTED_COMMANDS[cmdName][0];
  const fullCommand = [executable, ...cmdArgs].join(" ");
  const displayName = process.cwd().split("/").pop() || "";

  // Try to register with daemon as a remote session
  let remoteId: string | null = null;
  let channel: Channel | null = null;
  let chatId: ChannelChatId | null = null;
  let ownerUserId: string | null = null;

  try {
    const config = await loadConfig();
    const pairedUsers = getAllPairedUsers(config);
    const botToken = getTelegramBotToken(config);
    if (pairedUsers.length > 1) {
      console.error("Security check failed: multiple paired users detected in config.");
      console.error("Single-user mode requires exactly one paired Telegram user.");
      console.error(`Fix by removing extra users in ${paths.config}.`);
      process.exit(1);
    }
    if (pairedUsers.length > 0 && botToken) {
      ownerUserId = pairedUsers[0].userId;
      chatId = pairedUsers[0].userId.startsWith("telegram:")
        ? `telegram:${pairedUsers[0].userId.split(":")[1]}`
        : pairedUsers[0].userId;

      try {
        await ensureDaemon();
        const res = await daemonRequest("/remote/register", "POST", {
          command: fullCommand,
          chatId,
          ownerUserId,
          cwd: process.cwd(),
        });
        if (res.ok && res.sessionId) {
          remoteId = res.sessionId as string;
          const dmBusy = res.dmBusy as boolean;
          const groups = (res.linkedGroups as Array<{ chatId: string; title?: string }>) || [];

          // Build all options: DM (bot name) + all linked groups/topics (including busy from full list)
          const allGroups = (res.allLinkedGroups as Array<{ chatId: string; title?: string; busyLabel?: string }>) || groups;
          const dmBusyLabel = res.dmBusyLabel as string | undefined;
          const options: Array<{ label: string; chatId: string; busy: boolean }> = [];
          let dmLabel = "DM";
          try {
            const api = new TelegramApi(botToken);
            const me = await api.getMe();
            if (me.first_name) dmLabel = me.first_name;
          } catch {}
          const dmSuffix = dmBusy && dmBusyLabel ? `\x1b[2m(DM) ← ${dmBusyLabel}\x1b[22m` : "\x1b[2m(DM)\x1b[22m";
          options.push({ label: `${dmLabel} ${dmSuffix}`, chatId: chatId!, busy: dmBusy });

          // Separate groups and topics, then interleave topics under their parent group
          const groupEntries: Array<{ chatId: string; title?: string; busy: boolean; busyLabel?: string }> = [];
          const topicEntries: Array<{ chatId: string; title?: string; busy: boolean; busyLabel?: string; parentChatId: string }> = [];
          for (const g of allGroups) {
            const isBusy = !groups.some((av) => av.chatId === g.chatId);
            const parts = g.chatId.split(":");
            if (parts.length >= 3) {
              topicEntries.push({ ...g, busy: isBusy, parentChatId: `${parts[0]}:${parts[1]}` });
            } else {
              groupEntries.push({ ...g, busy: isBusy });
            }
          }
          for (const g of groupEntries) {
            const suffix = g.busy && g.busyLabel ? `\x1b[2m(Group) ← ${g.busyLabel}\x1b[22m` : "\x1b[2m(Group)\x1b[22m";
            options.push({ label: `${g.title || g.chatId} ${suffix}`, chatId: g.chatId, busy: g.busy });
            // Insert topics belonging to this group immediately after
            for (const t of topicEntries) {
              if (t.parentChatId === g.chatId) {
                const tSuffix = t.busy && t.busyLabel ? `\x1b[2m(Topic) ← ${t.busyLabel}\x1b[22m` : "\x1b[2m(Topic)\x1b[22m";
                options.push({ label: `  ${t.title || "Topic"} ${tSuffix}`, chatId: t.chatId, busy: t.busy });
              }
            }
          }
          // Orphan topics (parent group not linked) — show at the end
          for (const t of topicEntries) {
            if (!groupEntries.some((g) => g.chatId === t.parentChatId)) {
              const tSuffix = t.busy && t.busyLabel ? `\x1b[2m(Topic) ← ${t.busyLabel}\x1b[22m` : "\x1b[2m(Topic)\x1b[22m";
              options.push({ label: `  ${t.title || "Topic"} ${tSuffix}`, chatId: t.chatId, busy: t.busy });
            }
          }

          // Add "None" option at the end
          options.push({ label: `None \x1b[2m(Connect later)\x1b[22m`, chatId: "", busy: false });

          if (options.length === 2 && !dmBusy) {
            // Only DM + None, no groups — auto-bind to DM silently
            await daemonRequest("/remote/bind-chat", "POST", {
              sessionId: remoteId,
              chatId,
              ownerUserId,
            });
          } else {
            const labels = options.map((o) => o.label);
            const choice = await terminalPicker(
              "⛳ Select a Telegram channel:",
              labels,
              "Add bot to a Telegram group and send /link to add more channels"
            );
            if (choice >= 0 && choice < options.length && options[choice].chatId) {
              const chosen = options[choice];
              try {
                await daemonRequest("/remote/bind-chat", "POST", {
                  sessionId: remoteId,
                  chatId: chosen.chatId,
                  ownerUserId,
                });
                chatId = chosen.chatId as ChannelChatId;
              } catch (bindErr) {
                console.error(`\x1b[33m⚠ ${(bindErr as Error).message}. Falling back to DM.\x1b[0m`);
                await daemonRequest("/remote/bind-chat", "POST", {
                  sessionId: remoteId,
                  chatId,
                  ownerUserId,
                });
              }
            }
          }
        }
      } catch {
        // Daemon failed to start — local-only mode
      }

      // Set up channel for JSONL watching
      channel = new TelegramChannel(botToken);

    }
  } catch {
    // Config load failed — local-only mode
  }

  // Write session manifest if registered with daemon
  const manifest: SessionManifest | null = remoteId
    ? {
        id: remoteId,
        command: fullCommand,
        cwd: process.cwd(),
        pid: process.pid,
        jsonlFile: null,
        startedAt: new Date().toISOString(),
      }
    : null;
  if (manifest) {
    await writeManifest(manifest);
  }

  // Detect resume flags to find existing session JSONL file
  // - Claude: --resume <session-id>
  // - Codex: resume <session-id>
  // - PI: --continue/-c (latest session), --session <path>
  let resumeSessionFile: string | null = null;

  // Snapshot existing JSONL files BEFORE spawning so the tool's new file is detected
  const projectDir = channel && chatId ? getSessionDir(cmdName) : "";
  const existingFiles = new Set<string>();
  if (projectDir) {
    try {
      for (const f of readdirSync(projectDir)) {
        if (f.endsWith(".jsonl")) existingFiles.add(f);
      }
    } catch {}

    // Check for resume session ID in args
    let resumeId: string | null = null;
    const resumeIdx = cmdArgs.indexOf("--resume");
    if (resumeIdx !== -1 && resumeIdx + 1 < cmdArgs.length) {
      resumeId = cmdArgs[resumeIdx + 1];
    }
    if (!resumeId && cmdArgs[0] === "resume" && cmdArgs.length > 1) {
      resumeId = cmdArgs[1]; // codex resume <id>
    }

    if (resumeId) {
      // Search for JSONL file matching the session ID
      try {
        // Claude/PI: <id>.jsonl in project dir, or filename contains ID
        if (existingFiles.has(`${resumeId}.jsonl`)) {
          resumeSessionFile = join(projectDir, `${resumeId}.jsonl`);
        } else {
          for (const f of existingFiles) {
            if (f.includes(resumeId)) {
              resumeSessionFile = join(projectDir, f);
              break;
            }
          }
        }

        // Codex: session may be in a different date directory — search recursively
        if (!resumeSessionFile && cmdName === "codex") {
          const codexRoot = join(homedir(), ".codex", "sessions");
          const searchDir = (dir: string): string | null => {
            try {
              for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                  const found = searchDir(join(dir, entry.name));
                  if (found) return found;
                } else if (entry.name.endsWith(".jsonl") && entry.name.includes(resumeId!)) {
                  return join(dir, entry.name);
                }
              }
            } catch {}
            return null;
          };
          resumeSessionFile = searchDir(codexRoot);
        }
      } catch {}
    }

    // PI --continue/-c: use the most recent JSONL file
    if (!resumeSessionFile && (cmdArgs.includes("--continue") || cmdArgs.includes("-c"))) {
      try {
        let newest = "";
        let newestMtime = 0;
        for (const f of existingFiles) {
          const s = statSync(join(projectDir, f));
          if (s.mtimeMs > newestMtime) {
            newestMtime = s.mtimeMs;
            newest = f;
          }
        }
        if (newest) resumeSessionFile = join(projectDir, newest);
      } catch {}
    }
  }

  // Use raw mode if stdin is a TTY so keypresses are forwarded immediately
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // PTY output buffer for detecting approval prompts (per-CLI patterns)
  const approvalPattern = APPROVAL_PATTERNS[cmdName];
  let ptyBuffer = "";
  let lastNotifiedPrompt = "";
  // Track the last tool call so we can report it when the approval prompt appears
  let lastToolCall: { name: string; input: Record<string, unknown> } | null = null;
  const onApprovalPrompt = remoteId
    ? (promptText: string, pollOptions?: string[]) => {
        daemonRequest(`/remote/${remoteId}/approval-needed`, "POST", {
          name: lastToolCall?.name || "unknown",
          input: lastToolCall?.input || {},
          promptText,
          pollOptions,
        }).catch(() => {});
      }
    : null;

  const proc = Bun.spawn([executable, ...cmdArgs], {
    terminal: {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      data(_terminal, data) {
        process.stdout.write(data);
        // Buffer last ~1000 chars of PTY output for prompt detection
        // Uses stripAnsiReadable to replace ANSI codes with spaces (preserves word boundaries)
        const text = Buffer.from(data).toString("utf-8");
        ptyBuffer += stripAnsiReadable(text);
        if (ptyBuffer.length > 2000) ptyBuffer = ptyBuffer.slice(-1000);

        if (!approvalPattern) return; // No approval detection for this CLI
        const promptIdx = ptyBuffer.lastIndexOf(approvalPattern.promptText);
        const hasOption = ptyBuffer.includes(approvalPattern.optionText);
        if (promptIdx >= 0 && hasOption) {
          // Extract the prompt sentence: "Do you want to ...?"
          const afterPrompt = ptyBuffer.slice(promptIdx);
          const endIdx = afterPrompt.indexOf("?");
          const promptText = endIdx >= 0 ? afterPrompt.slice(0, endIdx + 1).trim() : approvalPattern.promptText;
          // Extract poll options from text after the "?": "1. Yes", "2. Yes, allow ...", "3. No"
          // Search only after the "?" to avoid matching digits in filenames (e.g. "poem-7.md")
          const optionsText = endIdx >= 0 ? afterPrompt.slice(endIdx + 1) : "";
          const options: string[] = [];
          // Find positions of "1. ", "2. ", "3. " markers
          const idx1 = optionsText.indexOf("1.");
          const idx2 = optionsText.indexOf("2.");
          const idx3 = optionsText.indexOf("3.");
          if (idx1 >= 0 && idx2 > idx1 && idx3 > idx2) {
            options.push(optionsText.slice(idx1 + 2, idx2).trim().replace(/\s+/g, " "));
            options.push(optionsText.slice(idx2 + 2, idx3).trim().replace(/\s+/g, " "));
            // Stop at footer text: "Esc to cancel" (Claude) or "Press enter" (Codex)
            let opt3 = optionsText.slice(idx3 + 2);
            for (const stop of ["Esc", "Press"]) {
              const stopIdx = opt3.indexOf(stop);
              if (stopIdx > 0) opt3 = opt3.slice(0, stopIdx);
            }
            options.push(opt3.trim().replace(/\s+/g, " "));
          }
          // Strip keyboard shortcut hints like (y), (p), (esc), (shift+tab) from options
          for (let i = 0; i < options.length; i++) {
            options[i] = options[i].replace(/\s*\([a-z+\-]+\)\s*$/i, "").trim().slice(0, 100);
          }
          // Only notify if this is a different prompt than the last one we notified about
          // Delay slightly so the tool notification (from JSONL) arrives in Telegram first
          if (promptText !== lastNotifiedPrompt) {
            lastNotifiedPrompt = promptText;
            const pollOptions = options.length >= 2 ? options : undefined;
            setTimeout(() => onApprovalPrompt?.(promptText, pollOptions), 1000);
          }
        }
      },
    },
    env: {
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
    },
  });

  const terminal = proc.terminal!;

  // Forward stdin to the PTY
  process.stdin.on("data", (data: Buffer) => {
    terminal.write(data);
  });

  // Handle terminal resize
  process.stdout.on("resize", () => {
    terminal.resize(process.stdout.columns, process.stdout.rows);
  });

  // Track group chats subscribed to this session's output
  const subscribedGroups = new Set<ChannelChatId>();
  // Track which chat this session is bound to (may differ from chatId if bound to a group)
  let boundChat: ChannelChatId | null = null;
  let groupPollTimer: ReturnType<typeof setInterval> | null = null;
  if (remoteId) {
    const pollRemoteId = remoteId;
    groupPollTimer = setInterval(async () => {
      try {
        const res = await daemonRequest(`/remote/${pollRemoteId}/subscribed-groups`);
        const chatIds = res.chatIds as string[] | undefined;
        if (chatIds) {
          subscribedGroups.clear();
          for (const id of chatIds) subscribedGroups.add(id);
        }
        boundChat = typeof res.boundChat === "string"
          ? (res.boundChat as ChannelChatId)
          : null;
      } catch {}
    }, 2000);
  }

  // Heartbeat: periodically send a message to the agent's terminal
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (heartbeatEnabled) {
    const intervalMs = heartbeatInterval * 60 * 1000;
    heartbeatTimer = setInterval(() => {
      const heartbeatFile = join(process.cwd(), "HEARTBEAT.md");
      let content: string;
      try {
        content = readFileSync(heartbeatFile, "utf-8").trim();
      } catch {
        content = "No HEARTBEAT.md found in project directory.";
      }
      const now = new Date();
      const ts = now.toISOString().replace("T", " ").slice(0, 16);
      const msg = `❤ This is a scheduled heartbeat message for workflows and cron jobs. The current time and date is: ${ts}. Follow these instructions now if time and date is relevant:\n\n${content}\n\n❤`;
      terminal.write(Buffer.from(msg));
      setTimeout(() => terminal.write(Buffer.from("\r")), 100);
    }, intervalMs);
  }

  // Watch session JSONL for assistant responses.
  const watcherRef: { current: FSWatcher | null; dir: FSWatcher | null } = { current: null, dir: null };
  if (channel && chatId && projectDir) {
    const tgChatId = chatId;
    const tgChannel = channel;
    const tgRemoteId = remoteId;

    const startFileWatch = (sessionFile: string, skipExisting = false) => {
      if (watcherRef.current) return; // already locked to a session
      // Update manifest with discovered JSONL file
      if (manifest) {
        manifest.jsonlFile = sessionFile;
        writeManifest(manifest).catch(() => {});
      }
      const onQuestion = tgRemoteId
        ? (questions: unknown[]) => {
            daemonRequest(`/remote/${tgRemoteId}/question`, "POST", { questions }).catch(() => {});
          }
        : undefined;

      // Track tool calls for typing indicators and notifications.
      // Approval detection is handled by the PTY buffer (see APPROVAL_PROMPT_TEXT).
      const onToolCall = tgRemoteId
        ? (calls: ToolCallInfo[]) => {
            // Agent is working — assert typing on all target chats
            const typingTarget = boundChat || tgChatId;
            tgChannel.setTyping(typingTarget, true);
            for (const gid of subscribedGroups) tgChannel.setTyping(gid, true);

            for (const call of calls) {
              // Only track approvable tools for approval prompt attribution
              if (APPROVABLE_TOOLS.has(call.name)) {
                lastToolCall = { name: call.name, input: call.input };
              }
              // Send tool notification immediately (no poll)
              daemonRequest(`/remote/${tgRemoteId}/tool-call`, "POST", {
                name: call.name,
                input: call.input,
              }).catch(() => {});
            }
          }
        : undefined;

      // Thinking is disabled by default — enable via future config option
      const onThinking = undefined;

      const onToolResult = tgRemoteId
        ? (results: ToolResultInfo[]) => {
            for (const result of results) {
              daemonRequest(`/remote/${tgRemoteId}/tool-result`, "POST", {
                toolName: result.toolName,
                content: result.content,
              }).catch(() => {});
            }
          }
        : undefined;

      watcherRef.current = watchSessionFile(sessionFile, (text) => {
        // Determine target chats: bound chat + subscribed groups (skip unbound DM)
        const targetChat = boundChat || tgChatId;
        const targets = new Set<ChannelChatId>([targetChat]);
        for (const gid of subscribedGroups) targets.add(gid);

        for (const cid of targets) tgChannel.setTyping(cid, false);

        const html = markdownToHtml(text);
        for (const cid of targets) {
          tgChannel.send(cid, html);
        }
        // Detect file paths in the text and send as attachments
        if (sendFilesFromAssistant && tgChannel.sendDocument) {
          const files = extractFilePaths(text, process.cwd());
          for (const fp of files) {
            const fileName = fp.split("/").pop() || "file";
            for (const cid of targets) {
              tgChannel.sendDocument!(cid, fp, fileName);
            }
          }
        }
      }, onQuestion, onToolCall, onThinking, onToolResult, skipExisting);
      // Close directory watcher — locked to this session file
      if (watcherRef.dir) {
        watcherRef.dir.close();
        watcherRef.dir = null;
      }
    };

    // If resuming, watch the existing session file — skip old content
    if (resumeSessionFile) {
      startFileWatch(resumeSessionFile, true);
    }

    // Check for files that appeared between snapshot and now (e.g. PI creates file at startup)
    const checkForNewFiles = () => {
      try {
        for (const f of readdirSync(projectDir)) {
          if (f.endsWith(".jsonl") && !existingFiles.has(f)) {
            startFileWatch(join(projectDir, f));
            return;
          }
        }
      } catch {}
    };

    // Watch the project directory for new .jsonl files
    try {
      watcherRef.dir = watch(projectDir, (_event, filename) => {
        if (!filename?.endsWith(".jsonl")) return;
        if (existingFiles.has(filename)) return;
        startFileWatch(join(projectDir, filename));
      });
    } catch {}

    // Immediate check + periodic poll for tools that create files before watcher is ready
    checkForNewFiles();
    const scanTimer = setInterval(() => {
      if (watcherRef.current) {
        clearInterval(scanTimer);
        return;
      }
      checkForNewFiles();
    }, 500);
    // Stop polling after 30s
    setTimeout(() => clearInterval(scanTimer), 30_000);
  }

  // Poll daemon for remote input if registered
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let processingInput = false;
  if (remoteId) {
    pollTimer = setInterval(async () => {
      if (processingInput) return;
      try {
        const res = await daemonRequest(`/remote/${remoteId}/input`);
        const lines = res.lines as string[] | undefined;
        if (lines && lines.length > 0) {
          processingInput = true;
          const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

          for (const line of lines) {
            // Poll next/submit: navigate Down to "Next"/"Submit" button, then Enter
            // Format: \x1b[POLL_NEXT:lastPos:optionCount]
            // UI items: options[0..N-1], "Type something"[N], then "Next"[N+1]
            const nextMatch = line.match(/^\x1b\[POLL_NEXT:(\d+):(\d+)\]$/);
            if (nextMatch || line === "\x1b[POLL_SUBMIT]") {
              if (nextMatch) {
                const lastPos = parseInt(nextMatch[1]);
                const optionCount = parseInt(nextMatch[2]);
                // "Next" is 2 positions after last real option: options + "Type something" + Next
                const nextPos = optionCount + 1;
                const downs = nextPos - lastPos;
                const DOWN = Buffer.from("\x1b[B");
                for (let i = 0; i < downs; i++) {
                  terminal.write(DOWN);
                  await delay(50);
                }
              }
              // POLL_SUBMIT: cursor is already on "Submit answers" — just press Enter
              terminal.write(Buffer.from("\r"));
              await delay(300);
              continue;
            }

            // Poll "Other" selected: navigate to "Other" option and press Enter
            // Next text line will fill in the custom text
            if (line === "\x1b[POLL_OTHER]") {
              // "Other" is handled by the AskUserQuestion UI as a free-text input
              // Just wait for the next text message to be typed
              continue;
            }

            // Poll answer: \x1b[POLL:optionIds:multiSelect]
            const pollMatch = line.match(/^\x1b\[POLL:([0-9,]+):([01])\]$/);
            if (pollMatch) {
              const optionIds = pollMatch[1].split(",").map(Number);
              const multiSelect = pollMatch[2] === "1";
              await writePollKeypresses(terminal, optionIds, multiSelect);
              await delay(100);
              continue;
            }

            // Regular text input — start typing indicator
            if (channel && chatId) {
              channel.setTyping(chatId, true);
              for (const gid of subscribedGroups) channel.setTyping(gid, true);
            }
            terminal.write(Buffer.from(line));
            // File paths need extra time for the agent to load/process the attachment
            const hasFilePath = line.includes("/.touchgrass/uploads/");
            await delay(hasFilePath ? 1500 : 100);
            terminal.write(Buffer.from("\r"));
            await delay(100);
          }
          processingInput = false;
        }
      } catch {
        // Don't kill polling on transient errors — just retry next interval
        processingInput = false;
      }
    }, 200);
  }

  const exitCode = await proc.exited;

  // Cleanup
  if (pollTimer) clearInterval(pollTimer);
  if (groupPollTimer) clearInterval(groupPollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (watcherRef.current) watcherRef.current.close();
  if (watcherRef.dir) watcherRef.dir.close();

  if (remoteId) {
    try {
      await daemonRequest(`/remote/${remoteId}/exit`, "POST", {
        exitCode: exitCode ?? null,
      });
    } catch {}
    await removeManifest(remoteId);
  } else if (channel && chatId) {
    const status = exitCode === 0 ? "exited" : `exited with code ${exitCode ?? "unknown"}`;
    await channel.send(chatId, `Command <code>${escapeHtml(fullCommand)}</code> ${escapeHtml(status)}.`);
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  process.exit(exitCode ?? 1);
}
