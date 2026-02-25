import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { paths } from "../config/paths";

interface SessionManifest {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  jsonlFile: string | null;
  startedAt: string;
}

function readManifests(): Map<string, SessionManifest> {
  const manifests = new Map<string, SessionManifest>();
  try {
    for (const f of readdirSync(paths.sessionsDir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = readFileSync(join(paths.sessionsDir, f), "utf-8");
        const m = JSON.parse(data) as SessionManifest;
        manifests.set(m.id, m);
      } catch {}
    }
  } catch {}
  return manifests;
}

function resolveManifest(partial: string): SessionManifest {
  const manifests = readManifests();
  if (manifests.size === 0) {
    throw new Error("No session manifests found. Is a session running?");
  }

  // Exact match
  const exact = manifests.get(partial);
  if (exact) return exact;

  // Substring match
  const matches: SessionManifest[] = [];
  for (const m of manifests.values()) {
    if (m.id.includes(partial)) matches.push(m);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous session ID "${partial}" — matches: ${matches.map((m) => m.id).join(", ")}`
    );
  }

  throw new Error(
    `No session matching "${partial}". Available: ${Array.from(manifests.keys()).join(", ")}`
  );
}

// Map tool_use_id → tool name for labeling results
const idToName = new Map<string, string>();

export interface DisplayEntry {
  role: "assistant" | "user" | "tool";
  text: string;
}

function extractEntries(msg: Record<string, unknown>): DisplayEntry[] {
  const entries: DisplayEntry[] = [];

  // Claude format: {"type":"assistant","message":{"content":[...]}}
  if (msg.type === "assistant") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (m?.content && Array.isArray(m.content)) {
      const content = m.content as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          const text = (block.text as string).trim();
          if (text) entries.push({ role: "assistant", text });
        }
        if (block.type === "tool_use" && typeof block.name === "string") {
          const toolId = (block.id as string) || "";
          if (toolId) idToName.set(toolId, block.name);
          const input = (block.input as Record<string, unknown>) || {};
          const summary = summarizeToolInput(block.name, input);
          entries.push({ role: "tool", text: `${block.name}: ${summary}` });
        }
      }
    }
    return entries;
  }

  // Claude format: {"type":"user","message":{"content":[...]}}
  if (msg.type === "user") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (m?.content && Array.isArray(m.content)) {
      const content = m.content as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          const text = (block.text as string).trim();
          if (text) entries.push({ role: "user", text });
        }
        // Skip tool_result blocks (too verbose)
      }
    } else if (m?.role === "user" && typeof m?.content === "string") {
      const text = (m.content as string).trim();
      if (text) entries.push({ role: "user", text });
    }
    return entries;
  }

  // PI format: {"type":"message","message":{"role":"assistant"|"user",...}}
  if (msg.type === "message") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (!m) return entries;
    const role = m.role as string;
    if (role === "assistant" && m.content && Array.isArray(m.content)) {
      const content = m.content as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          const text = (block.text as string).trim();
          if (text) entries.push({ role: "assistant", text });
        }
        if (block.type === "toolCall" && typeof block.name === "string") {
          const toolId = (block.id as string) || "";
          if (toolId) idToName.set(toolId, block.name);
          const input = (block.arguments as Record<string, unknown>) || {};
          const summary = summarizeToolInput(block.name, input);
          entries.push({ role: "tool", text: `${block.name}: ${summary}` });
        }
      }
    }
    if (role === "user" && m.content && Array.isArray(m.content)) {
      const content = m.content as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          const text = (block.text as string).trim();
          if (text) entries.push({ role: "user", text });
        }
      }
    }
    return entries;
  }

  // Codex format
  if (msg.type === "event_msg") {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (payload?.type === "agent_message" && typeof payload.message === "string") {
      const text = (payload.message as string).trim();
      if (text) entries.push({ role: "assistant", text });
    }
    return entries;
  }

  if (msg.type === "response_item") {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (!payload) return entries;
    if (payload.type === "message" && payload.role === "assistant" && Array.isArray(payload.content)) {
      const content = payload.content as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === "output_text" && typeof block.text === "string") {
          const text = (block.text as string).trim();
          if (text) entries.push({ role: "assistant", text });
        }
      }
    }
    if (payload.type === "function_call" && typeof payload.name === "string") {
      const callId = (payload.call_id as string) || "";
      if (callId) idToName.set(callId, payload.name);
      entries.push({ role: "tool", text: `${payload.name}` });
    }
    return entries;
  }

  return entries;
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash":
    case "bash":
    case "exec_command": {
      const cmd = (input.command as string) || (input.cmd as string) || "";
      return truncate(cmd, 80);
    }
    case "Read": {
      const fp = input.file_path as string;
      return fp || "?";
    }
    case "Edit":
    case "Write": {
      const fp = input.file_path as string;
      return fp || "?";
    }
    case "Glob": {
      const pattern = input.pattern as string;
      return pattern || "?";
    }
    case "Grep": {
      const pattern = input.pattern as string;
      return pattern || "?";
    }
    case "Task": {
      const desc = input.description as string;
      return desc ? truncate(desc, 60) : "subagent";
    }
    case "WebSearch": {
      const query = input.query as string;
      return query ? truncate(query, 60) : "search";
    }
    default:
      return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

function formatEntry(entry: DisplayEntry): string {
  switch (entry.role) {
    case "assistant": {
      const lines = entry.text.split("\n");
      const preview = lines.length > 6 ? lines.slice(0, 6).join("\n") + "\n..." : entry.text;
      return `${CYAN}[Assistant]${RESET} ${preview}`;
    }
    case "user":
      return `${GREEN}[User]${RESET} ${entry.text}`;
    case "tool":
      return `${YELLOW}[Tool]${RESET} ${DIM}${entry.text}${RESET}`;
  }
}

function parseCount(countArg: string | undefined): number {
  const count = countArg ? parseInt(countArg, 10) : 10;
  if (isNaN(count) || count <= 0) {
    throw new Error("Count must be a positive number.");
  }
  return count;
}

export function collectEntriesFromRaw(raw: string, count: number): DisplayEntry[] {
  // Take last ~50 raw lines to parse (more than count since tool calls etc. produce entries)
  const rawLines = raw.trim().split("\n");
  const tail = rawLines.slice(-(count * 5));

  const allEntries: DisplayEntry[] = [];
  for (const line of tail) {
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const entries = extractEntries(msg);
      allEntries.push(...entries);
    } catch {}
  }

  // Take last `count` entries
  return allEntries.slice(-count);
}

function printUsage(): void {
  console.error("Usage: touchgrass peek <session_id> [count]");
  console.error("   or: tg peek --all [count]");
  console.error("Example: tg peek r-abc123 20");
  console.error("Example: tg peek --all 1");
}

function sessionStartedAtMs(m: SessionManifest): number {
  const ms = Date.parse(m.startedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

export async function runPeek(): Promise<void> {
  const args = process.argv.slice(3);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  if (args[0] === "--all") {
    if (args.length > 2) {
      printUsage();
      process.exit(1);
    }
    let count: number;
    try {
      count = parseCount(args[1]);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }

    const manifests = Array.from(readManifests().values()).sort(
      (a, b) => sessionStartedAtMs(b) - sessionStartedAtMs(a)
    );
    if (manifests.length === 0) {
      console.log("No session manifests found. Is a session running?");
      return;
    }

    let shown = 0;
    for (const manifest of manifests) {
      if (!manifest.jsonlFile) continue;
      let raw: string;
      try {
        raw = readFileSync(manifest.jsonlFile, "utf-8");
      } catch {
        continue;
      }
      const display = collectEntriesFromRaw(raw, count);
      if (display.length === 0) continue;

      if (shown > 0) console.log("");
      console.log(`${DIM}--- ${manifest.id} (${manifest.command}) ---${RESET}\n`);
      for (const entry of display) {
        console.log(formatEntry(entry));
      }
      shown++;
    }

    if (shown === 0) {
      console.log("No messages found for any session.");
    }
    return;
  }

  if (args.length > 2) {
    printUsage();
    process.exit(1);
  }

  const sessionArg = args[0];
  let count: number;
  try {
    count = parseCount(args[1]);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const manifest = resolveManifest(sessionArg);
  if (!manifest.jsonlFile) {
    console.error(`Session ${manifest.id} has no JSONL file recorded.`);
    process.exit(1);
  }
  let raw: string;
  try {
    raw = readFileSync(manifest.jsonlFile, "utf-8");
  } catch {
    console.error(`Cannot read JSONL file: ${manifest.jsonlFile}`);
    process.exit(1);
  }

  const display = collectEntriesFromRaw(raw, count);

  if (display.length === 0) {
    console.log(`No messages found for session ${manifest.id}.`);
    return;
  }

  console.log(`${DIM}--- ${manifest.id} (${manifest.command}) ---${RESET}\n`);
  for (const entry of display) {
    console.log(formatEntry(entry));
  }
}
