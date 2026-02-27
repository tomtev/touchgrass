import { createInterface, type Interface } from "readline/promises";
import { TelegramApi } from "../channels/telegram/api";
import { SlackApi } from "../channels/slack/api";
import { loadConfig, saveConfig } from "../config/store";
import { getTelegramBotToken, getTelegramChannelEntries, getSlackChannelEntries, getSlackBotToken, getSlackAppToken, type ChannelConfig, type TgConfig } from "../config/schema";
import { paths } from "../config/paths";
import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { isDaemonRunning, readPidFile } from "../daemon/lifecycle";

interface SetupCliOptions {
  telegramToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  channelName: string;
  listChannels: boolean;
  showChannel: boolean;
  help: boolean;
}

function printSetupUsage(): void {
  console.log(`Usage: touchgrass setup [options]

Options:
  --telegram <token>           Configure Telegram bot token non-interactively
  --slack <bot-token>          Configure Slack bot token (xoxb-...)
  --slack-app-token <token>    Slack app-level token for Socket Mode (xapp-...)
  --channel <name>             Configure a named channel entry (default: telegram or slack)
  --list-channels              List configured channel entries
  --show                       Show details for the selected channel (use with --channel)
  -h, --help                   Show this help message`);
}

function parseSetupArgs(argv: string[]): SetupCliOptions {
  const opts: SetupCliOptions = { help: false, channelName: "", listChannels: false, showChannel: false };

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
    if (arg === "--slack") {
      const token = argv[i + 1];
      if (!token || token.startsWith("--")) {
        throw new Error("--slack requires a bot token value (xoxb-...).");
      }
      opts.slackBotToken = token;
      i++;
      continue;
    }
    if (arg.startsWith("--slack=")) {
      const token = arg.slice("--slack=".length).trim();
      if (!token) {
        throw new Error("--slack requires a bot token value (xoxb-...).");
      }
      opts.slackBotToken = token;
      continue;
    }
    if (arg === "--slack-app-token") {
      const token = argv[i + 1];
      if (!token || token.startsWith("--")) {
        throw new Error("--slack-app-token requires a token value (xapp-...).");
      }
      opts.slackAppToken = token;
      i++;
      continue;
    }
    if (arg.startsWith("--slack-app-token=")) {
      const token = arg.slice("--slack-app-token=".length).trim();
      if (!token) {
        throw new Error("--slack-app-token requires a token value (xapp-...).");
      }
      opts.slackAppToken = token;
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

  // Default channel name based on which token type was provided
  if (!opts.channelName) {
    opts.channelName = opts.slackBotToken ? "slack" : "telegram";
  }

  const channelName = opts.channelName.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(channelName)) {
    throw new Error("Invalid --channel value. Use letters/numbers/_/- and start with a letter.");
  }
  opts.channelName = channelName;

  if (opts.telegramToken && opts.slackBotToken) {
    throw new Error("Use --telegram or --slack, not both. Configure each channel separately.");
  }
  if (opts.slackAppToken && !opts.slackBotToken) {
    throw new Error("--slack-app-token requires --slack <bot-token>.");
  }
  if (opts.listChannels && (opts.telegramToken || opts.slackBotToken)) {
    throw new Error("--list-channels cannot be used with --telegram or --slack.");
  }
  if (opts.showChannel && (opts.telegramToken || opts.slackBotToken)) {
    throw new Error("--show cannot be used with --telegram or --slack.");
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
  const telegramEntries = sortChannels(getTelegramChannelEntries(config));
  const slackEntries = sortChannels(getSlackChannelEntries(config));
  const allEntries = [...telegramEntries, ...slackEntries];

  if (allEntries.length === 0) {
    console.log("No channels configured yet.");
    console.log("Run `touchgrass setup --telegram <token>` or `touchgrass setup --slack <token> --slack-app-token <token>` to add one.");
    return;
  }

  let changed = false;
  for (const [, channel] of telegramEntries) {
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

  console.log("Configured channels:\n");
  for (const [name, channel] of allEntries) {
    const token = (channel.credentials.botToken as string) || "";
    const tokenStatus = token ? `token ${maskToken(token)}` : "token missing";
    const pairedCount = channel.pairedUsers?.length || 0;
    const linkedCount = channel.linkedGroups?.length || 0;

    if (channel.type === "telegram") {
      const botIdentity = getStoredBotIdentity(channel);
      const botLabel = botIdentity.username
        ? `bot @${botIdentity.username}${botIdentity.firstName ? ` (${botIdentity.firstName})` : ""}`
        : "bot unknown";
      console.log(`- ${name} [telegram]: ${botLabel}, ${tokenStatus}, paired users ${pairedCount}, linked chats ${linkedCount}`);
    } else if (channel.type === "slack") {
      const botName = (channel.credentials as Record<string, unknown>).botName as string || "unknown";
      const teamName = (channel.credentials as Record<string, unknown>).teamName as string || "";
      const label = teamName ? `${botName} (${teamName})` : botName;
      console.log(`- ${name} [slack]: ${label}, ${tokenStatus}, paired users ${pairedCount}, linked chats ${linkedCount}`);
    }
  }

  console.log("\nInspect one:");
  console.log("  touchgrass setup --channel <name> --show");
  console.log("Configure one:");
  console.log("  touchgrass setup --channel <name>");
}

function printChannelDetails(config: TgConfig, channelName: string): void {
  const channel = config.channels[channelName];
  if (!channel) {
    console.log(`Channel '${channelName}' is not configured.`);
    console.log(`Run: touchgrass setup --channel ${channelName}`);
    return;
  }

  const token = (channel.credentials.botToken as string) || "";
  const paired = channel.pairedUsers || [];
  const linked = channel.linkedGroups || [];

  if (channel.type === "slack") {
    const creds = channel.credentials as Record<string, unknown>;
    const appToken = (creds.appToken as string) || "";
    console.log(`Slack channel: ${channelName}\n`);
    console.log(`- bot: ${creds.botName || "(unknown)"}`);
    console.log(`- team: ${creds.teamName || "(unknown)"} (${creds.teamId || "?"})`);
    console.log(`- bot user ID: ${creds.botUserId || "(unknown)"}`);
    console.log(`- bot token: ${token ? maskToken(token) : "(missing)"}`);
    console.log(`- app token: ${appToken ? maskToken(appToken) : "(missing)"}`);
  } else {
    const botIdentity = getStoredBotIdentity(channel);
    console.log(`Telegram channel: ${channelName}\n`);
    console.log(`- bot: ${botIdentity.username ? `@${botIdentity.username}` : "(unknown)"}`);
    if (botIdentity.firstName) {
      console.log(`- bot first name: ${botIdentity.firstName}`);
    }
    console.log(`- token: ${token ? maskToken(token) : "(missing)"}`);
  }

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

  if (options.listChannels) {
    await printChannelList(config);
    return;
  }
  if (options.showChannel) {
    printChannelDetails(config, options.channelName);
    return;
  }

  // Route to Slack setup if --slack was provided
  if (options.slackBotToken) {
    await runSlackSetup(config, options);
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

async function runSlackSetup(config: TgConfig, options: SetupCliOptions): Promise<void> {
  console.log("⛳ touchgrass.sh — Setup (Slack)\n");

  const selectedChannelName = options.channelName;
  const botToken = options.slackBotToken!.trim();
  const appToken = (options.slackAppToken || "").trim();

  if (!appToken) {
    console.error("Error: --slack-app-token is required for Slack Socket Mode.");
    console.error("Create an app-level token with connections:write scope at https://api.slack.com/apps");
    process.exit(1);
  }

  if (!botToken.startsWith("xoxb-")) {
    console.error("Error: Slack bot token should start with xoxb-");
    process.exit(1);
  }

  if (!appToken.startsWith("xapp-")) {
    console.error("Error: Slack app token should start with xapp-");
    process.exit(1);
  }

  console.log("Validating Slack bot token...");
  let authResult: { userId: string; botName: string; teamId: string; teamName: string };
  try {
    const api = new SlackApi(botToken);
    const auth = await api.authTest();
    authResult = {
      userId: auth.user_id,
      botName: auth.user,
      teamId: auth.team_id,
      teamName: auth.team,
    };
    console.log(`Bot: ${auth.user} in workspace ${auth.team} (${auth.team_id})`);
  } catch (e) {
    console.error(`Error: Invalid Slack bot token. ${(e as Error).message}`);
    process.exit(1);
  }

  // Validate app token by attempting a Socket Mode connection
  console.log("Validating Slack app token (Socket Mode)...");
  try {
    const api = new SlackApi(botToken);
    const conn = await api.openConnection(appToken);
    if (conn.url) {
      console.log("Socket Mode connection OK.");
    }
  } catch (e) {
    console.error(`Error: Invalid Slack app token. ${(e as Error).message}`);
    console.error("Ensure the app-level token has connections:write scope and Socket Mode is enabled.");
    process.exit(1);
  }

  const existingChannel = config.channels[selectedChannelName];
  const hadPairedUsers = (existingChannel?.pairedUsers || []).length > 0;
  const existingToken = existingChannel?.type === "slack"
    ? ((existingChannel.credentials as Record<string, unknown>).botToken as string || "")
    : "";
  const tokenUpdated = botToken !== existingToken;

  config.channels[selectedChannelName] = {
    type: "slack",
    credentials: {
      botToken,
      appToken,
      botUserId: authResult.userId,
      botName: authResult.botName,
      teamId: authResult.teamId,
      teamName: authResult.teamName,
    },
    pairedUsers: existingChannel?.type === "slack" ? (existingChannel.pairedUsers || []) : [],
    linkedGroups: existingChannel?.type === "slack" ? (existingChannel.linkedGroups || []) : [],
  };

  await saveConfig(config);
  console.log(`\n✅ Config saved to ${paths.config}`);

  const shouldAutoPair = !hadPairedUsers || tokenUpdated;
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
    console.log(`\nSend this to your bot in Slack DM: /pair ${pairingCode}`);
    console.log("⏳ Code expires in 10 minutes.");
  } else if (autoPairWarning) {
    console.log(`\n⚠️ ${autoPairWarning}`);
  }

  console.log("\nSlack App Requirements:");
  console.log("  Socket Mode: enabled");
  console.log("  Bot scopes: chat:write, im:history, channels:history, groups:history,");
  console.log("              files:write, files:read, users:read, commands");
  console.log("  App token scope: connections:write");

  console.log("\nNext steps:");
  if (pairingCode) {
    console.log("  1. DM your bot in Slack: /pair " + pairingCode);
    console.log("  2. (Optional) Invite bot to channels and send /link");
    console.log("  3. touchgrass claude    Start with chat bridge");
  } else {
    console.log("  1. touchgrass pair      Generate a pairing code");
    console.log("  2. DM your bot in Slack: /pair <code>");
    console.log("  3. (Optional) Invite bot to channels and send /link");
    console.log("  4. touchgrass claude    Start with chat bridge");
  }
}

export const __initTestUtils = {
  parseSetupArgs,
  countActiveDaemonSessions,
};
