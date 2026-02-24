import { loadConfig } from "../config/store";
import { getAllPairedUsers, getTelegramBotToken, type ChannelConfig, type TgConfig } from "../config/schema";
import { createChannel } from "../channel/factory";
import type { Channel, ChannelChatId } from "../channel/types";
import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { createRemoteRecoveryController } from "./remote-recovery";
import { stripAnsiReadable } from "../utils/ansi";
import { paths, ensureDirs } from "../config/paths";
import { getChannelName, getChannelType } from "../channel/id";
import { watch, readdirSync, statSync, readFileSync, type FSWatcher } from "fs";
import { chmod, open, writeFile, unlink } from "fs/promises";
import { homedir, platform } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { parseRemoteControlAction } from "../session/remote-control";

// Per-CLI patterns for detecting approval prompts in terminal output.
// Both `promptText` and `optionText` must be present in the PTY buffer to trigger a notification.
// Add entries here when adding support for new CLIs.

const APPROVAL_PATTERNS: Record<string, { promptText: string; optionText: string }> = {
  claude: { promptText: "Do you want to", optionText: "1. Yes" },
  codex: { promptText: "Would you like to run the following command", optionText: "1. Yes, proceed" },
  // pi: { promptText: "...", optionText: "..." },
  // kimi: { promptText: "...", optionText: "..." },
};

// Test-only accessors for CLI arg parsing behavior.
export const __cliRunTestUtils = {
  encodeBracketedPaste,
  buildResumeCommandArgs,
  parseCodexResumeArgs,
  parseKimiResumeArgs,
  validateRunSetupPreflight,
  parseJsonlMessage,
  isVersionBelow,
  resetParserState: () => {
    toolUseIdToName.clear();
    toolUseIdToInput.clear();
    codexSessionIdToCommand.clear();
    kimiAssistantTextBuffer.length = 0;
    kimiAssistantThinkingBuffer.length = 0;
  },
};

interface OwnerChannelResolution {
  channelName: string;
  channelConfig: ChannelConfig;
  ownerUserId: string;
  ownerChatId: ChannelChatId;
}

function listOwnerChannels(config: TgConfig): OwnerChannelResolution[] {
  const candidates: OwnerChannelResolution[] = [];
  for (const [channelName, channelConfig] of Object.entries(config.channels)) {
    const paired = channelConfig.pairedUsers || [];
    if (paired.length === 0) continue;
    if (paired.length > 1) continue; // ambiguous ownership within this channel

    const ownerUserId = paired[0].userId;
    const parts = ownerUserId.split(":");
    if (parts.length < 2) continue;
    const channelType = parts[0];
    if (channelType !== channelConfig.type) continue;
    const ownerChatId = `${channelType}:${parts.slice(1).join(":")}`;
    candidates.push({ channelName, channelConfig, ownerUserId, ownerChatId });
  }
  return candidates;
}

function resolveOwnerChannel(
  config: TgConfig,
  preferredChannelType?: string,
  preferredChannelName?: string
): OwnerChannelResolution | null {
  const candidates = listOwnerChannels(config);

  if (preferredChannelName) {
    const preferred = candidates.find((c) => c.channelName === preferredChannelName);
    if (preferred) return preferred;
  }
  if (preferredChannelType) {
    const preferred = candidates.find((c) => c.channelConfig.type === preferredChannelType);
    if (preferred) return preferred;
  }
  return candidates[0] || null;
}

interface RunSetupPreflight {
  ok: boolean;
  message?: string;
  details?: string;
}

function validateRunSetupPreflight(config: TgConfig): RunSetupPreflight {
  const token = getTelegramBotToken(config).trim();
  if (!token) {
    return {
      ok: false,
      message: "Telegram setup is incomplete.",
      details: "Run `tg setup` to configure your bot token before starting sessions.",
    };
  }

  const pairedUsers = getAllPairedUsers(config);
  if (pairedUsers.length === 0) {
    return {
      ok: false,
      message: "No paired owner found.",
      details: "Run `tg pair` and send `/pair <code>` to your bot.",
    };
  }

  const ownerCandidates = listOwnerChannels(config);
  if (ownerCandidates.length === 0) {
    return {
      ok: false,
      message: "No usable paired channel owner found.",
      details: `Ensure one paired user per channel in your config. Config: ${paths.config}`,
    };
  }

  return { ok: true };
}

// Arrow-key picker for terminal selection
export function terminalPicker(title: string, options: string[], hint?: string, disabled?: Set<number>): Promise<number> {
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
      if (totalRows > 0) process.stdout.write(`\x1b[${totalRows}A\x1b[J`);
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
  kimi: ["kimi"],
};

// Minimum supported tool versions. Below these, touchgrass may not work correctly.
const MIN_TOOL_VERSIONS: Record<string, string> = {
  claude: "2.1.0",
  codex: "0.100.0",
  pi: "0.50.0",
  kimi: "0.1.0",
};

function parseVersion(v: string): number[] {
  return v.split(".").map((n) => parseInt(n, 10) || 0);
}

function isVersionBelow(current: string, minimum: string): boolean {
  const cur = parseVersion(current);
  const min = parseVersion(minimum);
  for (let i = 0; i < Math.max(cur.length, min.length); i++) {
    const c = cur[i] ?? 0;
    const m = min[i] ?? 0;
    if (c < m) return true;
    if (c > m) return false;
  }
  return false;
}

async function checkToolVersion(tool: string): Promise<void> {
  const minVersion = MIN_TOOL_VERSIONS[tool];
  if (!minVersion) return;
  try {
    const proc = Bun.spawn([tool, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CLAUDECODE: undefined },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    // Extract version number from output (e.g. "2.1.49 (Claude Code)" → "2.1.49")
    const match = output.trim().match(/(\d+\.\d+\.\d+)/);
    if (!match) return;
    const version = match[1];
    if (isVersionBelow(version, minVersion)) {
      console.warn(`⚠️  ${tool} ${version} detected — minimum supported is ${minVersion}. Please upgrade.`);
    }
  } catch {
    // Tool not found or version check failed — will fail at spawn anyway
  }
}

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
    // PI session path: ~/.pi/agent/sessions/--<encoded-cwd>--/
    const encoded = "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
    return join(homedir(), ".pi", "agent", "sessions", encoded);
  }
  if (command === "kimi") {
    // Kimi: ~/.kimi/sessions/<md5(cwd)>/<session-id>/wire.jsonl
    const encoded = createHash("md5").update(cwd).digest("hex");
    return join(homedir(), ".kimi", "sessions", encoded);
  }
  // Claude: ~/.claude/projects/<encoded-cwd>/
  const encoded = cwd.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

function readSessionIdsFromJsonl(filePath: string, maxLines = 80): Set<string> {
  const ids = new Set<string>();
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n");
    const limit = Math.min(lines.length, maxLines);
    for (let i = 0; i < limit; i++) {
      const line = lines[i];
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (typeof msg.sessionId === "string") ids.add(msg.sessionId);
      } catch {}
    }
  } catch {}
  return ids;
}

// ── Single-pass JSONL message parser ──────────────────────────────
// Extracts assistant text, thinking, questions, tool calls, and tool results
// in one dispatch + one loop over content blocks (instead of 5 separate passes).

interface ToolCallInfo {
  id: string; // tool_use_id for matching with results
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultInfo {
  toolName: string;
  content: string;
  isError: boolean;
}

interface BackgroundJobEventInfo {
  taskId: string;
  status: "running" | "completed" | "failed" | "killed";
  command?: string;
  outputFile?: string;
  summary?: string;
  urls?: string[];
}

interface ParsedMessage {
  assistantText: string | null;
  thinking: string | null;
  questions: unknown[] | null;
  toolCalls: ToolCallInfo[];
  toolResults: ToolResultInfo[];
  backgroundJobEvents: BackgroundJobEventInfo[];
}

// Map tool_use_id/call_id → tool name so we can label tool_results
const toolUseIdToName = new Map<string, string>();
const toolUseIdToInput = new Map<string, Record<string, unknown>>();
const codexSessionIdToCommand = new Map<string, string>();

// Only forward results for tools where the output is useful to see on Telegram
const FORWARD_RESULT_TOOLS = new Set([
  "WebFetch", "WebSearch", "Bash", // Claude
  "web_fetch", "web_search", "bash", // PI / Kimi
  "exec_command", // Codex
  "Task", // Claude sub-agent lifecycle / output
  "spawn_agent", "send_input", "wait", // Codex sub-agent lifecycle
]);

// Tool rejections the user already sees in their terminal — don't echo to Telegram
const isToolRejection = (text: string) =>
  text.includes("The user doesn't want to proceed with this tool use");

const EMPTY_PARSED: ParsedMessage = {
  assistantText: null, thinking: null, questions: null, toolCalls: [], toolResults: [], backgroundJobEvents: [],
};

function extractTaskNotificationTag(content: string, tag: string): string | undefined {
  const match = content.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() || undefined;
}

function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>)\]}]+/gi) || [];
  const deduped = new Set<string>();
  for (const raw of matches) {
    const url = raw.replace(/^[('"`]+|[),.;!?'"`]+$/g, "");
    if (url) deduped.add(url);
    if (deduped.size >= 3) break;
  }
  return Array.from(deduped);
}

function inferUrlsFromCommand(command?: string): string[] {
  if (!command) return [];
  const deduped = new Set<string>(extractUrls(command));
  const portPatterns: RegExp[] = [
    /(?:localhost|127\.0\.0\.1):(\d{2,5})/gi,
    /\.listen\((\d{2,5})\)/gi,
    /--port(?:=|\s+)(\d{2,5})/gi,
    /-p(?:=|\s+)(\d{2,5})/gi,
  ];
  for (const pattern of portPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(command)) !== null) {
      const port = Number(match[1]);
      if (!Number.isFinite(port) || port < 1 || port > 65535) continue;
      deduped.add(`http://localhost:${port}`);
    }
  }
  return Array.from(deduped).slice(0, 3);
}

function mergeUrls(primary?: string[], secondary?: string[]): string[] | undefined {
  const merged = new Set<string>();
  for (const url of primary || []) merged.add(url);
  for (const url of secondary || []) merged.add(url);
  if (merged.size === 0) return undefined;
  return Array.from(merged).slice(0, 3);
}

function extractStoppedTaskFromResult(
  text: string,
  toolUseResult?: Record<string, unknown>
): { taskId: string; command?: string } | null {
  const trimmed = text.trim();
  if (!trimmed && !toolUseResult) return null;

  const fromToolUseResultTaskId = typeof toolUseResult?.task_id === "string" ? toolUseResult.task_id : "";
  const fromToolUseResultMessage = typeof toolUseResult?.message === "string" ? toolUseResult.message : "";
  const fromToolUseResultCommand = typeof toolUseResult?.command === "string" ? toolUseResult.command : undefined;
  if (
    fromToolUseResultTaskId &&
    /stopped task|killed task|terminated task|cancelled task|canceled task/i.test(fromToolUseResultMessage)
  ) {
    return { taskId: fromToolUseResultTaskId, command: fromToolUseResultCommand };
  }

  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const taskId = typeof parsed.task_id === "string"
      ? parsed.task_id
      : typeof parsed.taskId === "string"
      ? parsed.taskId
      : "";
    const command = typeof parsed.command === "string" ? parsed.command : undefined;
    const message = typeof parsed.message === "string" ? parsed.message : "";
    const status = typeof parsed.status === "string" ? parsed.status.toLowerCase() : "";
    const stoppedByStatus = status === "killed" || status === "stopped" || status === "terminated" || status === "cancelled" || status === "canceled";
    const stoppedByMessage = /stopped task|killed task|terminated task|cancelled task|canceled task/i.test(message);
    if (taskId && (stoppedByStatus || stoppedByMessage)) {
      return { taskId, command };
    }
  } catch {
    // Not JSON.
  }

  const stoppedId = trimmed.match(/Successfully stopped task:\s*([A-Za-z0-9_-]+)/i)?.[1];
  if (!stoppedId) return null;
  const command = trimmed.match(/Successfully stopped task:\s*[A-Za-z0-9_-]+\s*\(([\s\S]+)\)/i)?.[1];
  return { taskId: stoppedId, command };
}

function normalizeCodexSessionId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value));
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function detectCodexExitStatus(output: string): BackgroundJobEventInfo["status"] | null {
  const codeMatch = output.match(/Process exited with code\s+(-?\d+)/i);
  if (codeMatch) {
    const code = Number(codeMatch[1]);
    if (Number.isFinite(code) && code === 0) return "completed";
    return "failed";
  }
  if (/(stdin is closed for this session|session not found|no such session)/i.test(output)) {
    return "killed";
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractTextFromContentPart(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        const rec = asRecord(item);
        if (!rec) return "";
        if (typeof rec.text === "string") return rec.text;
        if (typeof rec.think === "string") return rec.think;
        return "";
      })
      .filter(Boolean);
    return parts.join("\n").trim();
  }
  const rec = asRecord(value);
  if (!rec) return "";
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.think === "string") return rec.think;
  return "";
}

function extractKimiToolResultText(returnValue: Record<string, unknown> | null): string {
  if (!returnValue) return "";
  const chunks: string[] = [];
  if (typeof returnValue.message === "string" && returnValue.message.trim()) {
    chunks.push(returnValue.message.trim());
  }
  const outputText = extractTextFromContentPart(returnValue.output);
  if (outputText) chunks.push(outputText);
  return chunks.join("\n").trim();
}

const kimiAssistantTextBuffer: string[] = [];
const kimiAssistantThinkingBuffer: string[] = [];

function parseJsonlMessage(msg: Record<string, unknown>): ParsedMessage {
  // Claude assistant — text, thinking, tool calls, and questions in one loop
  if (msg.type === "assistant") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (!m?.content || !Array.isArray(m.content)) return EMPTY_PARSED;
    const content = m.content as Array<Record<string, unknown>>;
    const texts: string[] = [];
    const thinkings: string[] = [];
    let questions: unknown[] | null = null;
    const toolCalls: ToolCallInfo[] = [];
    for (const block of content) {
      switch (block.type) {
        case "text":
          if (block.text) texts.push(block.text as string);
          break;
        case "thinking":
          if (block.thinking) thinkings.push(block.thinking as string);
          break;
        case "tool_use": {
          const name = block.name as string;
          if (!name) break;
          const toolId = (block.id as string) || "";
          if (toolId) {
            toolUseIdToName.set(toolId, name);
            toolUseIdToInput.set(toolId, ((block.input as Record<string, unknown>) || {}));
          }
          if (name === "AskUserQuestion") {
            const input = block.input as Record<string, unknown> | undefined;
            if (input?.questions && Array.isArray(input.questions)) {
              questions = input.questions as unknown[];
            }
          } else {
            toolCalls.push({ id: toolId, name, input: (block.input as Record<string, unknown>) || {} });
          }
          break;
        }
      }
    }
    capIdMap();
    const assistantText = texts.join("\n").trim() || null;
    const thinking = thinkings.join("\n").trim() || null;
    return { assistantText, thinking, questions, toolCalls, toolResults: [], backgroundJobEvents: [] };
  }

  // Kimi wire.jsonl format — {"timestamp": ..., "message": {"type": "...", "payload": {...}}}
  const wireMessage = asRecord(msg.message);
  const wireType = typeof wireMessage?.type === "string" ? wireMessage.type : "";
  const wirePayload = asRecord(wireMessage?.payload);
  if (wireType && wirePayload) {
    // Step boundaries flush buffered assistant text/thinking so we send cohesive chunks.
    if (wireType === "StepBegin" || wireType === "StepInterrupted" || wireType === "TurnBegin") {
      const assistantText = kimiAssistantTextBuffer.join("").trim() || null;
      const thinking = kimiAssistantThinkingBuffer.join("").trim() || null;
      kimiAssistantTextBuffer.length = 0;
      kimiAssistantThinkingBuffer.length = 0;
      if (!assistantText && !thinking) return EMPTY_PARSED;
      return { assistantText, thinking, questions: null, toolCalls: [], toolResults: [], backgroundJobEvents: [] };
    }

    const payloadPartType = typeof wirePayload.type === "string" ? wirePayload.type : "";
    if (wireType === "TextPart" || (wireType === "ContentPart" && payloadPartType === "text")) {
      const text = typeof wirePayload.text === "string" ? wirePayload.text : "";
      if (text) kimiAssistantTextBuffer.push(text);
      return EMPTY_PARSED;
    }

    if (wireType === "ThinkPart" || (wireType === "ContentPart" && payloadPartType === "think")) {
      const text = typeof wirePayload.think === "string" ? wirePayload.think : "";
      if (text) kimiAssistantThinkingBuffer.push(text);
      return EMPTY_PARSED;
    }

    if (wireType === "ToolCall") {
      const callId = typeof wirePayload.id === "string" ? wirePayload.id : "";
      const fn = asRecord(wirePayload.function);
      const name = typeof fn?.name === "string" ? fn.name : "";
      if (!name) return EMPTY_PARSED;
      let input: Record<string, unknown> = {};
      if (typeof fn?.arguments === "string" && fn.arguments.trim()) {
        try {
          input = JSON.parse(fn.arguments) as Record<string, unknown>;
        } catch {
          input = { arguments: fn.arguments };
        }
      }
      if (callId) {
        toolUseIdToName.set(callId, name);
        toolUseIdToInput.set(callId, input);
      }
      capIdMap();
      return { ...EMPTY_PARSED, toolCalls: [{ id: callId, name, input }] };
    }

    if (wireType === "ToolResult") {
      const callId = typeof wirePayload.tool_call_id === "string" ? wirePayload.tool_call_id : "";
      const toolName = callId ? toolUseIdToName.get(callId) ?? "" : "";
      const returnValue = asRecord(wirePayload.return_value);
      const isError = returnValue?.is_error === true;
      const content = extractKimiToolResultText(returnValue);

      const backgroundJobEvents: BackgroundJobEventInfo[] = [];
      const input = callId ? toolUseIdToInput.get(callId) : undefined;
      const command = typeof input?.command === "string"
        ? input.command
        : typeof input?.cmd === "string"
        ? input.cmd
        : undefined;
      if (content) {
        const stoppedTask = extractStoppedTaskFromResult(content);
        if (stoppedTask?.taskId) {
          backgroundJobEvents.push({
            taskId: stoppedTask.taskId,
            status: "killed",
            command: stoppedTask.command || command,
            urls: mergeUrls(extractUrls(content), inferUrlsFromCommand(stoppedTask.command || command)),
          });
        }
        const startedId = content.match(/Command running in background with ID:\s*([A-Za-z0-9_-]+)/i)?.[1];
        if (startedId) {
          backgroundJobEvents.push({
            taskId: startedId,
            status: "running",
            command,
            urls: mergeUrls(extractUrls(content), inferUrlsFromCommand(command)),
          });
        }
      }

      if (isError && isToolRejection(content)) return EMPTY_PARSED;
      const toolResults: ToolResultInfo[] = [];
      const shouldForwardToolResult = isError || FORWARD_RESULT_TOOLS.has(toolName);
      if (content && shouldForwardToolResult) {
        toolResults.push({ toolName: toolName || "unknown", content, isError });
      }
      if (toolResults.length === 0 && backgroundJobEvents.length === 0) return EMPTY_PARSED;
      return { ...EMPTY_PARSED, toolResults, backgroundJobEvents };
    }

    return EMPTY_PARSED;
  }

  // PI format — role determines assistant vs tool result
  if (msg.type === "message") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (!m?.content || !Array.isArray(m.content)) return EMPTY_PARSED;

    if (m.role === "assistant") {
      const content = m.content as Array<Record<string, unknown>>;
      const texts: string[] = [];
      const thinkings: string[] = [];
      const toolCalls: ToolCallInfo[] = [];
      for (const block of content) {
        switch (block.type) {
          case "text":
            if (block.text) texts.push(block.text as string);
            break;
          case "thinking":
            if (block.thinking) thinkings.push(block.thinking as string);
            break;
          case "toolCall": {
            const name = block.name as string;
            if (!name) break;
            const toolId = (block.id as string) || "";
            const input = (block.arguments as Record<string, unknown>) || {};
            if (toolId) {
              toolUseIdToName.set(toolId, name);
              toolUseIdToInput.set(toolId, input);
            }
            toolCalls.push({ id: toolId, name, input });
            break;
          }
        }
      }
      capIdMap();
      const assistantText = texts.join("\n").trim() || null;
      const thinking = thinkings.join("\n").trim() || null;
      return { assistantText, thinking, questions: null, toolCalls, toolResults: [], backgroundJobEvents: [] };
    }

    if (m.role === "toolResult") {
      const toolName = (m.toolName as string) || toolUseIdToName.get(m.toolCallId as string) || "";
      const isError = m.isError === true;
      if (!isError && !FORWARD_RESULT_TOOLS.has(toolName)) return EMPTY_PARSED;
      const content = m.content as Array<{ type: string; text?: string }>;
      const text = content
        .filter((s) => s.type === "text")
        .map((s) => s.text ?? "")
        .join("\n")
        .trim();
      if (isError && isToolRejection(text)) return EMPTY_PARSED;
      if (!text) return EMPTY_PARSED;
      return { ...EMPTY_PARSED, toolResults: [{ toolName: toolName || "unknown", content: text, isError }] };
    }

    return EMPTY_PARSED;
  }

  // Claude tool results
  if (msg.type === "user") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (!m?.content || !Array.isArray(m.content)) return EMPTY_PARSED;
    const content = m.content as Array<Record<string, unknown>>;
    const toolResults: ToolResultInfo[] = [];
    const backgroundJobEvents: BackgroundJobEventInfo[] = [];
    const seenBackgroundIds = new Set<string>();
    const rootToolUseResult = msg.toolUseResult as Record<string, unknown> | undefined;
    const rootBackgroundTaskId = typeof rootToolUseResult?.backgroundTaskId === "string"
      ? rootToolUseResult.backgroundTaskId
      : undefined;
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const toolUseId = (block.tool_use_id as string) || "";
      const toolName = toolUseIdToName.get(toolUseId) ?? "";
      const isError = block.is_error === true;
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
      if (isError && isToolRejection(text)) continue;
      const trimmedText = text.trim();

      const commandInput = toolUseIdToInput.get(toolUseId);
      const command = typeof commandInput?.command === "string" ? commandInput.command : undefined;

      const stoppedTask = extractStoppedTaskFromResult(trimmedText, rootToolUseResult);
      if (stoppedTask?.taskId && !seenBackgroundIds.has(stoppedTask.taskId)) {
        seenBackgroundIds.add(stoppedTask.taskId);
        backgroundJobEvents.push({
          taskId: stoppedTask.taskId,
          status: "killed",
          command: stoppedTask.command || command,
          urls: mergeUrls(
            extractUrls(trimmedText),
            inferUrlsFromCommand(stoppedTask.command || command)
          ),
        });
      }

      const shouldForwardToolResult = isError || FORWARD_RESULT_TOOLS.has(toolName);
      if (trimmedText && shouldForwardToolResult) {
        toolResults.push({ toolName: toolName || "unknown", content: trimmedText, isError });
      }

      const startedIdFromText = trimmedText.match(/Command running in background with ID:\s*([A-Za-z0-9_-]+)/i)?.[1];
      const taskId = startedIdFromText || rootBackgroundTaskId;
      if (taskId && !seenBackgroundIds.has(taskId)) {
        seenBackgroundIds.add(taskId);
        const outputFile = trimmedText.match(/Output is being written to:\s*([^\s]+)/i)?.[1];
        const urls = mergeUrls(extractUrls(trimmedText), inferUrlsFromCommand(command));
        backgroundJobEvents.push({
          taskId,
          status: "running",
          command,
          outputFile,
          urls,
        });
      }
    }
    if (toolResults.length === 0 && backgroundJobEvents.length === 0) return EMPTY_PARSED;
    return { ...EMPTY_PARSED, toolResults, backgroundJobEvents };
  }

  // Claude queue notifications for background job lifecycle
  if (msg.type === "queue-operation") {
    const operation = (msg.operation as string) || "";
    if (operation !== "enqueue") return EMPTY_PARSED;
    const content = (msg.content as string) || "";
    if (!content.includes("<task-notification>")) return EMPTY_PARSED;
    const taskId = extractTaskNotificationTag(content, "task-id");
    const statusRaw = (extractTaskNotificationTag(content, "status") || "").toLowerCase();
    if (!taskId || !statusRaw) return EMPTY_PARSED;
    const summary = extractTaskNotificationTag(content, "summary");
    const outputFile = extractTaskNotificationTag(content, "output-file");
    const urls = extractUrls(content);
    const commandMatch = summary?.match(/Background command \"([\\s\\S]+?)\" was/i);
    const command = commandMatch?.[1];
    let status: BackgroundJobEventInfo["status"] | null = null;
    if (statusRaw === "running" || statusRaw === "started" || statusRaw === "start") status = "running";
    else if (statusRaw === "completed" || statusRaw === "done" || statusRaw === "success") status = "completed";
    else if (statusRaw === "failed" || statusRaw === "error") status = "failed";
    else if (statusRaw === "killed" || statusRaw === "stopped" || statusRaw === "terminated") status = "killed";
    if (!status) return EMPTY_PARSED;
    return {
      ...EMPTY_PARSED,
      backgroundJobEvents: [{
        taskId,
        status,
        summary,
        outputFile,
        command,
        urls: urls.length > 0 ? urls : undefined,
      }],
    };
  }

  // Codex event_msg — assistant text or reasoning
  if (msg.type === "event_msg") {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (!payload) return EMPTY_PARSED;
    if (payload.type === "agent_message" && typeof payload.message === "string") {
      const t = (payload.message as string).trim();
      return t ? { ...EMPTY_PARSED, assistantText: t } : EMPTY_PARSED;
    }
    if (payload.type === "agent_reasoning" && typeof payload.text === "string") {
      const t = (payload.text as string).trim();
      return t ? { ...EMPTY_PARSED, thinking: t } : EMPTY_PARSED;
    }
    return EMPTY_PARSED;
  }

  // Codex response_item — tool calls or tool results
  if (msg.type === "response_item") {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (!payload) return EMPTY_PARSED;

    if (payload.type === "function_call" && typeof payload.name === "string") {
      const callId = (payload.call_id as string) || "";
      if (callId) toolUseIdToName.set(callId, payload.name);
      let input: Record<string, unknown> = {};
      if (typeof payload.arguments === "string") {
        try { input = JSON.parse(payload.arguments); } catch {}
      }
      if (callId) toolUseIdToInput.set(callId, input);
      capIdMap();
      return { ...EMPTY_PARSED, toolCalls: [{ id: callId, name: payload.name, input }] };
    }

    if (payload.type === "custom_tool_call" && typeof payload.name === "string") {
      const callId = (payload.call_id as string) || "";
      if (callId) toolUseIdToName.set(callId, payload.name);
      const input: Record<string, unknown> = typeof payload.input === "string"
        ? { content: payload.input }
        : {};
      if (callId) toolUseIdToInput.set(callId, input);
      capIdMap();
      return { ...EMPTY_PARSED, toolCalls: [{ id: callId, name: payload.name, input }] };
    }

    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const callId = (payload.call_id as string) || "";
      const toolName = toolUseIdToName.get(callId) ?? "";
      const input = callId ? toolUseIdToInput.get(callId) : undefined;
      const output = (payload.output as string) ?? "";
      const trimmedOutput = output.trim();
      if (!trimmedOutput) return EMPTY_PARSED;

      const backgroundJobEvents: BackgroundJobEventInfo[] = [];

      if (toolName === "exec_command" || toolName === "write_stdin") {
        const sessionIdFromOutput = trimmedOutput.match(/Process running with session ID\s*([0-9]+)/i)?.[1];
        const sessionIdFromInput = normalizeCodexSessionId(input?.session_id);
        const sessionId = sessionIdFromOutput || sessionIdFromInput;
        const commandFromInput = typeof input?.cmd === "string" ? input.cmd : undefined;
        const commandFromCache = sessionId ? codexSessionIdToCommand.get(sessionId) : undefined;
        const command = commandFromInput || commandFromCache;

        if (sessionId && commandFromInput && toolName === "exec_command") {
          codexSessionIdToCommand.set(sessionId, commandFromInput);
          while (codexSessionIdToCommand.size > 200) {
            const first = codexSessionIdToCommand.keys().next().value as string | undefined;
            if (!first) break;
            codexSessionIdToCommand.delete(first);
          }
        }

        if (sessionIdFromOutput && sessionId) {
          backgroundJobEvents.push({
            taskId: sessionId,
            status: "running",
            command,
            urls: mergeUrls(extractUrls(trimmedOutput), inferUrlsFromCommand(command)),
          });
        }

        const exitStatus = detectCodexExitStatus(trimmedOutput);
        if (sessionId && exitStatus) {
          const inferredUrls = inferUrlsFromCommand(command);
          backgroundJobEvents.push({
            taskId: sessionId,
            status: exitStatus,
            command,
            urls: inferredUrls.length > 0 ? inferredUrls : undefined,
          });
          codexSessionIdToCommand.delete(sessionId);
        }
      }

      const toolResults: ToolResultInfo[] = [];
      if (FORWARD_RESULT_TOOLS.has(toolName)) {
        toolResults.push({ toolName: toolName || "unknown", content: trimmedOutput, isError: false });
      }

      if (toolResults.length === 0 && backgroundJobEvents.length === 0) return EMPTY_PARSED;
      return { ...EMPTY_PARSED, toolResults, backgroundJobEvents };
    }
  }

  return EMPTY_PARSED;
}

function capIdMap() {
  while (toolUseIdToName.size > 200) {
    const first = toolUseIdToName.keys().next().value!;
    toolUseIdToName.delete(first);
    toolUseIdToInput.delete(first);
  }
  while (toolUseIdToInput.size > 200) {
    const first = toolUseIdToInput.keys().next().value!;
    toolUseIdToInput.delete(first);
    toolUseIdToName.delete(first);
  }
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

function encodeBracketedPaste(text: string): Buffer {
  // Strip the bracketed paste terminator and other control sequences from input
  // to prevent escaping the paste context (terminal escape injection)
  const sanitized = text.replace(/\x1b\[[0-9;]*[a-zA-Z~]/g, "");
  return Buffer.from(`\x1b[200~${sanitized}\x1b[201~`);
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
  onBackgroundJobEvent?: (events: BackgroundJobEventInfo[]) => void,
  onMessageParsed?: (msg: Record<string, unknown>) => void,
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
        let totalBytesRead = 0;
        try {
          while (totalBytesRead < bytesToRead) {
            const { bytesRead } = await fd.read(
              buffer,
              totalBytesRead,
              bytesToRead - totalBytesRead,
              byteOffset + totalBytesRead
            );
            if (bytesRead === 0) break;
            totalBytesRead += bytesRead;
          }
        } finally {
          await fd.close();
        }
        if (totalBytesRead === 0) break;
        byteOffset += totalBytesRead;

        // Split into lines, prepending any partial line from last read
        const chunk = partial + buffer.toString("utf-8", 0, totalBytesRead);
        const lines = chunk.split("\n");

        // Last element is either empty (chunk ended with \n) or a partial line
        partial = lines.pop() ?? "";

        for (const line of lines) {
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (onMessageParsed) onMessageParsed(msg);
            const parsed = parseJsonlMessage(msg);
            if (parsed.assistantText) onAssistant(parsed.assistantText);
            if (onQuestion && parsed.questions) onQuestion(parsed.questions);
            if (onToolCall && parsed.toolCalls.length > 0) onToolCall(parsed.toolCalls);
            if (onToolResult && parsed.toolResults.length > 0) onToolResult(parsed.toolResults);
            if (onBackgroundJobEvent && parsed.backgroundJobEvents.length > 0) {
              onBackgroundJobEvent(parsed.backgroundJobEvents);
            }
            if (onThinking && parsed.thinking) onThinking(parsed.thinking);
          } catch {} // skip malformed JSONL lines
        }

        // Re-check if events arrived while we were processing
        if (pendingRecheck || totalBytesRead < bytesToRead) hasMore = true;
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

// Resolve --channel flag value to a chatId from available options.
// Returns the chatId to bind, or null for "none" (no binding).
function resolveChannelFlag(
  value: string,
  options: Array<{ chatId: string; title: string; type: string; busy: boolean }>,
  ownerDmChatId: string
): string | null {
  const v = value.trim().toLowerCase();

  // "none" — skip binding
  if (v === "none") return null;

  // "dm" keyword → owner DM
  if (v === "dm") return ownerDmChatId;

  // Exact chatId match (e.g. "telegram:-987:12")
  const exactMatch = options.find((o) => o.chatId === value);
  if (exactMatch) return exactMatch.chatId;

  // Case-insensitive title substring match
  const titleMatches = options.filter(
    (o) => o.chatId && o.title.toLowerCase().includes(v)
  );

  if (titleMatches.length === 1) return titleMatches[0].chatId;

  if (titleMatches.length > 1) {
    console.error(`Ambiguous --channel "${value}". Multiple matches:`);
    for (const m of titleMatches) {
      const typeLabel = m.type === "dm" ? "DM" : m.type === "group" ? "Group" : "Topic";
      const busyTag = m.busy ? ` (busy)` : "";
      console.error(`  ${m.title}  (${typeLabel})  ${m.chatId}${busyTag}`);
    }
    console.error(`\nUse a more specific title or the full chatId.`);
    process.exit(1);
  }

  // No match found
  console.error(`Channel not found: "${value}"`);
  console.error(`Run \`tg channels\` to see available channels.`);
  process.exit(1);
}

interface ChannelPickerOption {
  label: string;
  chatId: string;
  busy: boolean;
  busyLabel?: string | null;
  title: string;
  type: string;
}

function buildChannelPickerOptions(
  channels: Array<{ chatId: string; title: string; type: string; busy: boolean; busyLabel?: string | null }>
): ChannelPickerOption[] {
  const options: ChannelPickerOption[] = [];
  options.push({ label: "No channel", chatId: "", busy: false, busyLabel: null, title: "No channel", type: "none" });

  const dms = channels.filter((c) => c.type === "dm");
  const groups = channels.filter((c) => c.type === "group");
  const topics = channels.filter((c) => c.type === "topic");

  for (const dm of dms) {
    const suffix = dm.busy && dm.busyLabel ? `\x1b[2m(DM) ← ${dm.busyLabel}\x1b[22m` : "\x1b[2m(DM)\x1b[22m";
    options.push({
      label: `${dm.title} ${suffix}`,
      chatId: dm.chatId,
      busy: dm.busy,
      busyLabel: dm.busyLabel,
      title: dm.title,
      type: "dm",
    });
  }

  const groupByChatId = new Set(groups.map((g) => g.chatId));
  for (const group of groups) {
    const suffix = group.busy && group.busyLabel ? `\x1b[2m(Group) ← ${group.busyLabel}\x1b[22m` : "\x1b[2m(Group)\x1b[22m";
    options.push({
      label: `${group.title} ${suffix}`,
      chatId: group.chatId,
      busy: group.busy,
      busyLabel: group.busyLabel,
      title: group.title,
      type: "group",
    });

    for (const topic of topics) {
      const parts = topic.chatId.split(":");
      if (parts.length < 3) continue;
      const parent = `${parts[0]}:${parts[1]}`;
      if (parent !== group.chatId) continue;
      const topicSuffix = topic.busy && topic.busyLabel ? `\x1b[2m(Topic) ← ${topic.busyLabel}\x1b[22m` : "\x1b[2m(Topic)\x1b[22m";
      options.push({
        label: `  ${topic.title} ${topicSuffix}`,
        chatId: topic.chatId,
        busy: topic.busy,
        busyLabel: topic.busyLabel,
        title: topic.title,
        type: "topic",
      });
    }
  }

  for (const topic of topics) {
    const parts = topic.chatId.split(":");
    if (parts.length < 3) continue;
    const parent = `${parts[0]}:${parts[1]}`;
    if (groupByChatId.has(parent)) continue;
    const suffix = topic.busy && topic.busyLabel ? `\x1b[2m(Topic) ← ${topic.busyLabel}\x1b[22m` : "\x1b[2m(Topic)\x1b[22m";
    options.push({
      label: `  ${topic.title} ${suffix}`,
      chatId: topic.chatId,
      busy: topic.busy,
      busyLabel: topic.busyLabel,
      title: topic.title,
      type: "topic",
    });
  }

  return options;
}

function stripCodexTransportArgs(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (arg === "--json") continue;
    out.push(arg);
  }
  return out;
}

interface ParsedCodexResumeArgs {
  baseArgs: string[];
  resumeId: string | null;
  useResumeLast: boolean;
}

function parseCodexResumeArgs(args: string[]): ParsedCodexResumeArgs {
  let baseArgs = stripCodexTransportArgs(args);
  let resumeId: string | null = null;
  let useResumeLast = false;

  // Codex accepts global flags before subcommands, so find "resume" anywhere.
  const resumeSubcommandIdx = baseArgs.indexOf("resume");
  if (resumeSubcommandIdx !== -1) {
    baseArgs = [...baseArgs.slice(0, resumeSubcommandIdx), ...baseArgs.slice(resumeSubcommandIdx + 1)];
    if (resumeSubcommandIdx < baseArgs.length && !baseArgs[resumeSubcommandIdx].startsWith("-")) {
      resumeId = baseArgs[resumeSubcommandIdx];
      baseArgs = [...baseArgs.slice(0, resumeSubcommandIdx), ...baseArgs.slice(resumeSubcommandIdx + 1)];
    } else if (baseArgs.includes("--last")) {
      useResumeLast = true;
    }
  }

  // Also support explicit --resume/-r forms.
  const resumeIdx = baseArgs.findIndex((a) => a === "--resume" || a === "-r");
  if (!resumeId && resumeIdx !== -1) {
    if (resumeIdx + 1 < baseArgs.length) {
      resumeId = baseArgs[resumeIdx + 1];
    }
    baseArgs = [...baseArgs.slice(0, resumeIdx), ...baseArgs.slice(resumeIdx + 2)];
  }

  if (!resumeId) {
    const resumeEq = baseArgs.find((a) => a.startsWith("--resume="));
    if (resumeEq) {
      const value = resumeEq.slice("--resume=".length);
      if (value) resumeId = value;
      baseArgs = baseArgs.filter((a) => a !== resumeEq);
    }
  }

  // Strip explicit exec subcommand if user passed it.
  const execIdx = baseArgs.indexOf("exec");
  if (execIdx !== -1) {
    baseArgs = [...baseArgs.slice(0, execIdx), ...baseArgs.slice(execIdx + 1)];
  }

  // --last is only meaningful for resume mode in this adapter.
  if (!resumeId && baseArgs.includes("--last")) {
    useResumeLast = true;
  }
  baseArgs = baseArgs.filter((a) => a !== "--last");

  return { baseArgs, resumeId, useResumeLast };
}

function findCodexSessionFileById(resumeId: string): string | null {
  const codexRoot = join(homedir(), ".codex", "sessions");
  const searchDir = (dir: string): string | null => {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const found = searchDir(join(dir, entry.name));
          if (found) return found;
        } else if (entry.name.endsWith(".jsonl") && entry.name.includes(resumeId)) {
          return join(dir, entry.name);
        }
      }
    } catch {}
    return null;
  };
  return searchDir(codexRoot);
}

function findLatestCodexSessionFile(): string | null {
  const codexRoot = join(homedir(), ".codex", "sessions");
  let newestPath: string | null = null;
  let newestMtime = 0;

  const scanDir = (dir: string): void => {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
          continue;
        }
        if (!entry.name.endsWith(".jsonl")) continue;
        const s = statSync(fullPath);
        if (s.mtimeMs > newestMtime) {
          newestMtime = s.mtimeMs;
          newestPath = fullPath;
        }
      }
    } catch {}
  };

  scanDir(codexRoot);
  return newestPath;
}

interface ParsedKimiResumeArgs {
  baseArgs: string[];
  sessionId: string | null;
  useContinue: boolean;
}

function parseKimiResumeArgs(args: string[]): ParsedKimiResumeArgs {
  let sessionId: string | null = null;
  let useContinue = false;
  const baseArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--session" || arg === "-S") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        sessionId = next;
        i++;
      }
      continue;
    }

    if (arg.startsWith("--session=")) {
      const value = arg.slice("--session=".length).trim();
      if (value) sessionId = value;
      continue;
    }

    if (arg.startsWith("-S=")) {
      const value = arg.slice("-S=".length).trim();
      if (value) sessionId = value;
      continue;
    }

    if (arg === "--continue" || arg === "-C" || arg.startsWith("--continue=") || arg.startsWith("-C=")) {
      useContinue = true;
      continue;
    }

    baseArgs.push(arg);
  }

  return { baseArgs, sessionId, useContinue };
}

function listKimiSessionWireFiles(kimiProjectRoot: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(kimiProjectRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(kimiProjectRoot, entry.name, "wire.jsonl");
      try {
        const st = statSync(candidate);
        if (st.isFile()) files.push(candidate);
      } catch {}
    }
  } catch {}
  return files;
}

function findKimiSessionFileById(kimiProjectRoot: string, sessionId: string): string | null {
  if (!sessionId) return null;
  const direct = join(kimiProjectRoot, sessionId, "wire.jsonl");
  try {
    const st = statSync(direct);
    if (st.isFile()) return direct;
  } catch {}

  for (const filePath of listKimiSessionWireFiles(kimiProjectRoot)) {
    if (filePath.includes(sessionId)) return filePath;
  }
  return null;
}

function findLatestKimiSessionFile(kimiProjectRoot: string): string | null {
  let newest: string | null = null;
  let newestMtime = 0;
  for (const filePath of listKimiSessionWireFiles(kimiProjectRoot)) {
    try {
      const st = statSync(filePath);
      if (st.mtimeMs > newestMtime) {
        newestMtime = st.mtimeMs;
        newest = filePath;
      }
    } catch {}
  }
  return newest;
}

function stripFlagWithOptionalValue(args: string[], longFlag: string, shortFlag?: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === longFlag || (shortFlag && arg === shortFlag)) {
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) i++;
      continue;
    }
    if (arg.startsWith(`${longFlag}=`)) continue;
    out.push(arg);
  }
  return out;
}

// Reject shell metacharacters in session refs — allow alphanumeric, paths, UUIDs
const UNSAFE_SESSION_REF = /[;&|`$(){}!#<>\\'"]/;

function buildResumeCommandArgs(
  command: "claude" | "codex" | "pi" | "kimi",
  currentArgs: string[],
  sessionRef: string
): string[] {
  // Validate sessionRef to prevent shell injection (command is passed to sh -c in some contexts)
  if (!sessionRef || UNSAFE_SESSION_REF.test(sessionRef)) {
    throw new Error(`Invalid session reference: ${sessionRef}`);
  }
  if (command === "claude") {
    const cleaned = stripFlagWithOptionalValue(
      stripFlagWithOptionalValue(currentArgs, "--continue", "-c"),
      "--resume",
      "-r"
    );
    return [...cleaned, "--resume", sessionRef];
  }

  if (command === "codex") {
    const parsed = parseCodexResumeArgs(currentArgs);
    return [...parsed.baseArgs, "resume", sessionRef];
  }

  if (command === "kimi") {
    const withoutContinue = stripFlagWithOptionalValue(currentArgs, "--continue", "-C");
    const withoutSession = stripFlagWithOptionalValue(withoutContinue, "--session", "-S");
    return [...withoutSession, "--session", sessionRef];
  }

  const withoutContinue = stripFlagWithOptionalValue(currentArgs, "--continue", "-c");
  const withoutResume = stripFlagWithOptionalValue(withoutContinue, "--resume", "-r");
  const withoutSession = stripFlagWithOptionalValue(withoutResume, "--session");
  return [...withoutSession, "--session", sessionRef];
}

export async function runRun(): Promise<void> {
  // Determine command: `tg claude [args]`, `tg codex [args]`, `tg pi [args]`, or `tg kimi [args]`
  const initialCmdName = process.argv[2] as SupportedCommand | undefined;
  let cmdArgs = process.argv.slice(3);

  if (!initialCmdName || !SUPPORTED_COMMANDS[initialCmdName]) {
    console.error(`Usage: tg claude [args...], tg codex [args...], tg pi [args...], or tg kimi [args...]`);
    process.exit(1);
  }
  let currentTool: SupportedCommand = initialCmdName;

  let channelFlag: string | null = null;
  const channelIdx = cmdArgs.indexOf("--channel");
  if (channelIdx !== -1) {
    if (channelIdx + 1 >= cmdArgs.length) {
      console.error("--channel requires a value (e.g. --channel dm, --channel \"Dev Team\", or --channel telegram:-123)");
      process.exit(1);
    }
    channelFlag = cmdArgs[channelIdx + 1];
    cmdArgs = [...cmdArgs.slice(0, channelIdx), ...cmdArgs.slice(channelIdx + 2)];
  }
  const preferredChannelTypeFromFlag = channelFlag && channelFlag.includes(":")
    ? getChannelType(channelFlag)
    : undefined;
  const preferredChannelNameFromFlag = channelFlag && channelFlag.includes(":")
    ? getChannelName(channelFlag)
    : undefined;

  // Install Claude Code hooks for structured lifecycle events (replaces PTY scanning)
  if (currentTool === "claude") {
    const { installClaudeHooks } = await import("../hooks/installer");
    await installClaudeHooks().catch(() => {}); // non-fatal
  }

  // Warn if the tool version is too old
  await checkToolVersion(currentTool);

  let fullCommand = [SUPPORTED_COMMANDS[currentTool][0], ...cmdArgs].join(" ");
  const displayName = process.cwd().split("/").pop() || "";

  // Try to register with daemon as a remote session
  let remoteId: string | null = null;
  let channel: Channel | null = null;
  let chatId: ChannelChatId | null = null;
  let ownerUserId: string | null = null;
  let didBindChat = false;

  try {
    const config = await loadConfig();
    const preflight = validateRunSetupPreflight(config);
    if (!preflight.ok) {
      console.error(preflight.message || "touchgrass setup is incomplete.");
      if (preflight.details) console.error(preflight.details);
      process.exit(1);
    }
    const ownerCandidates = listOwnerChannels(config);
    let preferredOwnerType = preferredChannelTypeFromFlag;
    let preferredOwnerName = preferredChannelNameFromFlag;
    let selectedChatForBind: ChannelChatId | null = null;
    let selectedLabelForPrint: string | null = null;
    let selectedFromFlag = false;

    try {
      await ensureDaemon();
      const channelRes = await daemonRequest("/channels");
      const daemonChannels = (channelRes.channels as Array<{ chatId: string; title: string; type: string; busy: boolean; busyLabel?: string | null }>) || [];
      if (daemonChannels.length === 0) {
        console.error("No channels available.");
        console.error("Run `tg setup` and `tg pair`, then verify with `tg channels`.");
        process.exit(1);
      }
      const pickerOptions = buildChannelPickerOptions(daemonChannels);
      const defaultOwner = resolveOwnerChannel(config, preferredOwnerType, preferredOwnerName) || ownerCandidates[0];

      if (channelFlag) {
        const resolvedChatId = resolveChannelFlag(channelFlag, pickerOptions, defaultOwner.ownerChatId);
        if (resolvedChatId) {
          selectedChatForBind = resolvedChatId as ChannelChatId;
          preferredOwnerType = getChannelType(resolvedChatId);
          preferredOwnerName = getChannelName(resolvedChatId);
          const chosen = pickerOptions.find((o) => o.chatId === resolvedChatId);
          if (chosen) {
            const typeLabel = chosen.type === "dm" ? "DM" : chosen.type === "group" ? "Group" : chosen.type === "topic" ? "Topic" : "";
            selectedLabelForPrint = `${chosen.title} (${typeLabel})`;
          }
        } else {
          selectedLabelForPrint = "No channel";
        }
        selectedFromFlag = true;
      } else {
        // No --channel flag: auto-bind to DM, let user use /start_remote_control from any chat
        selectedLabelForPrint = null;
      }
    } catch (e) {
      console.error("Failed to load channels from daemon.");
      console.error("Run `tg setup` and `tg pair`, then verify with `tg channels`.");
      console.error(`Details: ${(e as Error).message}`);
      process.exit(1);
    }

    let owner = resolveOwnerChannel(config, preferredOwnerType, preferredOwnerName);
    if (!owner) owner = ownerCandidates[0];
    if (!owner) {
      console.error("No usable paired channel owner found.");
      process.exit(1);
    }

    const resolvedChannelName = owner.channelName;
    const resolvedChannelConfig = owner.channelConfig;
    ownerUserId = owner.ownerUserId;
    chatId = owner.ownerChatId;

    if (selectedChatForBind && getChannelType(selectedChatForBind) !== owner.channelConfig.type) {
      const msg = `Selected channel ${selectedChatForBind} does not match configured owner channel type (${owner.channelConfig.type}).`;
      if (selectedFromFlag) {
        console.error(msg);
        process.exit(1);
      }
      console.error(`\x1b[33m⚠ ${msg} Skipping bind for this run.\x1b[0m`);
      selectedChatForBind = null;
      selectedLabelForPrint = "No channel";
    }

    try {
      await ensureDaemon();
      const res = await daemonRequest("/remote/register", "POST", {
        command: fullCommand,
        chatId,
        ownerUserId,
        cwd: process.cwd(),
      });
      if (!res.ok || !res.sessionId) {
        console.error("Failed to register remote session.");
        console.error("Run `tg setup` and `tg pair`, then verify with `tg channels`.");
        process.exit(1);
      }

      remoteId = res.sessionId as string;

      // Only bind to a chat if user explicitly passed --channel
      const targetBindChat = selectedChatForBind;

      if (targetBindChat) {
        try {
          await daemonRequest("/remote/bind-chat", "POST", {
            sessionId: remoteId,
            chatId: targetBindChat,
            ownerUserId,
          });
          chatId = targetBindChat as ChannelChatId;
          didBindChat = true;
        } catch (bindErr) {
          const errText = `\x1b[33m⚠ ${(bindErr as Error).message}\x1b[0m`;
          console.error(`${errText}. Continuing without channel binding.`);
        }
      }

      // Always print touchgrass banner
      const channelTypes = [...new Set(Object.values(config.channels).map(c => c.type))];
      const channelLabel = channelTypes.length > 0
        ? channelTypes.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(", ")
        : "chat";
      console.log(`⛳ touchgrass · /start_remote_control to connect from ${channelLabel}`);
      if (selectedLabelForPrint) {
        console.log(`  Channel: ${selectedLabelForPrint}`);
      }
    } catch (e) {
      console.error("Failed to register session with daemon.");
      console.error("Run `tg setup` and `tg pair`, then verify with `tg channels`.");
      console.error(`Details: ${(e as Error).message}`);
      process.exit(1);
    }

    // Set up channel for JSONL watching
    channel = createChannel(resolvedChannelName, resolvedChannelConfig);
  } catch (e) {
    console.error("Failed to load touchgrass config.");
    console.error(`Run \`tg setup\` first. Config path: ${paths.config}`);
    console.error(`Details: ${(e as Error).message}`);
    process.exit(1);
  }

  // Print agent banner if running inside an agent project
  try {
    const { readAgentSoul } = await import("../daemon/agent-soul");
    const soul = await readAgentSoul(process.cwd());
    if (soul?.name) {
      const BOLD = "\x1b[1m";
      const DIM = "\x1b[2m";
      const RESET = "\x1b[0m";
      const { renderTerminal, encodeDNA, EYES, MOUTHS, HATS, BODIES, LEGS } = await import("termlings");
      // Use explicit DNA or derive a deterministic one from the agent name
      let dna = soul.dna;
      if (!dna) {
        let hash = 0;
        for (let i = 0; i < soul.name.length; i++) {
          hash = soul.name.charCodeAt(i) + ((hash << 5) - hash);
        }
        hash = Math.abs(hash);
        dna = encodeDNA({
          eyes: hash % EYES.length,
          mouth: (hash >> 4) % MOUTHS.length,
          hat: (hash >> 8) % HATS.length,
          body: (hash >> 14) % BODIES.length,
          legs: (hash >> 18) % LEGS.length,
          faceHue: (hash >> 22) % 12,
          hatHue: (hash >> 26) % 12,
        });
      }
      const avatar = renderTerminal(dna);
      const avatarLines = avatar.split("\n");
      const info = [
        `${BOLD}${soul.name}${RESET}`,
        soul.purpose ? `${DIM}${soul.purpose}${RESET}` : "",
        `${DIM}Touchgrass agent${soul.coreVersion ? ` v${soul.coreVersion}` : ""}${RESET}`,
      ].filter(Boolean);
      const avatarWidth = 18; // 9 columns × 2 chars per pixel (██)
      const visLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
      const infoStart = Math.max(0, Math.floor((avatarLines.length - info.length) / 2));
      const merged: string[] = [];
      for (let i = 0; i < avatarLines.length; i++) {
        const left = avatarLines[i];
        const pad = " ".repeat(Math.max(0, avatarWidth - visLen(left)));
        const right = info[i - infoStart] ?? "";
        merged.push(`${left}${pad}  ${right}`);
      }
      console.log(merged.join("\n"));
      const cols = process.stdout.columns || 80;
      console.log(`\x1b[2m${"─".repeat(cols)}\x1b[0m`);
    }
  } catch {
    // Non-fatal — no agent soul
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

  // Use raw mode if stdin is a TTY so keypresses are forwarded immediately
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  let finalExitCode: number | null = null;
  while (true) {
    const cmdName = currentTool;
    const executable = SUPPORTED_COMMANDS[cmdName][0];
    fullCommand = [executable, ...cmdArgs].join(" ");
    if (manifest) {
      manifest.command = fullCommand;
      writeManifest(manifest).catch(() => {});
    }

    // Detect resume flags to find existing session JSONL file
    // - Claude: --resume <session-id>
    // - Codex: resume <session-id>
    // - PI: --continue/-c (latest session), --session <path>
    // - Kimi: --session <session-id>, --continue/-C (latest session)
    let resumeSessionFile: string | null = null;

    // Snapshot existing JSONL files BEFORE spawning so the tool's new file is detected
    const projectDir = channel && chatId ? getSessionDir(cmdName) : "";
    const existingFiles = new Set<string>();
    if (projectDir) {
      if (cmdName === "kimi") {
        for (const filePath of listKimiSessionWireFiles(projectDir)) {
          existingFiles.add(filePath);
        }
      } else {
        try {
          for (const f of readdirSync(projectDir)) {
            if (f.endsWith(".jsonl")) existingFiles.add(f);
          }
        } catch {}
      }

      // Check for resume session ID in args
      let resumeId: string | null = null;
      let codexResumeLast = false;
      let kimiResumeContinue = false;
      if (cmdName === "codex") {
        const parsed = parseCodexResumeArgs(cmdArgs);
        resumeId = parsed.resumeId;
        codexResumeLast = parsed.useResumeLast;
      } else if (cmdName === "kimi") {
        const parsed = parseKimiResumeArgs(cmdArgs);
        resumeId = parsed.sessionId;
        kimiResumeContinue = parsed.useContinue;
      } else if (cmdName === "pi") {
        const sessionIdx = cmdArgs.findIndex((a) => a === "--session");
        if (sessionIdx !== -1 && sessionIdx + 1 < cmdArgs.length) {
          resumeId = cmdArgs[sessionIdx + 1];
        }
        if (!resumeId) {
          const sessionEq = cmdArgs.find((a) => a.startsWith("--session="));
          if (sessionEq) {
            const value = sessionEq.slice("--session=".length);
            if (value) resumeId = value;
          }
        }
      } else {
        const resumeIdx = cmdArgs.findIndex((a) => a === "--resume" || a === "-r");
        if (resumeIdx !== -1 && resumeIdx + 1 < cmdArgs.length) {
          resumeId = cmdArgs[resumeIdx + 1];
        }
        if (!resumeId) {
          const resumeEq = cmdArgs.find((a) => a.startsWith("--resume="));
          if (resumeEq) {
            const value = resumeEq.slice("--resume=".length);
            if (value) resumeId = value;
          }
        }
      }

      if (resumeId) {
        // Search for JSONL file matching the session ID
        try {
          if (cmdName === "kimi") {
            resumeSessionFile = findKimiSessionFileById(projectDir, resumeId);
          } else if (cmdName === "pi") {
            const candidate = resumeId.endsWith(".jsonl")
              ? (resumeId.startsWith("/") ? resumeId : join(projectDir, resumeId))
              : "";
            if (candidate) {
              try {
                const st = statSync(candidate);
                if (st.isFile()) resumeSessionFile = candidate;
              } catch {}
            }
            if (!resumeSessionFile) {
              // PI fallback: filename match in project dir.
              for (const f of existingFiles) {
                if (f.includes(resumeId)) {
                  resumeSessionFile = join(projectDir, f);
                  break;
                }
              }
            }
          } else {
            // Claude: <id>.jsonl in project dir, or filename contains ID
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
              resumeSessionFile = findCodexSessionFileById(resumeId);
            }
          }
        } catch {}
      }

      // Codex resume --last should tail whichever session file was active most recently.
      if (!resumeSessionFile && cmdName === "codex" && codexResumeLast) {
        resumeSessionFile = findLatestCodexSessionFile();
      }

      // Kimi --continue/-C should tail whichever session file was active most recently.
      if (!resumeSessionFile && cmdName === "kimi" && kimiResumeContinue) {
        resumeSessionFile = findLatestKimiSessionFile(projectDir);
      }

      // PI --continue/-c: use the most recent JSONL file
      if (!resumeSessionFile && cmdName === "pi" && (cmdArgs.includes("--continue") || cmdArgs.includes("-c"))) {
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

    // PTY output buffer for detecting approval prompts (per-CLI patterns)
    // Claude uses hooks for structured lifecycle events — skip PTY scanning
    const approvalPattern = cmdName !== "claude" ? APPROVAL_PATTERNS[cmdName] : undefined;
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

    let requestedResumeSessionRef: string | null = null;
    let stayAliveAfterKill = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
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
        ...(remoteId ? { TG_SESSION_ID: remoteId } : {}),
        // Prevent "cannot be launched inside another Claude Code session" when
        // the tg wrapper itself runs inside a Claude Code PTY (e.g. touchgrass-app).
        CLAUDECODE: undefined,
      },
    });

    const terminal = proc.terminal!;

    // Prevent idle sleep on macOS while the tool is running
    let caffeinateProc: { kill(): void } | null = null;
    if (platform() === "darwin") {
      try {
        caffeinateProc = Bun.spawn(["caffeinate", "-i", "-w", String(proc.pid)], {
          stdout: "ignore",
          stderr: "ignore",
        });
      } catch {}
    }

    // Forward stdin to the PTY
    const onStdinData = (data: Buffer) => {
      terminal.write(data);
    };
    process.stdin.on("data", onStdinData);

    // Handle terminal resize
    const onResize = () => {
      terminal.resize(process.stdout.columns, process.stdout.rows);
    };
    process.stdout.on("resize", onResize);

    // Track group chats subscribed to this session's output
    const subscribedGroups = new Set<ChannelChatId>();
    // Track which chat this session is bound to (may differ from chatId if bound to a group)
    let boundChat: ChannelChatId | null = remoteId && didBindChat ? chatId : null;
    let nullBoundPolls = 0;
    let groupPollTimer: ReturnType<typeof setInterval> | null = null;
    const getPrimaryTargetChat = (): ChannelChatId | null => remoteId ? boundChat : chatId;
    if (remoteId && chatId && ownerUserId) {
      const pollRemoteId = remoteId;
      const pollBinding = async () => {
        try {
          const res = await daemonRequest(`/remote/${pollRemoteId}/subscribed-groups`);
          const chatIds = res.chatIds as string[] | undefined;
          if (chatIds) {
            subscribedGroups.clear();
            for (const id of chatIds) subscribedGroups.add(id);
          }
          if (typeof res.boundChat === "string") {
            boundChat = res.boundChat as ChannelChatId;
            nullBoundPolls = 0;
          } else if (boundChat === null) {
            nullBoundPolls = 0;
          } else if (++nullBoundPolls >= 3) {
            // Prevent single transient races from bouncing output to an old fallback chat.
            boundChat = null;
            nullBoundPolls = 0;
          }
        } catch {}
      };
      await pollBinding();
      groupPollTimer = setInterval(() => {
        pollBinding().catch(() => {});
      }, 500);
    }

    // Watch session JSONL for assistant responses.
    const watcherRef: { current: FSWatcher | null; dir: FSWatcher | null } = { current: null, dir: null };
    let dirScanTimer: ReturnType<typeof setInterval> | null = null;
    if (channel && chatId && projectDir) {
      const tgChannel = channel;
      const tgRemoteId = remoteId;
      let activeSessionFile: string | null = null;
      let activeClaudeSessionId: string | null = null;

      const startFileWatch = (sessionFile: string, skipExisting = false, replaceCurrent = false) => {
        if (activeSessionFile === sessionFile) return;
        if (watcherRef.current) {
          if (!replaceCurrent) return; // already locked to a session
          watcherRef.current.close();
          watcherRef.current = null;
        }
        activeSessionFile = sessionFile;
        activeClaudeSessionId = null;

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
              // Tool is working — assert typing on all target chats
              const typingTarget = getPrimaryTargetChat();
              if (typingTarget) tgChannel.setTyping(typingTarget, true);
              for (const gid of subscribedGroups) tgChannel.setTyping(gid, true);

              for (const call of calls) {
                lastToolCall = { name: call.name, input: call.input };
                // Send tool notification immediately (no poll)
                daemonRequest(`/remote/${tgRemoteId}/tool-call`, "POST", {
                  name: call.name,
                  input: call.input,
                }).catch(() => {});
              }
            }
          : undefined;

        const onThinking = tgRemoteId
          ? (text: string) => {
              daemonRequest(`/remote/${tgRemoteId}/thinking`, "POST", { text }).catch(() => {});
            }
          : undefined;

        const onToolResult = tgRemoteId
          ? (results: ToolResultInfo[]) => {
              for (const result of results) {
                daemonRequest(`/remote/${tgRemoteId}/tool-result`, "POST", {
                  toolName: result.toolName,
                  content: result.content,
                  isError: result.isError,
                }).catch(() => {});
              }
            }
          : undefined;

        const onBackgroundJobEvent = tgRemoteId
          ? (events: BackgroundJobEventInfo[]) => {
              for (const event of events) {
                daemonRequest(`/remote/${tgRemoteId}/background-job`, "POST", {
                  taskId: event.taskId,
                  status: event.status,
                  command: event.command,
                  outputFile: event.outputFile,
                  summary: event.summary,
                  urls: event.urls,
                }).catch(() => {});
              }
            }
          : undefined;

        watcherRef.current = watchSessionFile(sessionFile, (text) => {
          // Determine target chats: bound chat + subscribed groups.
          const targets = new Set<ChannelChatId>();
          const targetChat = getPrimaryTargetChat();
          if (targetChat) targets.add(targetChat);
          for (const gid of subscribedGroups) targets.add(gid);
          if (targets.size === 0) return;

          for (const cid of targets) tgChannel.setTyping(cid, false);

          const formatted = tgChannel.fmt.fromMarkdown(text);
          for (const cid of targets) {
            tgChannel.send(cid, formatted).catch(() => {});
          }
        }, onQuestion, onToolCall, onThinking, onToolResult, onBackgroundJobEvent, (msg) => {
          if (typeof msg.sessionId === "string") activeClaudeSessionId = msg.sessionId;
        }, skipExisting);
      };

      // If resuming, watch the existing session file — skip old content
      if (resumeSessionFile) {
        startFileWatch(resumeSessionFile, true);
      }

      const maybeSwitchToRolloverSession = (sessionFile: string): void => {
        if (cmdName !== "claude") return;
        if (!activeClaudeSessionId) return;
        const seenIds = readSessionIdsFromJsonl(sessionFile);
        if (seenIds.has(activeClaudeSessionId)) {
          startFileWatch(sessionFile, false, true);
        }
      };

      // Check for files that appeared between snapshot and now (e.g. PI creates file at startup)
      const checkForNewFiles = () => {
        if (cmdName === "kimi") {
          try {
            const unseen = listKimiSessionWireFiles(projectDir)
              .filter((filePath) => !existingFiles.has(filePath))
              .sort((a, b) => {
                let aMtime = 0;
                let bMtime = 0;
                try { aMtime = statSync(a).mtimeMs; } catch {}
                try { bMtime = statSync(b).mtimeMs; } catch {}
                return bMtime - aMtime;
              });
            for (const filePath of unseen) {
              existingFiles.add(filePath);
              if (!watcherRef.current) {
                startFileWatch(filePath);
                return;
              }
            }
          } catch {}
          return;
        }

        try {
          for (const f of readdirSync(projectDir)) {
            if (!f.endsWith(".jsonl")) continue;
            if (existingFiles.has(f)) continue;
            existingFiles.add(f);
            const filePath = join(projectDir, f);
            if (!watcherRef.current) {
              startFileWatch(filePath);
              return;
            }
            maybeSwitchToRolloverSession(filePath);
          }
        } catch {}
      };

      // Watch the project directory for new .jsonl files
      try {
        if (cmdName === "kimi") {
          watcherRef.dir = watch(projectDir, () => {
            checkForNewFiles();
          });
        } else {
          watcherRef.dir = watch(projectDir, (_event, filename) => {
            if (!filename?.endsWith(".jsonl")) return;
            if (existingFiles.has(filename)) return;
            existingFiles.add(filename);
            const filePath = join(projectDir, filename);
            if (!watcherRef.current) {
              startFileWatch(filePath);
              return;
            }
            maybeSwitchToRolloverSession(filePath);
          });
        }
      } catch {}

      // Immediate check + periodic poll for tools that create files before watcher is ready
      checkForNewFiles();
      const bootstrapScanTimer = setInterval(() => {
        if (watcherRef.current) {
          clearInterval(bootstrapScanTimer);
          return;
        }
        checkForNewFiles();
      }, 500);
      setTimeout(() => clearInterval(bootstrapScanTimer), 30_000);

      // Keep scanning for Claude rollovers and Kimi nested session files.
      if (cmdName === "claude" || cmdName === "kimi") {
        dirScanTimer = setInterval(() => {
          checkForNewFiles();
        }, 2000);
      }
    }

    // Poll daemon for remote input if registered
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let processingInput = false;
    const recovery = remoteId && chatId && ownerUserId
      ? createRemoteRecoveryController({
          ensureDaemon,
          daemonRequest,
          log: () => {},
          logErr: () => {},
        })
      : null;
    if (remoteId && chatId && ownerUserId && recovery) {

      pollTimer = setInterval(async () => {
        if (processingInput || recovery.isRecovering()) return;
        try {
          const res = await daemonRequest(`/remote/${remoteId}/input`);

          // Daemon restarted and lost our session — re-register with the same ID
          if (res.unknown) {
            await recovery.recover("unknown", {
              remoteId,
              fullCommand,
              chatId,
              ownerUserId,
              cwd: process.cwd(),
              subscribedGroups: Array.from(subscribedGroups),
              boundChat,
            });
            return;
          }

          const remoteControl = parseRemoteControlAction((res as { controlAction?: unknown }).controlAction);
          if (remoteControl === "stop") {
            terminal.write(Buffer.from("\x03"));
            return;
          }
          if (remoteControl === "kill") {
            stayAliveAfterKill = true;
            // Graceful first: signal interrupt to the foreground PTY process.
            try {
              terminal.write(Buffer.from("\x03"));
            } catch {}
            try {
              proc.kill(2);
            } catch {}
            // If it ignores interrupt, force-kill shortly after.
            forceKillTimer = setTimeout(() => {
              try {
                proc.kill(9);
              } catch {}
            }, 1500);
            try {
              forceKillTimer.unref?.();
            } catch {}
            return;
          }
          if (remoteControl && typeof remoteControl === "object" && remoteControl.type === "resume") {
            requestedResumeSessionRef = remoteControl.sessionRef;
            try {
              proc.kill(9);
            } catch {}
            return;
          }

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
                const typingTarget = getPrimaryTargetChat();
                if (typingTarget) channel.setTyping(typingTarget, true);
                for (const gid of subscribedGroups) channel.setTyping(gid, true);
              }
              // Send remote text as bracketed paste so special chars (like '@')
              // stay literal and don't trigger interactive pickers/autocomplete.
              terminal.write(encodeBracketedPaste(line));
              // File paths need extra time for the tool to load/process the attachment
              const hasFilePath = line.includes("/.touchgrass/uploads/");
              await delay(hasFilePath ? 1500 : 150);
              // Some CLI tools use multiline editors where Enter after a paste
              // adds a newline instead of submitting. A second Enter on the
              // resulting empty line triggers submit.
              terminal.write(Buffer.from("\r"));
              await delay(80);
              terminal.write(Buffer.from("\r"));
              await delay(100);
            }
            processingInput = false;
          }
        } catch {
          // Don't kill polling on transient errors — just retry next interval
          processingInput = false;
          await recovery.recover("unreachable", {
            remoteId,
            fullCommand,
            chatId,
            ownerUserId,
            cwd: process.cwd(),
            subscribedGroups: Array.from(subscribedGroups),
            boundChat,
          });
        }
      }, 200);
    }

    const exitCode = await proc.exited;
    finalExitCode = exitCode ?? 1;

    // Cleanup
    process.stdin.off("data", onStdinData);
    process.stdout.off("resize", onResize);
    if (caffeinateProc) caffeinateProc.kill();
    if (pollTimer) clearInterval(pollTimer);
    if (groupPollTimer) clearInterval(groupPollTimer);
    if (dirScanTimer) clearInterval(dirScanTimer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    if (watcherRef.current) watcherRef.current.close();
    if (watcherRef.dir) watcherRef.dir.close();

    if (requestedResumeSessionRef) {
      cmdArgs = buildResumeCommandArgs(cmdName as "claude" | "codex" | "pi" | "kimi", cmdArgs, requestedResumeSessionRef);
      continue;
    }

    if (stayAliveAfterKill && remoteId && chatId && ownerUserId) {
      if (channel) {
        const { fmt } = channel;
        await channel
          .send(
            chatId,
            `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(fullCommand.split(/\s+/)[0] || "session"))} ${fmt.escape(
              "is stopped. Start a new session from your terminal."
            )}`
          )
          .catch(() => {});
      }

      let warnedIdleInput = false;
      while (true) {
        try {
          const res = await daemonRequest(`/remote/${remoteId}/input`);
          if (res.unknown) {
            if (recovery) {
              await recovery.recover("unknown", {
                remoteId,
                fullCommand,
                chatId,
                ownerUserId,
                cwd: process.cwd(),
                subscribedGroups: Array.from(subscribedGroups),
                boundChat,
              });
            }
            await Bun.sleep(200);
            continue;
          }

          const remoteControl = parseRemoteControlAction((res as { controlAction?: unknown }).controlAction);
          if (remoteControl && typeof remoteControl === "object" && remoteControl.type === "resume") {
            requestedResumeSessionRef = remoteControl.sessionRef;
            break;
          }
          if (remoteControl === "stop" || remoteControl === "kill") {
            break;
          }

          const lines = (res as { lines?: string[] }).lines;
          if (lines && lines.length > 0 && channel && chatId && !warnedIdleInput) {
            warnedIdleInput = true;
            const { fmt } = channel;
            await channel
              .send(chatId, `${fmt.escape("⛳️")} ${fmt.escape("No running tool in this wrapper. Start again from your terminal.")}`)
              .catch(() => {});
          }
        } catch {
          if (recovery) {
            await recovery.recover("unreachable", {
              remoteId,
              fullCommand,
              chatId,
              ownerUserId,
              cwd: process.cwd(),
              subscribedGroups: Array.from(subscribedGroups),
              boundChat,
            });
          }
        }
        await Bun.sleep(200);
      }

      if (requestedResumeSessionRef) {
        cmdArgs = buildResumeCommandArgs(cmdName as "claude" | "codex" | "pi" | "kimi", cmdArgs, requestedResumeSessionRef);
        continue;
      }
    }

    if (remoteId) {
      try {
        await daemonRequest(`/remote/${remoteId}/exit`, "POST", {
          exitCode: exitCode ?? null,
        });
      } catch {}
      await removeManifest(remoteId);
    } else if (channel && chatId) {
      const { fmt } = channel;
      const status = exitCode === 0 ? "disconnected" : `disconnected (code ${exitCode ?? "unknown"})`;
      await channel.send(chatId, `Command ${fmt.code(fmt.escape(fullCommand))} ${fmt.escape(status)}.`);
    }
    break;
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  process.exit(finalExitCode ?? 1);
}
