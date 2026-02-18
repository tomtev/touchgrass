import { createInterface, type Interface } from "readline/promises";
import { TelegramApi } from "../channels/telegram/api";
import { loadConfig, saveConfig } from "../config/store";
import { getTelegramBotToken } from "../config/schema";
import { paths } from "../config/paths";

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

export async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("⛳ touchgrass.sh — Setup (Telegram)\n");

    const config = await loadConfig();

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

    if (existingToken) {
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

    console.log("\nNext steps:");
    console.log("  1. tg pair      Generate a pairing code");
    console.log("  2. Send /pair <code> to your bot in Telegram");
    console.log("  3. (Optional) In Telegram groups/topics, send /link");
    console.log("  4. tg claude    (or tg codex, tg pi, tg kimi) Start with chat bridge");
  } finally {
    rl.close();
  }
}
