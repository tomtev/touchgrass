import { createInterface, type Interface } from "readline/promises";
import { TelegramApi } from "../channels/telegram/api";
import { loadConfig, saveConfig } from "../config/store";
import { getTelegramBotToken, getTelegramChannelEntries, type ChannelConfig, type TgConfig } from "../config/schema";
import { paths } from "../config/paths";
import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { isDaemonRunning, readPidFile } from "../daemon/lifecycle";

interface SetupCliOptions {
  telegramToken?: string;
  channelName: string;
  listChannels: boolean;
  showChannel: boolean;
  help: boolean;
}

function printSetupUsage(): void {
  console.log(`Usage: touchgrass setup [options]

Options:
  --telegram <token>    Configure Telegram bot token non-interactively
  --channel <name>      Configure a named Telegram channel entry (default: telegram)
  --list-channels       List configured Telegram channel entries
  --show                Show details for the selected channel (use with --channel)
  -h, --help            Show this help message`);
}

function parseSetupArgs(argv: string[]): SetupCliOptions {
  const opts: SetupCliOptions = { help: false, channelName: "telegram", listChannels: false, showChannel: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (arg === "--telegram") {
      const token = argv[i + 1];
      if (!token || token.startsWith("--")) {
        throw new Error("--telegram requires a token value.");
      }
      opts.telegramToken = token;
      i++;
      continue;
    }
    if (arg.startsWith("--telegram=")) {
      const token = arg.slice("--telegram=".length).trim();
      if (!token) {
        throw new Error("--telegram requires a token value.");
      }
      opts.telegramToken = token;
      continue;
    }
    if (arg === "--channel") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--channel requires a channel name.");
      }
      opts.channelName = value.trim();
      i++;
      continue;
    }
    if (arg.startsWith("--channel=")) {
      const value = arg.slice("--channel=".length).trim();
      if (!value) {
        throw new Error("--channel requires a channel name.");
      }
      opts.channelName = value;
      continue;
    }
    if (arg === "--list-channels") {
      opts.listChannels = true;
      continue;
    }
    if (arg === "--show") {
      opts.showChannel = true;
      continue;
    }
    throw new Error(`Unknown option for touchgrass setup: ${arg}`);
  }

  const channelName = opts.channelName.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(channelName)) {
    throw new Error("Invalid --channel value. Use letters/numbers/_/- and start with a letter.");
  }
  opts.channelName = channelName;

  if (opts.listChannels && opts.telegramToken) {
    throw new Error("--list-channels cannot be used with --telegram.");
  }
  if (opts.showChannel && opts.telegramToken) {
    throw new Error("--show cannot be used with --telegram.");
  }
  if (opts.listChannels && opts.showChannel) {
    throw new Error("Use either --list-channels or --show, not both.");
  }

  return opts;
}

function parseTokenAction(answer: string): "use" | "overwrite" | "abort" {
  const normalized = answer.trim().toLowerCase();
  if (
    normalized === "" ||
    normalized === "use" ||
    normalized === "u" ||
    normalized === "keep" ||
    normalized === "k" ||
    normalized === "n" ||
    normalized === "no"
  ) {
    return "use";
  }
  if (
    normalized === "overwrite" ||
    normalized === "o" ||
    normalized === "y" ||
    normalized === "yes"
  ) {
    return "overwrite";
  }
  if (normalized === "abort" || normalized === "a" || normalized === "quit" || normalized === "q") {
    return "abort";
  }
  return "use";
}

async function promptTelegramToken(rl: Interface): Promise<string> {
  console.log("1. Open Telegram and talk to @BotFather");
  console.log("2. Send /newbot and follow the prompts");
  console.log("3. Copy the bot token\n");
  return (await rl.question("Paste your bot token: ")).trim();
}

async function validateTelegramToken(token: string): Promise<{ username?: string; firstName?: string }> {
  const api = new TelegramApi(token);
  const me = await api.getMe();
  return { username: me.username, firstName: me.first_name };
}

function getStoredBotIdentity(channel: ChannelConfig): { username?: string; firstName?: string } {
  const credentials = channel.credentials as Record<string, unknown>;
  const username = typeof credentials.botUsername === "string" ? credentials.botUsername.trim() : "";
  const firstName = typeof credentials.botFirstName === "string" ? credentials.botFirstName.trim() : "";
  return {
    username: username || undefined,
    firstName: firstName || undefined,
  };
}

function storeBotIdentity(
  channel: ChannelConfig,
  identity: { username?: string; firstName?: string }
): boolean {
  const credentials = channel.credentials as Record<string, unknown>;
  const prevUsername = typeof credentials.botUsername === "string" ? credentials.botUsername : "";
  const prevFirstName = typeof credentials.botFirstName === "string" ? credentials.botFirstName : "";
  const nextUsername = identity.username?.trim() || "";
  const nextFirstName = identity.firstName?.trim() || "";
  const changed = prevUsername !== nextUsername || prevFirstName !== nextFirstName;
  if (!changed) return false;

  if (nextUsername) credentials.botUsername = nextUsername;
  else delete credentials.botUsername;
  if (nextFirstName) credentials.botFirstName = nextFirstName;
  else delete credentials.botFirstName;
  return true;
}

function countActiveDaemonSessions(status: Record<string, unknown>): number {
  const sessions = status.sessions;
  if (!Array.isArray(sessions)) return 0;
  let active = 0;
  for (const entry of sessions) {
    if (!entry || typeof entry !== "object") continue;
    const state = (entry as { state?: unknown }).state;
    if (state === "running" || state === "remote") active++;
  }
  return active;
}

async function waitForDaemonExit(timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = await readPidFile();
    if (!pid || !isDaemonRunning(pid)) return;
    await Bun.sleep(150);
  }
}

async function ensureDaemonUsesLatestSetup(tokenUpdated: boolean): Promise<{ ok: boolean; warning?: string }> {
  if (tokenUpdated) {
    try {
      const status = await daemonRequest("/status");
      const activeSessions = countActiveDaemonSessions(status);
      if (activeSessions > 0) {
        const suffix = activeSessions === 1 ? "" : "s";
        return {
          ok: false,
          warning: `Daemon has ${activeSessions} active session${suffix}. Finish/stop them, then run \`touchgrass pair\`.`,
        };
      }
      await daemonRequest("/shutdown", "POST");
      await waitForDaemonExit();
    } catch {
      // Daemon may not be running yet; ensureDaemon below will start it.
    }
  }

  try {
    await ensureDaemon();
    return { ok: true };
  } catch (e) {
    return { ok: false, warning: (e as Error).message || "Failed to start daemon." };
  }
}

async function generatePairingCodeFromDaemon(): Promise<string | null> {
  try {
    const res = await daemonRequest("/generate-code", "POST");
    if (!res.ok || typeof res.code !== "string" || !res.code) return null;
    return res.code;
  } catch {
    return null;
  }
}

function maskToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "(missing)";
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function sortChannels(entries: Array<[string, ChannelConfig]>): Array<[string, ChannelConfig]> {
  return [...entries].sort((a, b) => {
    if (a[0] === "telegram" && b[0] !== "telegram") return -1;
    if (b[0] === "telegram" && a[0] !== "telegram") return 1;
    return a[0].localeCompare(b[0]);
  });
}

async function printChannelList(config: TgConfig): Promise<void> {
  const entries = sortChannels(getTelegramChannelEntries(config));
  if (entries.length === 0) {
    console.log("No Telegram channels configured yet.");
    console.log("Run `touchgrass setup --telegram <token>` to add one.");
    return;
  }

  let changed = false;
  for (const [, channel] of entries) {
    const token = (channel.credentials.botToken as string) || "";
    if (!token) continue;
    const existingIdentity = getStoredBotIdentity(channel);
    if (existingIdentity.username) continue;
    try {
      const fetchedIdentity = await validateTelegramToken(token);
      changed = storeBotIdentity(channel, fetchedIdentity) || changed;
    } catch {
      // Ignore token validation failures in list view; still print what we have.
    }
  }
  if (changed) {
    await saveConfig(config);
  }

  console.log("Configured Telegram channels:\n");
  for (const [name, channel] of entries) {
    const token = (channel.credentials.botToken as string) || "";
    const tokenStatus = token ? `token ${maskToken(token)}` : "token missing";
    const botIdentity = getStoredBotIdentity(channel);
    const botLabel = botIdentity.username
      ? `bot @${botIdentity.username}${botIdentity.firstName ? ` (${botIdentity.firstName})` : ""}`
      : "bot unknown";
    const pairedCount = channel.pairedUsers?.length || 0;
    const linkedCount = channel.linkedGroups?.length || 0;
    console.log(`- ${name}: ${botLabel}, ${tokenStatus}, paired users ${pairedCount}, linked chats ${linkedCount}`);
  }

  console.log("\nInspect one:");
  console.log("  touchgrass setup --channel <name> --show");
  console.log("Configure one:");
  console.log("  touchgrass setup --channel <name>");
}

function printChannelDetails(config: TgConfig, channelName: string): void {
  const channel = config.channels[channelName];
  if (!channel || channel.type !== "telegram") {
    console.log(`Telegram channel '${channelName}' is not configured.`);
    console.log(`Run: touchgrass setup --channel ${channelName}`);
    return;
  }

  const token = (channel.credentials.botToken as string) || "";
  const botIdentity = getStoredBotIdentity(channel);
  const paired = channel.pairedUsers || [];
  const linked = channel.linkedGroups || [];

  console.log(`Telegram channel: ${channelName}\n`);
  console.log(`- bot: ${botIdentity.username ? `@${botIdentity.username}` : "(unknown)"}`);
  if (botIdentity.firstName) {
    console.log(`- bot first name: ${botIdentity.firstName}`);
  }
  console.log(`- token: ${token ? maskToken(token) : "(missing)"}`);
  console.log(`- paired users: ${paired.length}`);
  console.log(`- linked chats: ${linked.length}`);

  if (paired.length > 0) {
    console.log("\nPaired users:");
    for (const user of paired) {
      const username = user.username ? ` @${user.username}` : "";
      console.log(`- ${user.userId}${username} (${user.pairedAt})`);
    }
  }

  if (linked.length > 0) {
    console.log("\nLinked chats:");
    for (const group of linked) {
      console.log(`- ${group.chatId}${group.title ? ` (${group.title})` : ""}`);
    }
  }
}

export async function runInit(): Promise<void> {
  let options: SetupCliOptions;
  try {
    options = parseSetupArgs(process.argv.slice(3));
  } catch (e) {
    console.error((e as Error).message);
    printSetupUsage();
    process.exit(1);
    return;
  }

  if (options.help) {
    printSetupUsage();
    return;
  }

  const config = await loadConfig();
  for (const key of Object.keys(config.channels)) {
    if (config.channels[key]?.type !== "telegram") {
      delete config.channels[key];
    }
  }

  if (options.listChannels) {
    await printChannelList(config);
    return;
  }
  if (options.showChannel) {
    printChannelDetails(config, options.channelName);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("⛳ touchgrass.sh — Setup (Telegram)\n");

    const selectedChannelName = options.channelName;
    const selectedChannel = config.channels[selectedChannelName];
    const hadPairedUsersInTargetChannel = (selectedChannel?.pairedUsers || []).length > 0;

    if (!config.channels[selectedChannelName]) {
      config.channels[selectedChannelName] = {
        type: "telegram",
        credentials: {},
        pairedUsers: [],
        linkedGroups: [],
      };
    }

    if (selectedChannelName !== "telegram") {
      console.log(`Configuring Telegram channel ${selectedChannelName}.\n`);
    }

    const existingToken = getTelegramBotToken(config, selectedChannelName);
    let token = existingToken;
    let tokenUpdated = false;

    if (options.telegramToken) {
      token = options.telegramToken.trim();
      tokenUpdated = token !== existingToken;
      if (existingToken && tokenUpdated) {
        console.log("Using Telegram bot token from --telegram (overwriting existing token).");
      } else {
        console.log("Using Telegram bot token from --telegram.");
      }
    } else if (existingToken) {
      const action = parseTokenAction(
        await rl.question(
          "Telegram bot token already configured. Use existing, overwrite, or abort? [use/overwrite/abort] (default: use) "
        )
      );
      if (action === "abort") {
        console.log("Aborted.");
        return;
      }
      if (action === "overwrite") {
        token = await promptTelegramToken(rl);
        tokenUpdated = true;
      } else {
        console.log("Using existing Telegram bot token from config.");
      }
    } else {
      token = await promptTelegramToken(rl);
      tokenUpdated = true;
    }

    if (!token) {
      console.error("Error: No token provided.");
      process.exit(1);
    }

    console.log("\nValidating token...");
    let botIdentity: { username?: string; firstName?: string } | null = null;
    try {
      const me = await validateTelegramToken(token);
      botIdentity = me;
      if (me.username) {
        console.log(`Bot: @${me.username} (${me.firstName || "unknown"})`);
      } else {
        console.log("Bot token validated.");
      }
    } catch {
      console.error("Error: Invalid bot token. Could not reach Telegram API.");
      process.exit(1);
    }

    if (tokenUpdated || !config.channels[selectedChannelName].credentials.botToken) {
      config.channels[selectedChannelName].credentials.botToken = token;
    }
    if (botIdentity) {
      storeBotIdentity(config.channels[selectedChannelName], botIdentity);
    }

    await saveConfig(config);
    console.log(`\n✅ Config saved to ${paths.config}`);

    const shouldAutoPair = !!options.telegramToken || !hadPairedUsersInTargetChannel;
    let pairingCode: string | null = null;
    let autoPairWarning: string | undefined;
    if (shouldAutoPair) {
      const daemonReady = await ensureDaemonUsesLatestSetup(tokenUpdated);
      if (!daemonReady.ok) {
        autoPairWarning = daemonReady.warning;
      } else {
        pairingCode = await generatePairingCodeFromDaemon();
        if (!pairingCode) {
          autoPairWarning = "Could not auto-generate pairing code. Run `touchgrass pair` manually.";
        }
      }
    }

    if (pairingCode) {
      console.log(`\n⛳ Pairing code: ${pairingCode}`);
      console.log(`\nSend this to your bot in Telegram: /pair ${pairingCode}`);
      console.log("⏳ Code expires in 10 minutes.");
    } else if (autoPairWarning) {
      console.log(`\n⚠️ ${autoPairWarning}`);
    }

    console.log("\nNext steps:");
    if (pairingCode) {
      console.log("  1. Send /pair <code> to your bot in Telegram DM");
      console.log("  2. (Optional) In Telegram groups/topics, send /link");
      console.log("  3. touchgrass claude    (or touchgrass codex, touchgrass pi, touchgrass kimi) Start with chat bridge");
      console.log("  4. touchgrass pair      Generate another pairing code later if needed");
    } else {
      console.log("  1. touchgrass pair      Generate a pairing code");
      console.log("  2. Send /pair <code> to your bot in Telegram DM");
      console.log("  3. (Optional) In Telegram groups/topics, send /link");
      console.log("  4. touchgrass claude    (or touchgrass codex, touchgrass pi, touchgrass kimi) Start with chat bridge");
    }
  } finally {
    rl.close();
  }
}

export const __initTestUtils = {
  parseSetupArgs,
  countActiveDaemonSessions,
};
