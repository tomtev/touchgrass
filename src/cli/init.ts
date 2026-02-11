import { createInterface } from "readline/promises";
import { TelegramApi } from "../channels/telegram/api";
import { loadConfig, saveConfig } from "../config/store";
import { getTelegramBotToken } from "../config/schema";
import { paths } from "../config/paths";

export async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("⛳ touchgrass.sh — Setup\n");

  const config = await loadConfig();
  const existingToken = getTelegramBotToken(config);

  if (existingToken) {
    const answer = await rl.question(
      "A bot token is already configured. Overwrite? [y/N] "
    );
    if (answer.toLowerCase() !== "y") {
      rl.close();
      console.log("Aborted.");
      return;
    }
  }

  console.log("1. Open Telegram and talk to @BotFather");
  console.log("2. Send /newbot and follow the prompts");
  console.log("3. Copy the bot token\n");

  const token = (await rl.question("Paste your bot token: ")).trim();
  rl.close();

  if (!token) {
    console.error("Error: No token provided.");
    process.exit(1);
  }

  // Validate token
  console.log("\nValidating token...");
  const api = new TelegramApi(token);
  try {
    const me = await api.getMe();
    console.log(`Bot: @${me.username} (${me.first_name})`);
  } catch {
    console.error("Error: Invalid bot token. Could not reach Telegram API.");
    process.exit(1);
  }

  // Ensure telegram channel config exists
  if (!config.channels.telegram) {
    config.channels.telegram = {
      type: "telegram",
      credentials: {},
      pairedUsers: [],
      linkedGroups: [],
    };
  }
  config.channels.telegram.credentials.botToken = token;
  await saveConfig(config);
  console.log(`\n✅ Config saved to ${paths.config}`);

  console.log("\nNext steps:");
  console.log("  1. tg pair      Generate a pairing code");
  console.log("  2. Send /pair <code> to your bot in Telegram");
  console.log("  3. tg claude    Start Claude with chat bridge");
}
