import { mkdir, stat } from "fs/promises";
import { resolve } from "path";
import { loadConfig } from "../config/store";
import type { ChannelConfig, TgConfig } from "../config/schema";
import { getAllPairedUsers } from "../config/schema";
import type { ChannelChatId } from "../channel/types";
import { createChannel } from "../channel/factory";
import { ensureDaemon } from "./ensure-daemon";
import {
  buildCurrentCliCommandPrefix,
  clearControlCenterState,
  saveControlCenterState,
} from "../control-center/state";

function parseRootArg(): string {
  const args = process.argv.slice(3);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" && args[i + 1]) {
      return resolve(args[i + 1]);
    }
    if (arg.startsWith("--root=")) {
      return resolve(arg.slice("--root=".length));
    }
  }
  return resolve(process.cwd());
}

function findOwnerChannel(config: TgConfig, ownerUserId: string): { name: string; channel: ChannelConfig } | null {
  for (const [name, channel] of Object.entries(config.channels || {})) {
    if (channel.pairedUsers?.some((user) => user.userId === ownerUserId)) {
      return { name, channel };
    }
  }
  return null;
}

function buildStartNotice(rootDir: string): string {
  return [
    "🏕️ Touchgrass Camp is active.",
    `Root: ${rootDir}`,
    "",
    "How to use:",
    "/start claude|codex|pi [project-name]",
    "/stop",
    "",
    "Only the owner can start/stop Camp sessions.",
  ].join("\n");
}

function buildStopNotice(rootDir: string): string {
  return [
    "🏕️ Touchgrass Camp stopped.",
    `Root was: ${rootDir}`,
    "",
    "Restart with:",
    `bun run src/main.ts camp --root ${rootDir}`,
  ].join("\n");
}

async function notifyOwnerDm(
  config: TgConfig | null,
  ownerUserId: string,
  message: string
): Promise<void> {
  if (!config) return;
  const ownerChannel = findOwnerChannel(config, ownerUserId);
  if (!ownerChannel) return;
  try {
    const channel = createChannel(ownerChannel.name, ownerChannel.channel);
    await channel.send(ownerUserId as ChannelChatId, message);
  } catch (e) {
    console.error(`Warning: could not send Camp notice to owner DM: ${(e as Error).message}`);
  }
}

export async function runControlCenter(): Promise<void> {
  const rootDir = parseRootArg();

  try {
    await mkdir(rootDir, { recursive: true });
    const s = await stat(rootDir);
    if (!s.isDirectory()) {
      throw new Error("Root path is not a directory");
    }
  } catch (e) {
    console.error(`Invalid root directory: ${rootDir}`);
    console.error((e as Error).message);
    process.exit(1);
  }

  let ownerUserId: string | undefined;
  let config: TgConfig | null = null;
  try {
    config = await loadConfig();
    const paired = getAllPairedUsers(config);
    ownerUserId = paired.length > 0 ? paired[0].userId : undefined;
  } catch {
    config = null;
  }

  if (!ownerUserId) {
    console.error("Camp requires a paired owner account.");
    console.error("Run tg pair, complete /pair in Telegram DM, then start Camp again.");
    process.exit(1);
  }

  try {
    await ensureDaemon();
  } catch (e) {
    console.error(`Failed to start daemon: ${(e as Error).message}`);
    process.exit(1);
  }

  await saveControlCenterState({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    rootDir,
    commandPrefix: buildCurrentCliCommandPrefix(),
    ownerUserId,
  });

  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    await notifyOwnerDm(config, ownerUserId, buildStopNotice(rootDir));
    await clearControlCenterState();
    process.exit(0);
  };

  process.on("SIGINT", () => void cleanup());
  process.on("SIGTERM", () => void cleanup());
  process.on("exit", () => {
    void clearControlCenterState();
  });

  console.log(`🏕️ Camp active`);
  console.log(`Root directory: ${rootDir}`);
  console.log(`Use /start in Telegram groups/topics to spin up sessions in this root.`);
  console.log(`Press Ctrl+C to stop Camp.`);

  await notifyOwnerDm(config, ownerUserId, buildStartNotice(rootDir));

  // Keep this command running as an explicit "control plane" process.
  // The daemon does the actual work; this process holds mode state/lifecycle.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await Bun.sleep(60_000);
  }
}
