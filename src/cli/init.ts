import { createInterface, type Interface } from "readline/promises";
import { TelegramApi } from "../channels/telegram/api";
import { loadConfig, saveConfig } from "../config/store";
import { getAllPairedUsers, getTelegramBotToken } from "../config/schema";
import { paths } from "../config/paths";
import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { isDaemonRunning, readPidFile } from "../daemon/lifecycle";

interface SetupCliOptions {
  telegramToken?: string;
  help: boolean;
}

function printSetupUsage(): void {
  console.log(`Usage: tg setup [options]

Options:
  --telegram <token>    Configure Telegram bot token non-interactively
  -h, --help            Show this help message`);
}

function parseSetupArgs(argv: string[]): SetupCliOptions {
  const opts: SetupCliOptions = { help: false };

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
    throw new Error(`Unknown option for tg setup: ${arg}`);
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
          warning: `Daemon has ${activeSessions} active session${suffix}. Finish/stop them, then run \`tg pair\`.`,
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

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("⛳ touchgrass.sh — Setup (Telegram)\n");

    const config = await loadConfig();
    const hadPairedUsers = getAllPairedUsers(config).length > 0;

    // Telegram-only runtime: drop unsupported channel configs.
    for (const key of Object.keys(config.channels)) {
      if (key !== "telegram") {
        delete config.channels[key];
      }
    }

    if (!config.channels.telegram) {
      config.channels.telegram = {
        type: "telegram",
        credentials: {},
        pairedUsers: [],
        linkedGroups: [],
      };
    }

    const existingToken = getTelegramBotToken(config);
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
    try {
      const me = await validateTelegramToken(token);
      if (me.username) {
        console.log(`Bot: @${me.username} (${me.firstName || "unknown"})`);
      } else {
        console.log("Bot token validated.");
      }
    } catch {
      console.error("Error: Invalid bot token. Could not reach Telegram API.");
      process.exit(1);
    }

    if (tokenUpdated || !config.channels.telegram.credentials.botToken) {
      config.channels.telegram.credentials.botToken = token;
    }

    await saveConfig(config);
    console.log(`\n✅ Config saved to ${paths.config}`);

    const shouldAutoPair = !!options.telegramToken || !hadPairedUsers;
    let pairingCode: string | null = null;
    let autoPairWarning: string | undefined;
    if (shouldAutoPair) {
      const daemonReady = await ensureDaemonUsesLatestSetup(tokenUpdated);
      if (!daemonReady.ok) {
        autoPairWarning = daemonReady.warning;
      } else {
        pairingCode = await generatePairingCodeFromDaemon();
        if (!pairingCode) {
          autoPairWarning = "Could not auto-generate pairing code. Run `tg pair` manually.";
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
      console.log("  3. tg claude    (or tg codex, tg pi, tg kimi) Start with chat bridge");
      console.log("  4. tg pair      Generate another pairing code later if needed");
    } else {
      console.log("  1. tg pair      Generate a pairing code");
      console.log("  2. Send /pair <code> to your bot in Telegram DM");
      console.log("  3. (Optional) In Telegram groups/topics, send /link");
      console.log("  4. tg claude    (or tg codex, tg pi, tg kimi) Start with chat bridge");
    }
  } finally {
    rl.close();
  }
}

export const __initTestUtils = {
  parseSetupArgs,
  countActiveDaemonSessions,
};
