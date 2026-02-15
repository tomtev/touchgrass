import { randomBytes } from "crypto";
import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import type { RemoteSession } from "../../session/manager";

const FILE_PICKER_TTL_MS = 10 * 60 * 1000;
const WEB_APP_PARAM = "tgfp";
const MAX_WEBAPP_FILES = 60;

interface WebAppSelectionPayload {
  kind: "tg_files_pick";
  token: string;
  file: string;
}

interface WebAppOpenPayload {
  v: 1;
  token: string;
  files: string[];
  query: string;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/^\.?\//, "").trim();
}

function runLines(cmd: string[], cwd: string): string[] {
  try {
    const res = Bun.spawnSync(cmd, {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    if (res.exitCode !== 0) return [];
    const out = new TextDecoder().decode(res.stdout);
    return out
      .split(/\r?\n/)
      .map((line) => normalizeRelativePath(line))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isGitRepo(cwd: string): boolean {
  const lines = runLines(["git", "-C", cwd, "rev-parse", "--is-inside-work-tree"], cwd);
  return lines[0] === "true";
}

function listRepoFiles(cwd: string): string[] {
  if (isGitRepo(cwd)) {
    const lines = runLines(["git", "-C", cwd, "ls-files", "-co", "--exclude-standard"], cwd);
    if (lines.length > 0) return lines;
  }

  const rgLines = runLines(["rg", "--files", "--hidden", "-g", "!.git"], cwd);
  if (rgLines.length > 0) return rgLines;

  return runLines(["find", ".", "-type", "f", "!", "-path", "*/.git/*"], cwd).map(normalizeRelativePath);
}

function subsequenceScore(text: string, query: string): number {
  let score = 0;
  let j = 0;
  for (let i = 0; i < text.length && j < query.length; i++) {
    if (text[i] === query[j]) {
      score += i;
      j++;
    }
  }
  return j === query.length ? score : Number.POSITIVE_INFINITY;
}

function fileScore(path: string, query: string): number {
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  const base = p.split("/").pop() || p;
  if (p === q || base === q) return 0;
  if (base.startsWith(q)) return 1;
  if (p.startsWith(q)) return 2;
  if (base.includes(q)) return 3;
  if (p.includes(q)) return 4;
  const seq = subsequenceScore(p, q);
  if (!Number.isFinite(seq)) return Number.POSITIVE_INFINITY;
  return 5 + seq / 10000;
}

function rankFiles(files: string[], query: string): string[] {
  const cleaned = files.map(normalizeRelativePath).filter(Boolean);
  if (!query.trim()) {
    return cleaned.sort((a, b) => {
      const da = a.split("/").length;
      const db = b.split("/").length;
      if (da !== db) return da - db;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });
  }

  return cleaned
    .map((path) => ({ path, score: fileScore(path, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const da = a.path.split("/").length;
      const db = b.path.split("/").length;
      if (da !== db) return da - db;
      if (a.path.length !== b.path.length) return a.path.length - b.path.length;
      return a.path.localeCompare(b.path);
    })
    .map((entry) => entry.path);
}

function resolveTargetRemote(msg: InboundMessage, ctx: RouterContext): RemoteSession | null {
  const attached = ctx.sessionManager.getAttachedRemote(msg.chatId);
  if (attached && attached.ownerUserId === msg.userId) return attached;
  if (attached && attached.ownerUserId !== msg.userId) return null;

  const remotes = ctx.sessionManager.listRemotesForUser(msg.userId);
  if (remotes.length === 1 && !msg.isGroup) return remotes[0];
  return null;
}

function getWebAppBaseUrl(ctx: RouterContext): string {
  const tgCredentials = ctx.config.channels.telegram?.credentials as Record<string, unknown> | undefined;
  const fromConfig = typeof tgCredentials?.webAppUrl === "string" ? tgCredentials.webAppUrl.trim() : "";
  const fromEnv = (process.env.TG_TELEGRAM_FILE_PICKER_URL || "").trim();
  return fromConfig || fromEnv;
}

function buildWebAppUrl(baseUrl: string, payload: WebAppOpenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  try {
    const url = new URL(baseUrl);
    url.searchParams.set(WEB_APP_PARAM, encoded);
    return url.toString();
  } catch {
    const sep = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${sep}${WEB_APP_PARAM}=${encodeURIComponent(encoded)}`;
  }
}

function parseWebAppSelectionPayload(raw: string): WebAppSelectionPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates = new Set<string>([trimmed]);
  if (trimmed.includes("%")) {
    try {
      candidates.add(decodeURIComponent(trimmed));
    } catch {
      // ignore malformed URI input
    }
  }
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    try {
      candidates.add(Buffer.from(trimmed, "base64url").toString("utf8"));
    } catch {
      // ignore malformed base64 input
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<WebAppSelectionPayload>;
      if (parsed.kind !== "tg_files_pick") continue;
      if (typeof parsed.token !== "string" || !parsed.token.trim()) continue;
      if (typeof parsed.file !== "string" || !parsed.file.trim()) continue;
      return {
        kind: "tg_files_pick",
        token: parsed.token.trim(),
        file: normalizeRelativePath(parsed.file),
      };
    } catch {
      // not JSON
    }
  }

  return null;
}

export const __filePickerTestUtils = {
  buildWebAppUrl,
  fileScore,
  parseWebAppSelectionPayload,
  rankFiles,
  subsequenceScore,
};

export async function handleFilesCommand(
  msg: InboundMessage,
  query: string,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const userId = msg.userId;
  const { fmt } = ctx.channel;

  const remote = resolveTargetRemote(msg, ctx);
  if (!remote) {
    await ctx.channel.send(
      chatId,
      `No connected session for this chat. Start with ${fmt.code("tg claude")} (or ${fmt.code("tg codex")}, ${fmt.code("tg pi")}) and connect this channel first.`
    );
    return;
  }

  if (!remote.cwd) {
    await ctx.channel.send(chatId, "This session does not expose a working directory for file search.");
    return;
  }

  const files = listRepoFiles(remote.cwd);
  if (files.length === 0) {
    await ctx.channel.send(chatId, `No files found in ${fmt.code(fmt.escape(remote.cwd))}.`);
    return;
  }

  const ranked = rankFiles(files, query).slice(0, MAX_WEBAPP_FILES);
  if (ranked.length === 0) {
    await ctx.channel.send(chatId, `No files matched ${fmt.code(fmt.escape(query))}.`);
    return;
  }

  const baseUrl = getWebAppBaseUrl(ctx);
  if (!ctx.channel.sendWebAppButton || !baseUrl || !baseUrl.startsWith("https://")) {
    const preview = ranked.slice(0, 12).map((path) => fmt.code(fmt.escape(`@${path}`))).join("\n");
    await ctx.channel.send(
      chatId,
      `${fmt.bold("File picker popup is not configured.")}\nSet ${fmt.code("channels.telegram.credentials.webAppUrl")} in ${fmt.code("~/.touchgrass/config.json")} to an ${fmt.code("https://")} URL for the picker web app.\n\n${fmt.bold("Top matches:")}\n${preview}`
    );
    return;
  }

  const token = `wfp-${randomBytes(8).toString("hex")}`;
  ctx.sessionManager.registerWebFilePicker({
    token,
    chatId,
    ownerUserId: userId,
    sessionId: remote.id,
    files: ranked,
    expiresAt: Date.now() + FILE_PICKER_TTL_MS,
  });

  const openUrl = buildWebAppUrl(baseUrl, {
    v: 1,
    token,
    files: ranked,
    query: query.trim(),
  });

  const title = query.trim()
    ? `${fmt.bold("File picker")} ${fmt.escape(`(${query.trim()})`)}`
    : fmt.bold("File picker");
  await ctx.channel.sendWebAppButton(
    chatId,
    `${fmt.escape("📎")} ${title}\n${fmt.escape("Open the popup and choose a file for your next message.")}`,
    "Open file picker",
    openUrl
  );
}

export async function handleFilesPickCommand(
  msg: InboundMessage,
  payloadRaw: string,
  ctx: RouterContext
): Promise<void> {
  const { fmt } = ctx.channel;
  const chatId = msg.chatId;
  const parsed = parseWebAppSelectionPayload(payloadRaw);
  if (!parsed) {
    await ctx.channel.send(chatId, "Invalid file picker payload.");
    return;
  }

  const picker = ctx.sessionManager.consumeWebFilePicker(parsed.token);
  if (!picker) {
    await ctx.channel.send(chatId, "That picker expired. Run /files again.");
    return;
  }

  if (picker.ownerUserId !== msg.userId || picker.chatId !== chatId) {
    await ctx.channel.send(chatId, "This picker belongs to a different user or chat.");
    return;
  }

  if (!picker.files.includes(parsed.file)) {
    await ctx.channel.send(chatId, "That file is not in the current picker results.");
    return;
  }

  const mention = `@${parsed.file}`;
  ctx.sessionManager.setPendingFileMentions(
    picker.sessionId,
    picker.chatId,
    picker.ownerUserId,
    [mention]
  );
  await ctx.channel.send(
    chatId,
    `${fmt.escape("📎")} File selected for next message: ${fmt.code(fmt.escape(mention))}`
  );
}
