import { loadConfig } from "../config/store";
import { getAllPairedUsers, type ChannelConfig, type TgConfig } from "../config/schema";
import { createChannel } from "../channel/factory";
import type { Channel, ChannelChatId } from "../channel/types";
import { createInterface } from "readline/promises";
import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { stripAnsiReadable } from "../utils/ansi";
import { paths, ensureDirs } from "../config/paths";
import { watch, readdirSync, statSync, readFileSync, type FSWatcher } from "fs";
import { chmod, open, writeFile, unlink } from "fs/promises";
import { homedir, platform } from "os";
import { isAbsolute, join } from "path";
import { mergeRemoteControlAction, parseRemoteControlAction, type RemoteControlAction } from "../session/remote-control";

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

function stripHeartbeatComments(content: string): string {
  // Ignore C-style block comments in AGENTS.md heartbeat blocks.
  return content.replace(/\/\*[\s\S]*?\*\//g, "");
}

function getHeartbeatInstructions(content: string): string {
  return stripHeartbeatComments(content).trim();
}

interface HeartbeatRunConfig {
  workflow: string;
  always: boolean;
  everyMinutes: number | null;
  at: string | null; // HH:MM (24h)
  on: string | null; // weekdays/weekends/daily or comma-separated day names
}

interface HeartbeatConfig {
  intervalMinutes: number | null;
  runs: HeartbeatRunConfig[];
  textContent: string;
}

interface HeartbeatRuntimeState {
  lastEveryRunAtMs: Map<string, number>;
  lastAtRunDate: Map<string, string>;
  missingWorkflowWarned: Set<string>;
}

interface HeartbeatWorkflowTick {
  workflow: string;
  workflowPath: string;
  context: string;
}

interface HeartbeatTickResolution {
  workflows: HeartbeatWorkflowTick[];
  plainText: string | null;
}

function parseXmlAttrs(attrBlob: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrBlob)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function parseDurationMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;

  const plain = v.match(/^(\d+)$/);
  if (plain) return parseInt(plain[1], 10);

  const mins = v.match(/^(\d+)\s*(m|min|mins|minute|minutes)$/);
  if (mins) return parseInt(mins[1], 10);

  const hours = v.match(/^(\d+)\s*(h|hr|hrs|hour|hours)$/);
  if (hours) return parseInt(hours[1], 10) * 60;

  return null;
}

function parseHeartbeatConfig(content: string): HeartbeatConfig | null {
  const cleaned = getHeartbeatInstructions(content);
  const hbMatch = cleaned.match(/<agent-heartbeat\b([^>]*)>([\s\S]*?)<\/agent-heartbeat>/i);
  if (!hbMatch) return null;

  const hbAttrs = parseXmlAttrs(hbMatch[1] || "");
  const intervalMinutes = parseDurationMinutes(hbAttrs.interval);
  const body = hbMatch[2] || "";

  const runs: HeartbeatRunConfig[] = [];
  const runRe = /<run\b([^>]*?)\/?>/gi;
  let runMatch: RegExpExecArray | null;
  while ((runMatch = runRe.exec(body)) !== null) {
    const attrBlob = runMatch[1] || "";
    const attrs = parseXmlAttrs(attrBlob);
    const workflow = (attrs.workflow || "").trim();
    if (!workflow) continue;

    const alwaysBare = /\balways\b(?!\s*=)/i.test(attrBlob);
    let always = alwaysBare || /^(1|true|yes)$/i.test((attrs.always || "").trim());
    const everyMinutes = parseDurationMinutes(attrs.every);
    const at = (attrs.at || "").trim() || null;
    const on = (attrs.on || "").trim() || null;

    if (at && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(at)) continue;
    if (!always && everyMinutes === null && !at) always = true;

    runs.push({
      workflow,
      always,
      everyMinutes,
      at,
      on,
    });
  }

  const textContent = body
    .replace(/<run\b[\s\S]*?<\/run>/gi, "")
    .replace(/<run\b[^>]*\/>/gi, "")
    .trim();

  return { intervalMinutes, runs, textContent };
}

function heartbeatRunKey(run: HeartbeatRunConfig): string {
  return `${run.workflow}|a:${run.always}|e:${run.everyMinutes ?? ""}|t:${run.at ?? ""}|o:${run.on ?? ""}`;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isRunDayAllowed(on: string | null, now: Date): boolean {
  if (!on) return true;
  const v = on.trim().toLowerCase();
  if (!v || v === "daily" || v === "everyday" || v === "all") return true;
  const dow = now.getDay(); // 0=sun
  if (v === "weekdays") return dow >= 1 && dow <= 5;
  if (v === "weekends") return dow === 0 || dow === 6;

  const names: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  const parts = v.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return true;
  return parts.some((p) => names[p] === dow);
}

function isRunDue(
  run: HeartbeatRunConfig,
  now: Date,
  tickIntervalMinutes: number,
  state: HeartbeatRuntimeState
): boolean {
  if (!isRunDayAllowed(run.on, now)) return false;

  const key = heartbeatRunKey(run);
  const nowMs = now.getTime();

  if (run.always) return true;

  if (run.everyMinutes && run.everyMinutes > 0) {
    const everyMs = run.everyMinutes * 60 * 1000;
    const last = state.lastEveryRunAtMs.get(key);
    if (last === undefined || nowMs - last >= everyMs) {
      state.lastEveryRunAtMs.set(key, nowMs);
      return true;
    }
    return false;
  }

  if (run.at) {
    const [hh, mm] = run.at.split(":").map((n) => parseInt(n, 10));
    const scheduled = new Date(now);
    scheduled.setHours(hh, mm, 0, 0);
    const lagMs = nowMs - scheduled.getTime();
    const tickMs = tickIntervalMinutes * 60 * 1000;
    if (lagMs < 0 || lagMs >= tickMs) return false;

    const runDate = `${localDateKey(now)}|${run.at}`;
    const lastRunDate = state.lastAtRunDate.get(key);
    if (lastRunDate === runDate) return false;
    state.lastAtRunDate.set(key, runDate);
    return true;
  }

  return false;
}

function resolveWorkflowPath(workflowRef: string): string {
  const ref = workflowRef.trim();
  if (!ref) return "";
  if (isAbsolute(ref)) return ref;
  if (ref.includes("/")) {
    return join(process.cwd(), ref.endsWith(".md") ? ref : `${ref}.md`);
  }
  return join(process.cwd(), "workflows", ref.endsWith(".md") ? ref : `${ref}.md`);
}

function resolveHeartbeatTick(
  rawHeartbeat: string,
  now: Date,
  tickIntervalMinutes: number,
  state: HeartbeatRuntimeState,
  readWorkflow: (workflowPath: string) => string | null
): HeartbeatTickResolution {
  const parsed = parseHeartbeatConfig(rawHeartbeat);
  if (!parsed) {
    return { workflows: [], plainText: null };
  }

  if (parsed && parsed.runs.length > 0) {
    const workflows: HeartbeatWorkflowTick[] = [];
    for (const run of parsed.runs) {
      if (!isRunDue(run, now, tickIntervalMinutes, state)) continue;
      const workflowPath = resolveWorkflowPath(run.workflow);
      const workflowContent = (readWorkflow(workflowPath) || "").trim();
      if (!workflowContent) continue;
      const context = parsed.textContent
        ? `${parsed.textContent}\n\n${workflowContent}`
        : workflowContent;
      workflows.push({ workflow: run.workflow, workflowPath, context });
    }
    if (workflows.length === 0) {
      return { workflows: [], plainText: null };
    }
    return { workflows, plainText: null };
  }

  const plainText = parsed.textContent.trim();
  if (!plainText) {
    return { workflows: [], plainText: null };
  }
  return { workflows: [], plainText };
}

// Test-only accessors for heartbeat behavior.
export const __heartbeatTestUtils = {
  getHeartbeatInstructions,
  parseHeartbeatConfig,
  isRunDue,
  resolveHeartbeatTick,
  createRuntimeState(): HeartbeatRuntimeState {
    return {
      lastEveryRunAtMs: new Map<string, number>(),
      lastAtRunDate: new Map<string, string>(),
      missingWorkflowWarned: new Set<string>(),
    };
  },
};

// Test-only accessors for CLI arg parsing behavior.
export const __cliRunTestUtils = {
  parseCodexResumeArgs,
};

interface OwnerChannelResolution {
  channelName: string;
  channelConfig: ChannelConfig;
  ownerUserId: string;
  ownerChatId: ChannelChatId;
}

function resolveOwnerChannel(config: TgConfig, preferredChannelType?: string): OwnerChannelResolution | null {
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

  if (preferredChannelType) {
    const preferred = candidates.find((c) => c.channelConfig.type === preferredChannelType);
    if (preferred) return preferred;
  }
  return candidates[0] || null;
}

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

interface ParsedMessage {
  assistantText: string | null;
  thinking: string | null;
  questions: unknown[] | null;
  toolCalls: ToolCallInfo[];
  toolResults: ToolResultInfo[];
}

// Map tool_use_id/call_id → tool name so we can label tool_results
const toolUseIdToName = new Map<string, string>();

// Only forward results for tools where the output is useful to see on Telegram
const FORWARD_RESULT_TOOLS = new Set([
  "WebFetch", "WebSearch", "Bash",   // Claude
  "bash",                             // PI
  "exec_command",                     // Codex
]);

// Tool rejections the user already sees in their terminal — don't echo to Telegram
const isToolRejection = (text: string) =>
  text.includes("The user doesn't want to proceed with this tool use");

const EMPTY_PARSED: ParsedMessage = {
  assistantText: null, thinking: null, questions: null, toolCalls: [], toolResults: [],
};

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
          if (toolId) toolUseIdToName.set(toolId, name);
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
    return { assistantText, thinking, questions, toolCalls, toolResults: [] };
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
            if (toolId) toolUseIdToName.set(toolId, name);
            toolCalls.push({ id: toolId, name, input: (block.arguments as Record<string, unknown>) || {} });
            break;
          }
        }
      }
      capIdMap();
      const assistantText = texts.join("\n").trim() || null;
      const thinking = thinkings.join("\n").trim() || null;
      return { assistantText, thinking, questions: null, toolCalls, toolResults: [] };
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
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const toolName = toolUseIdToName.get(block.tool_use_id as string) ?? "";
      const isError = block.is_error === true;
      if (!isError && !FORWARD_RESULT_TOOLS.has(toolName)) continue;
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
      if (text.trim()) toolResults.push({ toolName: toolName || "unknown", content: text.trim(), isError });
    }
    if (toolResults.length === 0) return EMPTY_PARSED;
    return { ...EMPTY_PARSED, toolResults };
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
      capIdMap();
      return { ...EMPTY_PARSED, toolCalls: [{ id: callId, name: payload.name, input }] };
    }

    if (payload.type === "custom_tool_call" && typeof payload.name === "string") {
      const callId = (payload.call_id as string) || "";
      if (callId) toolUseIdToName.set(callId, payload.name);
      const input: Record<string, unknown> = typeof payload.input === "string"
        ? { content: payload.input }
        : {};
      capIdMap();
      return { ...EMPTY_PARSED, toolCalls: [{ id: callId, name: payload.name, input }] };
    }

    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const callId = payload.call_id as string;
      const toolName = toolUseIdToName.get(callId) ?? "";
      if (!FORWARD_RESULT_TOOLS.has(toolName)) return EMPTY_PARSED;
      const output = (payload.output as string) ?? "";
      if (!output.trim()) return EMPTY_PARSED;
      return { ...EMPTY_PARSED, toolResults: [{ toolName: toolName || "unknown", content: output.trim(), isError: false }] };
    }
  }

  return EMPTY_PARSED;
}

function capIdMap() {
  if (toolUseIdToName.size > 200) {
    const first = toolUseIdToName.keys().next().value!;
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

// Watch a JSONL file for new assistant messages using incremental reads.
// Uses fs.watch + periodic polling fallback for reliability on macOS.
function watchSessionFile(
  filePath: string,
  onAssistant: (text: string) => void,
  onQuestion?: (questions: unknown[]) => void,
  onToolCall?: (calls: ToolCallInfo[]) => void,
  onThinking?: (text: string) => void,
  onToolResult?: (results: ToolResultInfo[]) => void,
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

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function promptAgentModeForHeartbeat(agentsFilePath: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(
      `<agent-heartbeat> detected in ${agentsFilePath}. Run in --agent-mode to enable heartbeat? [Y/n] `
    )).trim().toLowerCase();
    if (!answer || answer === "y" || answer === "yes") return true;
    return false;
  } finally {
    rl.close();
  }
}

function isHeadlessControlLine(line: string): boolean {
  return line.startsWith("\x1b[POLL:");
}

function stripClaudeHeadlessArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-p" || arg === "--print" || arg === "--include-partial-messages") continue;
    if (arg === "--input-format" || arg === "--output-format") {
      i++;
      continue;
    }
    if (arg.startsWith("--input-format=") || arg.startsWith("--output-format=")) continue;
    out.push(arg);
  }
  return out;
}

function stripPiHeadlessArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mode") {
      i++;
      continue;
    }
    if (arg.startsWith("--mode=")) continue;
    if (arg === "-p" || arg === "--print") continue;
    out.push(arg);
  }
  return out;
}

function stripCodexJsonArgs(args: string[]): string[] {
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
  let baseArgs = stripCodexJsonArgs(args);
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

async function readLinesFromStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLine: (line: string) => void
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (line) onLine(line);
        idx = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const final = buffer.trim();
    if (final) onLine(final);
  } finally {
    reader.releaseLock();
  }
}

async function terminateSubprocess(
  proc: ReturnType<typeof Bun.spawn>,
  action: RemoteControlAction
): Promise<void> {
  try {
    if (action === "kill") {
      proc.kill(9);
      return;
    }
    proc.kill(15);
    const timedOut = await Promise.race([
      proc.exited.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1000)),
    ]);
    if (timedOut) {
      try {
        proc.kill(9);
      } catch {}
    }
  } catch {}
}

interface HeadlessAdapter {
  sendText(text: string): Promise<void>;
  close(action?: RemoteControlAction): Promise<void>;
  exited: Promise<number | null>;
}

interface HeadlessRunOptions {
  cmdName: string;
  executable: string;
  cmdArgs: string[];
  remoteId: string;
  fullCommand: string;
  chatId: ChannelChatId;
  ownerUserId: string;
  didBindChat: boolean;
  heartbeatEnabled: boolean;
  heartbeatSourceFile: string;
  heartbeatInterval: number;
}

async function runHeadlessSession(opts: HeadlessRunOptions): Promise<number> {
  const {
    cmdName,
    executable,
    cmdArgs,
    remoteId,
    fullCommand,
    ownerUserId,
    chatId,
    didBindChat,
    heartbeatEnabled,
    heartbeatSourceFile,
    heartbeatInterval,
  } = opts;

  const postAssistant = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    daemonRequest(`/remote/${remoteId}/assistant`, "POST", { text: trimmed }).catch(() => {});
  };
  const postQuestion = (questions: unknown[]) => {
    daemonRequest(`/remote/${remoteId}/question`, "POST", { questions }).catch(() => {});
  };
  const postThinking = (text: string) => {
    daemonRequest(`/remote/${remoteId}/thinking`, "POST", { text }).catch(() => {});
  };
  const postToolCall = (name: string, input: Record<string, unknown>) => {
    daemonRequest(`/remote/${remoteId}/tool-call`, "POST", { name, input }).catch(() => {});
  };
  const postToolResult = (toolName: string, content: string, isError: boolean) => {
    daemonRequest(`/remote/${remoteId}/tool-result`, "POST", {
      toolName,
      content,
      isError,
    }).catch(() => {});
  };
  let remoteTypingActive = false;
  const postTyping = (active: boolean) => {
    if (remoteTypingActive === active) return;
    remoteTypingActive = active;
    daemonRequest(`/remote/${remoteId}/typing`, "POST", { active }).catch(() => {});
  };

  const emitParsedMessage = (parsed: ParsedMessage): void => {
    if (parsed.assistantText) postAssistant(parsed.assistantText);
    if (parsed.questions) postQuestion(parsed.questions);
    if (parsed.thinking) postThinking(parsed.thinking);
    for (const call of parsed.toolCalls) {
      postToolCall(call.name, call.input);
    }
    for (const result of parsed.toolResults) {
      postToolResult(result.toolName, result.content, result.isError);
    }
  };

  const createClaudeAdapter = (): HeadlessAdapter => {
    const filteredArgs = stripClaudeHeadlessArgs(cmdArgs);
    let sessionId: string | null = null;
    let useContinue = false;
    let activeProc: ReturnType<typeof Bun.spawn> | null = null;
    let closeAction: RemoteControlAction | null = null;
    const commonArgs: string[] = [];

    for (let i = 0; i < filteredArgs.length; i++) {
      const arg = filteredArgs[i];
      if (arg === "--resume" || arg === "-r") {
        if (i + 1 < filteredArgs.length && !filteredArgs[i + 1].startsWith("-")) {
          sessionId = filteredArgs[i + 1];
          i++;
        }
        continue;
      }
      if (arg.startsWith("--resume=")) {
        sessionId = arg.slice("--resume=".length);
        continue;
      }
      if (arg === "--session-id") {
        if (i + 1 < filteredArgs.length && !filteredArgs[i + 1].startsWith("-")) {
          sessionId = filteredArgs[i + 1];
          i++;
        }
        continue;
      }
      if (arg.startsWith("--session-id=")) {
        sessionId = arg.slice("--session-id=".length);
        continue;
      }
      if (arg === "--continue" || arg === "-c") {
        useContinue = true;
        continue;
      }
      commonArgs.push(arg);
    }

    return {
      async sendText(text: string): Promise<void> {
        if (closeAction) throw new Error("Session is stopping.");

        const invocation: string[] = [executable, ...commonArgs];
        if (sessionId) {
          invocation.push("--resume", sessionId);
        } else if (useContinue) {
          invocation.push("--continue");
          useContinue = false;
        }
        invocation.push("--print", "--input-format", "text", "--output-format", "stream-json", text);

        const proc = Bun.spawn(invocation, {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        });
        activeProc = proc;

        const stderrLines: string[] = [];
        await Promise.all([
          readLinesFromStream(proc.stdout, (line) => {
            const msg = parseJsonLine(line);
            if (!msg) return;
            if (typeof msg.session_id === "string") {
              sessionId = msg.session_id;
            }

            const parsed = parseJsonlMessage(msg);
            emitParsedMessage(parsed);

            if (msg.type === "result") {
              const denials = msg.permission_denials;
              if (Array.isArray(denials) && denials.length > 0) {
                const labels = denials
                  .map((d) => {
                    if (!d || typeof d !== "object") return "tool";
                    const record = d as Record<string, unknown>;
                    const name = (record.name as string) || (record.tool_name as string);
                    return name || "tool";
                  })
                  .join(", ");
                postAssistant(`Permission denied for ${labels}. Re-run with a more permissive Claude permission mode if needed.`);
              }
            }
          }),
          readLinesFromStream(proc.stderr, (line) => {
            if (!line.trim()) return;
            stderrLines.push(line);
            console.error(`[claude/agent-mode] ${line}`);
          }),
        ]);

        const exitCode = await proc.exited;
        if (activeProc === proc) activeProc = null;
        if (closeAction) throw new Error("Session is stopping.");
        if (exitCode !== 0) {
          throw new Error(stderrLines[stderrLines.length - 1] || `Claude agent-mode request failed (code ${exitCode ?? "unknown"})`);
        }
      },
      async close(action: RemoteControlAction = "stop"): Promise<void> {
        closeAction = mergeRemoteControlAction(closeAction, action);
        if (activeProc) {
          await terminateSubprocess(activeProc, closeAction);
        }
      },
      exited: new Promise<number | null>(() => {}),
    };
  };

  const createPiAdapter = (): HeadlessAdapter => {
    const filteredArgs = stripPiHeadlessArgs(cmdArgs);
    let closeAction: RemoteControlAction | null = null;
    const proc = Bun.spawn([executable, ...filteredArgs, "--mode", "rpc"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    let nextId = 1;
    const pendingTurns: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

    void readLinesFromStream(proc.stdout, (line) => {
      const msg = parseJsonLine(line);
      if (!msg) return;

      if (msg.type === "message_end" && msg.message && typeof msg.message === "object") {
        const parsed = parseJsonlMessage({
          type: "message",
          message: msg.message as Record<string, unknown>,
        });
        emitParsedMessage(parsed);
      }

      if (
        msg.type === "response" &&
        msg.command === "prompt" &&
        msg.success === false
      ) {
        const pending = pendingTurns.shift();
        if (pending) {
          pending.reject(new Error((msg.error as string) || "PI prompt failed"));
        }
      }

      if (msg.type === "turn_end") {
        const pending = pendingTurns.shift();
        if (pending) pending.resolve();
      }
    });

    void readLinesFromStream(proc.stderr, (line) => {
      if (line.trim()) console.error(`[pi/agent-mode] ${line}`);
    });

    proc.exited.then((code) => {
      const err = new Error(`PI agent-mode process exited with code ${code ?? "unknown"}`);
      while (pendingTurns.length > 0) {
        pendingTurns.shift()?.reject(err);
      }
    }).catch(() => {});

    return {
      async sendText(text: string): Promise<void> {
        if (closeAction) throw new Error("Session is stopping.");
        if (!proc.stdin) throw new Error("PI stdin is unavailable.");

        await new Promise<void>((resolve, reject) => {
          pendingTurns.push({ resolve, reject });
          const command = {
            id: `prompt-${nextId++}`,
            type: "prompt",
            message: text,
            streamingBehavior: "followUp",
          };
          try {
            proc.stdin!.write(`${JSON.stringify(command)}\n`);
          } catch (e) {
            pendingTurns.pop();
            reject(e as Error);
          }
        });
      },
      async close(action: RemoteControlAction = "stop"): Promise<void> {
        closeAction = mergeRemoteControlAction(closeAction, action);
        const err = new Error("Session is stopping.");
        while (pendingTurns.length > 0) {
          pendingTurns.shift()?.reject(err);
        }
        await terminateSubprocess(proc, closeAction);
      },
      exited: proc.exited,
    };
  };

  const createCodexAdapter = (): HeadlessAdapter => {
    const parsed = parseCodexResumeArgs(cmdArgs);
    let threadId = parsed.resumeId;
    let useResumeLast = parsed.useResumeLast;
    let activeProc: ReturnType<typeof Bun.spawn> | null = null;
    let closeAction: RemoteControlAction | null = null;
    const baseArgs = parsed.baseArgs;

    return {
      async sendText(text: string): Promise<void> {
        if (closeAction) throw new Error("Session is stopping.");

        const invocation: string[] = ["exec"];
        if (threadId || useResumeLast) {
          invocation.push("resume");
          invocation.push("--json");
          invocation.push(...baseArgs);
          if (threadId) {
            invocation.push(threadId);
          } else {
            invocation.push("--last");
            useResumeLast = false;
          }
          invocation.push(text);
        } else {
          invocation.push("--json");
          invocation.push(...baseArgs);
          invocation.push(text);
        }

        const proc = Bun.spawn([executable, ...invocation], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        });
        activeProc = proc;

        void readLinesFromStream(proc.stdout, (line) => {
          const msg = parseJsonLine(line);
          if (!msg) return;

          if (msg.type === "thread.started" && typeof msg.thread_id === "string") {
            threadId = msg.thread_id;
            return;
          }

          if (msg.type === "item.started" && msg.item && typeof msg.item === "object") {
            const item = msg.item as Record<string, unknown>;
            if (item.type === "command_execution" && typeof item.command === "string") {
              postToolCall("exec_command", { cmd: item.command });
            }
            return;
          }

          if (msg.type === "item.completed" && msg.item && typeof msg.item === "object") {
            const item = msg.item as Record<string, unknown>;
            if (item.type === "agent_message" && typeof item.text === "string") {
              postAssistant(item.text);
              return;
            }
            if (item.type === "reasoning" && typeof item.text === "string") {
              postThinking(item.text);
              return;
            }
            if (item.type === "command_execution") {
              const content = (item.aggregated_output as string) || "";
              const isError = typeof item.exit_code === "number" && item.exit_code !== 0;
              if (content.trim()) {
                postToolResult("exec_command", content, isError);
              }
              return;
            }
          }
        });

        void readLinesFromStream(proc.stderr, (line) => {
          if (line.trim()) console.error(`[codex/agent-mode] ${line}`);
        });

        const exitCode = await proc.exited;
        if (activeProc === proc) activeProc = null;
        if (closeAction) throw new Error("Session is stopping.");
        if (exitCode !== 0) {
          throw new Error(`Codex agent-mode request failed (code ${exitCode ?? "unknown"})`);
        }
      },
      async close(action: RemoteControlAction = "stop"): Promise<void> {
        closeAction = mergeRemoteControlAction(closeAction, action);
        if (activeProc) {
          await terminateSubprocess(activeProc, closeAction);
        }
      },
      exited: new Promise<number | null>(() => {}),
    };
  };

  let adapter: HeadlessAdapter;
  if (cmdName === "claude") adapter = createClaudeAdapter();
  else if (cmdName === "pi") adapter = createPiAdapter();
  else adapter = createCodexAdapter();

  const headlessPrefix = `[agent-mode/${cmdName}]`;
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const canAnimateSpinner = Boolean(process.stdout?.isTTY);
  let spinnerText: string | null = null;
  let spinnerFrameIdx = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;
  const clearSpinner = () => {
    if (!canAnimateSpinner || !spinnerText) return;
    process.stdout.write("\r\x1b[2K");
  };
  const renderSpinner = () => {
    if (!canAnimateSpinner || !spinnerText) return;
    const frame = spinnerFrames[spinnerFrameIdx];
    spinnerFrameIdx = (spinnerFrameIdx + 1) % spinnerFrames.length;
    process.stdout.write(`\r${headlessPrefix} ${frame} ${spinnerText}`);
  };
  const stopSpinner = () => {
    postTyping(false);
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
    clearSpinner();
    spinnerText = null;
    spinnerFrameIdx = 0;
  };
  const logHeadlessLine = (text: string, isError: boolean) => {
    const hadSpinner = Boolean(spinnerText);
    if (hadSpinner) clearSpinner();
    const line = `${headlessPrefix} ${isError ? "⚠" : "⛳️"} ${text}`;
    if (isError) console.error(line);
    else console.log(line);
    if (hadSpinner) renderSpinner();
  };
  const logHeadless = (text: string) => logHeadlessLine(text, false);
  const logHeadlessErr = (text: string) => logHeadlessLine(text, true);
  const startSpinner = (text: string) => {
    postTyping(true);
    if (!canAnimateSpinner) {
      logHeadless(`⏳ ${text}`);
      return;
    }
    stopSpinner();
    spinnerText = text;
    renderSpinner();
    spinnerTimer = setInterval(renderSpinner, 90);
  };
  logHeadless(`Bridge is live for ${remoteId}. Listening for inbound messages. Press Ctrl+C to stop.`);

  const subscribedGroups = new Set<ChannelChatId>();
  let boundChat: ChannelChatId | null = didBindChat ? chatId : null;
  let nullBoundPolls = 0;
  let groupPollTimer: ReturnType<typeof setInterval> | null = null;
  const pollBinding = async () => {
    try {
      const res = await daemonRequest(`/remote/${remoteId}/subscribed-groups`);
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
        boundChat = null;
        nullBoundPolls = 0;
      }
    } catch {}
  };
  await pollBinding();
  if (boundChat) {
    logHeadless(`Output channel linked: ${boundChat}`);
  } else {
    logHeadless("No output channel linked yet.");
  }
  groupPollTimer = setInterval(() => {
    pollBinding().catch(() => {});
  }, 500);

  let stopping = false;
  let stopAction: RemoteControlAction | null = null;
  let stopResolved = false;
  let resolveStopRequest: ((code: number) => void) | null = null;
  const stopRequestPromise = new Promise<number>((resolve) => {
    resolveStopRequest = resolve;
  });
  const resolveStop = (code: number) => {
    if (stopResolved) return;
    stopResolved = true;
    resolveStopRequest?.(code);
  };
  const requestStop = async (incoming: RemoteControlAction, source: "control" | "signal") => {
    const prev = stopAction;
    stopAction = mergeRemoteControlAction(stopAction, incoming);
    const effective = stopAction;

    stopSpinner();
    if (!stopping) {
      stopping = true;
      const label = effective === "kill" ? "Kill requested." : "Stop requested.";
      const detail = source === "control" ? `${label} Received from control command.` : `${label} Received local signal.`;
      logHeadless(detail);
      resolveStop(effective === "kill" ? 137 : 130);
    } else if (prev !== "kill" && effective === "kill") {
      logHeadless("Escalating shutdown from stop to kill.");
      resolveStop(137);
    }

    await adapter.close(effective).catch(() => {});
  };
  let userInputCount = 0;
  const idleLogIntervalMs = 60_000;
  let lastActivityAt = Date.now();
  let lastIdleLogAt = 0;
  const markActivity = () => {
    lastActivityAt = Date.now();
    lastIdleLogAt = 0;
  };
  type PendingInput = { line: string; source: "user" | "heartbeat" };
  const formatUserInputPreview = (line: string): string => {
    const cleaned = stripAnsiReadable(line).replace(/\s+/g, " ").trim();
    if (!cleaned) return "<empty>";
    const max = 220;
    return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
  };
  const formatElapsed = (elapsedMs: number): string => {
    if (elapsedMs < 1000) return `${elapsedMs}ms`;
    return `${(elapsedMs / 1000).toFixed(1)}s`;
  };
  let warnedControlInput = false;
  const pendingInputs: PendingInput[] = [];
  let drainingInputs = false;
  const enqueueInput = (line: string, source: PendingInput["source"]) => {
    pendingInputs.push({ line, source });
    void drainInputQueue();
  };
  const drainInputQueue = async () => {
    if (drainingInputs || stopping) return;
    drainingInputs = true;
    while (!stopping && pendingInputs.length > 0) {
      const input = pendingInputs.shift();
      if (!input) continue;
      if (isHeadlessControlLine(input.line)) {
        if (!warnedControlInput) {
          warnedControlInput = true;
          logHeadless("Interactive control input received; ignoring in agent mode.");
          postAssistant("Interactive poll controls are not supported in agent mode. Send plain-text responses instead.");
        }
        continue;
      }
      try {
        const startedAt = Date.now();
        if (input.source === "user") {
          userInputCount++;
          logHeadless(`inbound user input #${userInputCount}: ${formatUserInputPreview(input.line)}`);
          startSpinner(`Working on user input #${userInputCount}...`);
        }
        await adapter.sendText(input.line);
        if (input.source === "user") {
          stopSpinner();
          logHeadless(`✅ Completed user input #${userInputCount} in ${formatElapsed(Date.now() - startedAt)}`);
        }
        markActivity();
      } catch (e) {
        if (stopping) break;
        stopSpinner();
        const err = e as Error;
        const label = input.source === "user" ? "user input" : "scheduled input";
        logHeadlessErr(`${label} failed: ${err.message || err}`);
        postAssistant(`Agent-mode input failed: ${err.message || err}`);
      }
    }
    drainingInputs = false;
  };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let processingInput = false;
  let reconnecting = false;
  pollTimer = setInterval(async () => {
    if (stopping || processingInput || reconnecting) return;
    try {
      const res = await daemonRequest(`/remote/${remoteId}/input`);
      if (res.unknown) {
        logHeadless("Lost daemon registration. Attempting re-register...");
        reconnecting = true;
        try {
          await ensureDaemon();
          const regRes = await daemonRequest("/remote/register", "POST", {
            command: fullCommand,
            chatId,
            ownerUserId,
            cwd: process.cwd(),
            sessionId: remoteId,
            subscribedGroups: Array.from(subscribedGroups),
          });
          if (regRes.ok && boundChat) {
            await daemonRequest("/remote/bind-chat", "POST", {
              sessionId: remoteId,
              chatId: boundChat,
              ownerUserId,
            });
          }
          logHeadless("Re-registered with daemon.");
        } catch {
          // Re-registration failed — retry on next poll.
          logHeadlessErr("re-registration failed; will retry.");
        }
        reconnecting = false;
        return;
      }

      const controlAction = parseRemoteControlAction((res as { controlAction?: unknown }).controlAction);
      if (controlAction) {
        markActivity();
        await requestStop(controlAction, "control");
        return;
      }

      const lines = res.lines as string[] | undefined;
      if (lines && lines.length > 0) {
        markActivity();
        processingInput = true;
        for (const line of lines) enqueueInput(line, "user");
        processingInput = false;
      }

      const now = Date.now();
      if (
        pendingInputs.length === 0 &&
        now - lastActivityAt >= idleLogIntervalMs &&
        now - lastIdleLogAt >= idleLogIntervalMs
      ) {
        logHeadless("Alive and listening. Waiting for inbound messages...");
        lastIdleLogAt = now;
      }
    } catch {
      processingInput = false;
    }
  }, 200);

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const heartbeatState: HeartbeatRuntimeState = {
    lastEveryRunAtMs: new Map<string, number>(),
    lastAtRunDate: new Map<string, string>(),
    missingWorkflowWarned: new Set<string>(),
  };
  if (heartbeatEnabled) {
    const intervalMs = heartbeatInterval * 60 * 1000;
    heartbeatTimer = setInterval(() => {
      let raw: string;
      try {
        raw = readFileSync(heartbeatSourceFile, "utf-8");
      } catch {
        return;
      }

      const now = new Date();
      const ts = now.toISOString().replace("T", " ").slice(0, 16);
      const tick = resolveHeartbeatTick(raw, now, heartbeatInterval, heartbeatState, (workflowPath) => {
        try {
          return readFileSync(workflowPath, "utf-8");
        } catch {
          if (!heartbeatState.missingWorkflowWarned.has(workflowPath)) {
            console.error(`[heartbeat] Missing workflow file: ${workflowPath}`);
            heartbeatState.missingWorkflowWarned.add(workflowPath);
          }
          return null;
        }
      });

      if (tick.workflows.length > 0) {
        for (const wf of tick.workflows) {
          logHeadless(`heartbeat trigger: workflow "${wf.workflow}"`);
          enqueueInput(
            `❤ Heartbeat workflow trigger. The current time and date is: ${ts}. Workflow: ${wf.workflow}. Follow these instructions now if time and date is relevant:\n\n${wf.context}\n\n❤`,
            "heartbeat"
          );
        }
        return;
      }

      if (!tick.plainText) return;
      logHeadless("heartbeat trigger: plain heartbeat instructions");
      enqueueInput(
        `❤ This is a scheduled heartbeat message for workflows and cron jobs. The current time and date is: ${ts}. Follow these instructions now if time and date is relevant:\n\n${tick.plainText}\n\n❤`,
        "heartbeat"
      );
    }, intervalMs);
  }

  const signalPromise = new Promise<number>((resolve) => {
    const onSigInt = () => {
      void requestStop("stop", "signal");
      resolve(130);
    };
    const onSigTerm = () => {
      void requestStop("kill", "signal");
      resolve(143);
    };
    process.once("SIGINT", onSigInt);
    process.once("SIGTERM", onSigTerm);
  });

  const exitCode = await Promise.race([
    adapter.exited.then((code) => code ?? 1),
    signalPromise,
    stopRequestPromise,
  ]);
  stopSpinner();
  logHeadless(`stopping (exit code ${exitCode ?? 1}).`);

  stopping = true;
  await adapter.close(stopAction || "stop").catch(() => {});
  if (pollTimer) clearInterval(pollTimer);
  if (groupPollTimer) clearInterval(groupPollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  return exitCode;
}

export async function runRun(): Promise<void> {
  // Determine command: `tg claude [args]` or `tg codex [args]`
  const cmdName = process.argv[2];
  let cmdArgs = process.argv.slice(3);

  if (!cmdName || !SUPPORTED_COMMANDS[cmdName]) {
    console.error(`Usage: tg claude [args...], tg codex [args...], or tg pi [args...]`);
    process.exit(1);
  }

  // Extract touchgrass-specific flags (consumed by tg, not passed to the tool)
  let heartbeatInterval = 15; // minutes
  let agentMode = false;

  if (cmdArgs.includes("--tg-heartbeat")) {
    console.error("`--tg-heartbeat` has been removed.");
    console.error("Heartbeat now runs automatically when AGENTS.md contains <agent-heartbeat>.");
    process.exit(1);
  }

  if (cmdArgs.includes("--tg-interval")) {
    console.error("`--tg-interval` has been removed.");
    console.error("Set interval in AGENTS.md: <agent-heartbeat interval=\"15\">...</agent-heartbeat>");
    process.exit(1);
  }

  const removedHbArg = cmdArgs.find((arg) => arg === "--hb-interval" || arg.startsWith("--hb-interval="));
  if (removedHbArg) {
    console.error("`--hb-interval` has been removed.");
    console.error("Set interval in AGENTS.md: <agent-heartbeat interval=\"15\">...</agent-heartbeat>");
    process.exit(1);
  }

  if (cmdArgs.includes("--tg-send-files")) {
    console.error("`--tg-send-files` has been removed.");
    console.error("Use `tg send --file <session_id> <path>` to send files to session channel(s).");
    process.exit(1);
  }

  const legacyHeadlessIdx = cmdArgs.indexOf("--headless");
  if (legacyHeadlessIdx !== -1) {
    console.error("`--headless` has been renamed to `--agent-mode`.");
    process.exit(1);
  }

  const agentModeIdx = cmdArgs.indexOf("--agent-mode");
  if (agentModeIdx !== -1) {
    agentMode = true;
    cmdArgs = [...cmdArgs.slice(0, agentModeIdx), ...cmdArgs.slice(agentModeIdx + 1)];
  }

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
    ? channelFlag.split(":")[0]
    : undefined;

  const heartbeatSourceFile = join(process.cwd(), "AGENTS.md");
  let heartbeatEnabled = false;
  let heartbeatConfigured = false;
  let heartbeatConfig: HeartbeatConfig | null = null;
  try {
    if (statSync(heartbeatSourceFile).isFile()) {
      const rawAgents = readFileSync(heartbeatSourceFile, "utf-8");
      heartbeatConfig = parseHeartbeatConfig(rawAgents);
      heartbeatConfigured = !!heartbeatConfig;
    }
  } catch {}

  if (!agentMode && heartbeatConfigured) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const shouldEnableAgentMode = await promptAgentModeForHeartbeat(heartbeatSourceFile);
      if (shouldEnableAgentMode) {
        agentMode = true;
        console.log("⛳️ Enabling --agent-mode for this run.");
      } else {
        console.log("Continuing in terminal mode (heartbeat disabled).");
      }
    } else {
      console.log("AGENTS.md contains <agent-heartbeat>. Heartbeat runs only in --agent-mode.");
      console.log("Re-run with --agent-mode to enable heartbeat.");
    }
  }

  if (agentMode && heartbeatConfigured) {
    heartbeatEnabled = true;
    if (heartbeatConfig?.intervalMinutes && heartbeatConfig.intervalMinutes > 0) {
      heartbeatInterval = heartbeatConfig.intervalMinutes;
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
  let didBindChat = false;

  try {
    const config = await loadConfig();
    const pairedUsers = getAllPairedUsers(config);
    const owner = resolveOwnerChannel(config, preferredChannelTypeFromFlag);
    if (pairedUsers.length === 0) {
      console.error("No paired owner found. Run `tg pair` first.");
      process.exit(1);
    }
    if (!owner) {
      console.error("No usable paired channel owner found.");
      console.error("Ensure one paired user per channel in your config.");
      console.error(`Config: ${paths.config}`);
      process.exit(1);
    }
    if (owner) {
      const resolvedChannelName = owner.channelName;
      const resolvedChannelConfig = owner.channelConfig;
      ownerUserId = owner.ownerUserId;
      chatId = owner.ownerChatId;

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
          const options: Array<{ label: string; chatId: string; busy: boolean; title: string; type: string }> = [];
          // Allow opting out of channel binding immediately.
          options.push({ label: "No channel", chatId: "", busy: false, title: "No channel", type: "none" });
          let dmLabel = "DM";
          // Create channel early for bot name lookup
          const tempChannel = createChannel(resolvedChannelName, resolvedChannelConfig);
          try {
            if (tempChannel.getBotName) dmLabel = await tempChannel.getBotName();
          } catch {}
          const dmSuffix = dmBusy && dmBusyLabel ? `\x1b[2m(DM) ← ${dmBusyLabel}\x1b[22m` : "\x1b[2m(DM)\x1b[22m";
          options.push({ label: `${dmLabel} ${dmSuffix}`, chatId: chatId!, busy: dmBusy, title: dmLabel, type: "dm" });

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
            options.push({ label: `${g.title || g.chatId} ${suffix}`, chatId: g.chatId, busy: g.busy, title: g.title || g.chatId, type: "group" });
            // Insert topics belonging to this group immediately after
            for (const t of topicEntries) {
              if (t.parentChatId === g.chatId) {
                const tSuffix = t.busy && t.busyLabel ? `\x1b[2m(Topic) ← ${t.busyLabel}\x1b[22m` : "\x1b[2m(Topic)\x1b[22m";
                options.push({ label: `  ${t.title || "Topic"} ${tSuffix}`, chatId: t.chatId, busy: t.busy, title: t.title || "Topic", type: "topic" });
              }
            }
          }
          // Orphan topics (parent group not linked) — show at the end
          for (const t of topicEntries) {
            if (!groupEntries.some((g) => g.chatId === t.parentChatId)) {
              const tSuffix = t.busy && t.busyLabel ? `\x1b[2m(Topic) ← ${t.busyLabel}\x1b[22m` : "\x1b[2m(Topic)\x1b[22m";
              options.push({ label: `  ${t.title || "Topic"} ${tSuffix}`, chatId: t.chatId, busy: t.busy, title: t.title || "Topic", type: "topic" });
            }
          }

          if (channelFlag) {
            // --channel flag: resolve to a chatId and bind directly, skip picker
            const resolvedChatId = resolveChannelFlag(channelFlag, options, chatId!);
            if (resolvedChatId) {
              try {
                await daemonRequest("/remote/bind-chat", "POST", {
                  sessionId: remoteId,
                  chatId: resolvedChatId,
                  ownerUserId,
                });
                chatId = resolvedChatId as ChannelChatId;
                didBindChat = true;
              } catch (bindErr) {
                console.error(`\x1b[33m⚠ ${(bindErr as Error).message}\x1b[0m`);
                process.exit(1);
              }
            }
            // resolvedChatId === null means "none" — skip binding
          } else if (options.length === 2 && !dmBusy) {
            // Only DM + No channel, no groups — auto-bind to DM silently
            await daemonRequest("/remote/bind-chat", "POST", {
              sessionId: remoteId,
              chatId,
              ownerUserId,
            });
            didBindChat = true;
          } else {
            const labels = options.map((o) => o.label);
            const disabled = new Set<number>();
            options.forEach((o, idx) => {
              if (o.busy && o.chatId) disabled.add(idx);
            });
            const choice = await terminalPicker(
              "⛳ Select a channel:",
              labels,
              "Use `tg links` to manage linked channels (busy channels are disabled)",
              disabled
            );
            if (choice >= 0 && choice < options.length) {
              const chosen = options[choice];
              const typeLabel = chosen.type === "dm" ? "DM" : chosen.type === "group" ? "Group" : chosen.type === "topic" ? "Topic" : "";
              const selectedLabel = chosen.type === "none" ? "No channel" : `${chosen.title} (${typeLabel})`;
              if (!chosen.chatId) {
                console.log(`⛳️ Channel linked: ${selectedLabel}`);
              } else {
                try {
                  await daemonRequest("/remote/bind-chat", "POST", {
                    sessionId: remoteId,
                    chatId: chosen.chatId,
                    ownerUserId,
                  });
                  chatId = chosen.chatId as ChannelChatId;
                  didBindChat = true;
                  console.log(`⛳️ Channel linked: ${selectedLabel}`);
                } catch (bindErr) {
                  console.error(`\x1b[33m⚠ ${(bindErr as Error).message}. Keeping current channel binding.\x1b[0m`);
                }
              }
            }
          }
        }
      } catch {
        // Daemon failed to start — local-only mode
      }

      // Set up channel for JSONL watching
      if (!agentMode) {
        channel = createChannel(resolvedChannelName, resolvedChannelConfig);
      }

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

  if (agentMode) {
    if (!remoteId || !chatId || !ownerUserId) {
      console.error("Agent mode requires a paired user and an active daemon session.");
      console.error("Run `tg init` and `tg pair` first.");
      process.exit(1);
    }

    const exitCode = await runHeadlessSession({
      cmdName,
      executable,
      cmdArgs,
      remoteId,
      fullCommand,
      chatId,
      ownerUserId,
      didBindChat,
      heartbeatEnabled,
      heartbeatSourceFile,
      heartbeatInterval,
    });

    try {
      await daemonRequest(`/remote/${remoteId}/exit`, "POST", {
        exitCode: exitCode ?? null,
      });
    } catch {}
    await removeManifest(remoteId);
    process.exit(exitCode ?? 1);
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
    let codexResumeLast = false;
    if (cmdName === "codex") {
      const parsed = parseCodexResumeArgs(cmdArgs);
      resumeId = parsed.resumeId;
      codexResumeLast = parsed.useResumeLast;
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
          resumeSessionFile = findCodexSessionFileById(resumeId);
        }
      } catch {}
    }

    // Codex resume --last should tail whichever session file was active most recently.
    if (!resumeSessionFile && cmdName === "codex" && codexResumeLast) {
      resumeSessionFile = findLatestCodexSessionFile();
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

  // Prevent idle sleep on macOS while the agent is running
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
  let boundChat: ChannelChatId | null = remoteId && didBindChat ? chatId : null;
  let nullBoundPolls = 0;
  let groupPollTimer: ReturnType<typeof setInterval> | null = null;
  const getPrimaryTargetChat = (): ChannelChatId | null => remoteId ? boundChat : chatId;
  if (remoteId) {
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

  // Heartbeat: periodically send a message to the agent's terminal
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const heartbeatState: HeartbeatRuntimeState = {
    lastEveryRunAtMs: new Map<string, number>(),
    lastAtRunDate: new Map<string, string>(),
    missingWorkflowWarned: new Set<string>(),
  };
  if (heartbeatEnabled) {
    const intervalMs = heartbeatInterval * 60 * 1000;
    heartbeatTimer = setInterval(() => {
      let raw: string;
      try {
        raw = readFileSync(heartbeatSourceFile, "utf-8");
      } catch {
        return;
      }
      const now = new Date();
      const ts = now.toISOString().replace("T", " ").slice(0, 16);
      const tick = resolveHeartbeatTick(raw, now, heartbeatInterval, heartbeatState, (workflowPath) => {
        try {
          return readFileSync(workflowPath, "utf-8");
        } catch {
          if (!heartbeatState.missingWorkflowWarned.has(workflowPath)) {
            console.error(`[heartbeat] Missing workflow file: ${workflowPath}`);
            heartbeatState.missingWorkflowWarned.add(workflowPath);
          }
          return null;
        }
      });

      if (tick.workflows.length > 0) {
        for (const wf of tick.workflows) {
          const msg = `❤ Heartbeat workflow trigger. The current time and date is: ${ts}. Workflow: ${wf.workflow}. Follow these instructions now if time and date is relevant:\n\n${wf.context}\n\n❤`;
          terminal.write(Buffer.from(msg));
          setTimeout(() => terminal.write(Buffer.from("\r")), 100);
        }
        return;
      }

      if (!tick.plainText) return;
      const msg = `❤ This is a scheduled heartbeat message for workflows and cron jobs. The current time and date is: ${ts}. Follow these instructions now if time and date is relevant:\n\n${tick.plainText}\n\n❤`;
      terminal.write(Buffer.from(msg));
      setTimeout(() => terminal.write(Buffer.from("\r")), 100);
    }, intervalMs);
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
            // Agent is working — assert typing on all target chats
            const typingTarget = getPrimaryTargetChat();
            if (typingTarget) tgChannel.setTyping(typingTarget, true);
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
                isError: result.isError,
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
      }, onQuestion, onToolCall, onThinking, onToolResult, (msg) => {
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

    // Keep scanning for Claude rollovers (plan-mode handoff can create a new session file).
    if (cmdName === "claude") {
      dirScanTimer = setInterval(() => {
        checkForNewFiles();
      }, 2000);
    }
  }

  // Poll daemon for remote input if registered
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let processingInput = false;
  let reconnecting = false;
  if (remoteId) {
    pollTimer = setInterval(async () => {
      if (processingInput || reconnecting) return;
      try {
        const res = await daemonRequest(`/remote/${remoteId}/input`);

        // Daemon restarted and lost our session — re-register with the same ID
        if (res.unknown) {
          reconnecting = true;
          try {
            await ensureDaemon();
            const regRes = await daemonRequest("/remote/register", "POST", {
              command: fullCommand,
              chatId,
              ownerUserId,
              cwd: process.cwd(),
              sessionId: remoteId,
              subscribedGroups: Array.from(subscribedGroups),
            });
            if (regRes.ok) {
              // Restore the chat binding
              if (boundChat) {
                await daemonRequest("/remote/bind-chat", "POST", {
                  sessionId: remoteId,
                  chatId: boundChat,
                  ownerUserId,
                });
              }
            }
          } catch {
            // Re-registration failed — will retry on next poll
          }
          reconnecting = false;
          return;
        }

        const remoteControl = parseRemoteControlAction((res as { controlAction?: unknown }).controlAction);
        if (remoteControl === "stop") {
          terminal.write(Buffer.from("\x03"));
          return;
        }
        if (remoteControl === "kill") {
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
  if (caffeinateProc) caffeinateProc.kill();
  if (pollTimer) clearInterval(pollTimer);
  if (groupPollTimer) clearInterval(groupPollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (dirScanTimer) clearInterval(dirScanTimer);
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
    const { fmt } = channel;
    const status = exitCode === 0 ? "disconnected" : `disconnected (code ${exitCode ?? "unknown"})`;
    await channel.send(chatId, `Command ${fmt.code(fmt.escape(fullCommand))} ${fmt.escape(status)}.`);
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  process.exit(exitCode ?? 1);
}
