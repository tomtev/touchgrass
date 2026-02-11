import { loadConfig } from "../config/store";
import { getTelegramBotToken, getAllPairedUsers } from "../config/schema";
import { TelegramChannel } from "../channels/telegram/channel";
import type { Channel, ChannelChatId } from "../channel/types";
import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { markdownToHtml } from "../utils/ansi";
import { paths, ensureDirs } from "../config/paths";
import { watch, readdirSync, type FSWatcher } from "fs";
import { readFile, writeFile, unlink } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

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
  await writeFile(file, JSON.stringify(manifest, null, 2), "utf-8");
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
// - Codex:  {"type":"response_item", "payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}]}}
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

  // Codex format
  if (msg.type === "response_item") {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (payload?.type !== "message" || payload?.role !== "assistant") return null;
    const content = payload.content as Array<{ type: string; text?: string }> | undefined;
    if (!content) return null;
    const texts = content
      .filter((b) => b.type === "output_text" || b.type === "text")
      .map((b) => b.text ?? "");
    const text = texts.join("\n").trim();
    return text || null;
  }

  return null;
}

// Watch a JSONL file for new assistant messages.
// File is always newly created (caller verifies via existingFiles check),
// so all content belongs to our session — process from line 0.
function watchSessionFile(
  filePath: string,
  onAssistant: (text: string) => void
): FSWatcher {
  let processedLines = 0;

  async function processFile() {
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n").filter(Boolean);

      for (let i = processedLines; i < lines.length; i++) {
        try {
          const msg = JSON.parse(lines[i]);
          const assistantText = extractAssistantText(msg);
          if (assistantText) onAssistant(assistantText);
        } catch {}
      }
      processedLines = lines.length;
    } catch {}
  }

  // Process any content already in the file (e.g. PI writes response before we find the file)
  processFile();

  const watcher = watch(filePath, () => processFile());
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

  // Extract --name flag (consumed by tg, not passed to the tool)
  let sessionName: string | null = null;
  const nameIdx = cmdArgs.indexOf("--name");
  if (nameIdx !== -1 && nameIdx + 1 < cmdArgs.length) {
    sessionName = cmdArgs[nameIdx + 1];
    cmdArgs = [...cmdArgs.slice(0, nameIdx), ...cmdArgs.slice(nameIdx + 2)];
  }

  const executable = SUPPORTED_COMMANDS[cmdName][0];
  const fullCommand = [executable, ...cmdArgs].join(" ");
  const displayName = sessionName || process.cwd().split("/").pop() || "";

  // Try to register with daemon as a remote session
  let remoteId: string | null = null;
  let channel: Channel | null = null;
  let chatId: ChannelChatId | null = null;

  try {
    const config = await loadConfig();
    const pairedUsers = getAllPairedUsers(config);
    const botToken = getTelegramBotToken(config);
    if (pairedUsers.length > 0 && botToken) {
      chatId = pairedUsers[0].userId.startsWith("telegram:")
        ? `telegram:${pairedUsers[0].userId.split(":")[1]}`
        : pairedUsers[0].userId;

      try {
        await ensureDaemon();
        const res = await daemonRequest("/remote/register", "POST", {
          command: fullCommand,
          chatId,
          cwd: process.cwd(),
          name: sessionName,
        });
        if (res.ok && res.sessionId) {
          remoteId = res.sessionId as string;
        }
      } catch {
        // Daemon failed to start — local-only mode
      }

      // Set up channel for JSONL watching
      channel = new TelegramChannel(botToken);

      // Wire message tracking: report sent message refs to daemon for reply-to routing
      if (remoteId) {
        const trackRemoteId = remoteId;
        channel.onMessageSent = (msgRef: string) => {
          daemonRequest(`/remote/${trackRemoteId}/track-message`, "POST", { msgRef }).catch(() => {});
        };
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

  // Snapshot existing JSONL files BEFORE spawning so the tool's new file is detected
  const projectDir = channel && chatId ? getSessionDir(cmdName) : "";
  const existingFiles = new Set<string>();
  if (projectDir) {
    try {
      for (const f of readdirSync(projectDir)) {
        if (f.endsWith(".jsonl")) existingFiles.add(f);
      }
    } catch {}
  }

  // Use raw mode if stdin is a TTY so keypresses are forwarded immediately
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  const proc = Bun.spawn([executable, ...cmdArgs], {
    terminal: {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      data(_terminal, data) {
        process.stdout.write(data);
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
  let groupPollTimer: ReturnType<typeof setInterval> | null = null;
  if (remoteId) {
    const pollRemoteId = remoteId;
    groupPollTimer = setInterval(async () => {
      try {
        const res = await daemonRequest(`/remote/${pollRemoteId}/subscribed-groups`);
        const chatIds = res.chatIds as string[] | undefined;
        if (chatIds) {
          for (const id of chatIds) subscribedGroups.add(id);
        }
      } catch {}
    }, 2000);
  }

  // Watch session JSONL for assistant responses.
  const watcherRef: { current: FSWatcher | null; dir: FSWatcher | null } = { current: null, dir: null };
  if (channel && chatId && projectDir) {
    const tgChatId = chatId;
    const tgChannel = channel;
    const tgRemoteId = remoteId;

    const startFileWatch = (sessionFile: string) => {
      if (watcherRef.current) return; // already watching
      // Update manifest with discovered JSONL file
      if (manifest) {
        manifest.jsonlFile = sessionFile;
        writeManifest(manifest).catch(() => {});
      }
      watcherRef.current = watchSessionFile(sessionFile, (text) => {
        const tag = tgRemoteId
          ? `<b>${displayName}</b> [${executable}] <i>(${tgRemoteId})</i>\n`
          : "";
        const html = `${tag}${markdownToHtml(text)}`;
        tgChannel.send(tgChatId, html, tgRemoteId ?? undefined);
        // Also send to subscribed group chats
        for (const groupChatId of subscribedGroups) {
          tgChannel.send(groupChatId, html, tgRemoteId ?? undefined);
        }
      });
      if (watcherRef.dir) {
        watcherRef.dir.close();
        watcherRef.dir = null;
      }
    };

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
  if (remoteId) {
    pollTimer = setInterval(async () => {
      try {
        const res = await daemonRequest(`/remote/${remoteId}/input`);
        const lines = res.lines as string[] | undefined;
        if (lines && lines.length > 0) {
          for (let i = 0; i < lines.length; i++) {
            const baseDelay = i * 150;
            setTimeout(() => {
              // Write the text first
              terminal.write(Buffer.from(lines[i]));
              // Then send Enter separately after app processes the text
              setTimeout(() => {
                terminal.write(Buffer.from("\r"));
              }, 100);
            }, baseDelay);
          }
        }
      } catch {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
      }
    }, 200);
  }

  const exitCode = await proc.exited;

  // Cleanup
  if (pollTimer) clearInterval(pollTimer);
  if (groupPollTimer) clearInterval(groupPollTimer);
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
    await channel.send(chatId, `Command <code>${fullCommand}</code> ${status}.`);
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  process.exit(exitCode ?? 1);
}
