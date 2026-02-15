import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import type { PendingFilePickerOption, RemoteSession } from "../../session/manager";

const FILE_PICKER_PAGE_SIZE = 5;
const FILE_PICKER_MAX_FILES = 500;

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

export function buildFilePickerPage(
  files: string[],
  query: string,
  page: number,
  selectedMentions: string[] = [],
  pageSize: number = FILE_PICKER_PAGE_SIZE
): {
  page: number;
  totalPages: number;
  options: PendingFilePickerOption[];
  optionLabels: string[];
  title: string;
} {
  const totalPages = Math.max(1, Math.ceil(files.length / pageSize));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = currentPage * pageSize;
  const visible = files.slice(start, start + pageSize);
  const selected = new Set(selectedMentions);

  const options: PendingFilePickerOption[] = visible.map((path) => ({
    kind: "toggle",
    mention: `@${path}`,
  }));
  const optionLabels: string[] = visible.map((path) => {
    const mention = `@${path}`;
    return `${selected.has(mention) ? "✅" : "☑️"} ${mention}`;
  });

  if (totalPages > 1 && currentPage > 0) {
    options.push({ kind: "prev" });
    optionLabels.push("⬅️ Prev");
  }
  if (totalPages > 1 && currentPage < totalPages - 1) {
    options.push({ kind: "next" });
    optionLabels.push("➡️ Next");
  }
  if (selected.size > 0) {
    options.push({ kind: "clear" });
    optionLabels.push("🧹 Clear selected");
  }
  options.push({ kind: "cancel" });
  optionLabels.push("❌ Cancel");

  const q = query.trim();
  const title = q
    ? `Pick files (${q}) ${currentPage + 1}/${totalPages} • selected ${selected.size}`
    : `Pick files ${currentPage + 1}/${totalPages} • selected ${selected.size}`;

  return {
    page: currentPage,
    totalPages,
    options,
    optionLabels,
    title,
  };
}

export const __filePickerTestUtils = {
  buildFilePickerPage,
  fileScore,
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

  const ranked = rankFiles(files, query).slice(0, FILE_PICKER_MAX_FILES);
  if (ranked.length === 0) {
    await ctx.channel.send(chatId, `No files matched ${fmt.code(fmt.escape(query))}.`);
    return;
  }

  if (!ctx.channel.sendPoll) {
    const preview = ranked.slice(0, 12).map((path) => fmt.code(fmt.escape(`@${path}`))).join("\n");
    await ctx.channel.send(
      chatId,
      `${fmt.bold("This channel does not support inline picker buttons.")}\n${fmt.bold("Top matches:")}\n${preview}`
    );
    return;
  }

  const firstPage = buildFilePickerPage(ranked, query, 0, [], FILE_PICKER_PAGE_SIZE);
  const sent = await ctx.channel.sendPoll(chatId, firstPage.title, firstPage.optionLabels, false);
  ctx.sessionManager.registerFilePicker({
    pollId: sent.pollId,
    messageId: sent.messageId,
    chatId,
    ownerUserId: userId,
    sessionId: remote.id,
    files: ranked,
    query: query.trim(),
    page: firstPage.page,
    pageSize: FILE_PICKER_PAGE_SIZE,
    totalPages: firstPage.totalPages,
    selectedMentions: [],
    options: firstPage.options,
  });
}
