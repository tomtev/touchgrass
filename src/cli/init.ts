import { createInterface, type Interface } from "readline/promises";
import { TelegramApi } from "../channels/telegram/api";
import { loadConfig, saveConfig } from "../config/store";
import { getTelegramBotToken } from "../config/schema";
import { paths } from "../config/paths";
import { createDefaultBeekeeperInstallProfile, installBeekeeper } from "./agents";

type ChannelName = "telegram";

function isInstallChoice(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "install" || normalized === "i" || normalized === "y" || normalized === "yes";
}

function parseChannelChoice(answer: string): ChannelName | null {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "" || normalized === "telegram" || normalized === "tg" || normalized === "1") {
    return "telegram";
  }
  return null;
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

async function questionWithDefault(rl: Interface, label: string, fallback: string): Promise<string> {
  const prompt = fallback ? `${label} [${fallback}]: ` : `${label}: `;
  const answer = (await rl.question(prompt)).trim();
  return answer || fallback;
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
    console.log("⛳ touchgrass.sh — Setup\n");

    const config = await loadConfig();
    const existingToken = getTelegramBotToken(config);

    console.log("Channels:");
    console.log("  1) telegram (only option for now)\n");

    const channelChoice = parseChannelChoice(
      await rl.question("Select channel [telegram]: ")
    );
    if (!channelChoice) {
      console.error("Unsupported channel. Only 'telegram' is supported right now.");
      return;
    }

    if (!config.channels.telegram) {
      config.channels.telegram = {
        type: "telegram",
        credentials: {},
        pairedUsers: [],
        linkedGroups: [],
      };
    }

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

    if (config.agents?.beekeeper) {
      console.log(`\nBeekeeper already installed at ${config.agents.beekeeper.directory}`);
    } else {
      console.log("\nOptional: install The Beekeeper 🐝");
      console.log("It scaffolds AGENTS.md, CLAUDE.md, HEARTBEAT.md, workflows/, and core skills.");
      const choice = await rl.question(
        "Install now or later? [later/install] (default: later) "
      );

      if (isInstallChoice(choice)) {
        const defaults = createDefaultBeekeeperInstallProfile(process.cwd());
        const profile = {
          targetDir: await questionWithDefault(rl, "Install directory", defaults.targetDir),
          agentName: await questionWithDefault(rl, "Agent name", defaults.agentName),
          description: await questionWithDefault(rl, "Agent description", defaults.description),
          ownerName: await questionWithDefault(rl, "Owner name", defaults.ownerName),
          location: await questionWithDefault(rl, "Location", defaults.location),
          timezone: await questionWithDefault(rl, "Timezone", defaults.timezone),
        };

        try {
          const installDir = await installBeekeeper(config, profile);
          console.log(`✅ Installed ${profile.agentName} in ${installDir}`);
        } catch (err) {
          console.error(`Beekeeper install failed: ${(err as Error).message}`);
        }
      } else {
        console.log("Beekeeper install set to later.");
      }
    }

    console.log("\nNext steps:");
    console.log("  1. tg pair      Generate a pairing code");
    console.log("  2. Send /pair <code> to your bot in Telegram");
    console.log("  3. tg claude    Start Claude with chat bridge");
  } finally {
    rl.close();
  }
}
