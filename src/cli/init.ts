import { createInterface, type Interface } from "readline/promises";
import { TelegramApi } from "../channels/telegram/api";
import { SlackApi } from "../channels/slack/api";
import {
  closeWhatsAppSocket,
  createWhatsAppSocket,
  defaultWhatsAppAuthDir,
  hasWhatsAppCredentials,
  waitForWhatsAppConnection,
  getSocketSelfId,
} from "../channels/whatsapp/auth";
import { loadConfig, saveConfig } from "../config/store";
import { getTelegramBotToken } from "../config/schema";
import { paths } from "../config/paths";
import { rm } from "fs/promises";

type ChannelName = "telegram" | "slack" | "whatsapp";

function parseChannelChoice(answer: string): ChannelName | null {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "" || normalized === "telegram" || normalized === "tg" || normalized === "1") {
    return "telegram";
  }
  if (normalized === "slack" || normalized === "2") {
    return "slack";
  }
  if (normalized === "whatsapp" || normalized === "wa" || normalized === "3") {
    return "whatsapp";
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

async function promptTelegramToken(rl: Interface): Promise<string> {
  console.log("1. Open Telegram and talk to @BotFather");
  console.log("2. Send /newbot and follow the prompts");
  console.log("3. Copy the bot token\n");
  return (await rl.question("Paste your bot token: ")).trim();
}

async function promptSlackTokens(rl: Interface): Promise<{ botToken: string; appToken: string }> {
  console.log("1. Create a Slack app with Socket Mode enabled");
  console.log("2. Install it to your workspace");
  console.log("3. Copy the bot token (xoxb-...) and app token (xapp-...)\n");
  const botToken = (await rl.question("Paste Slack bot token (xoxb-...): ")).trim();
  const appToken = (await rl.question("Paste Slack app token (xapp-...): ")).trim();
  return { botToken, appToken };
}

async function validateTelegramToken(token: string): Promise<{ username?: string; firstName?: string }> {
  const api = new TelegramApi(token);
  const me = await api.getMe();
  return { username: me.username, firstName: me.first_name };
}

async function validateSlackTokens(botToken: string, appToken: string): Promise<{ user?: string; team?: string }> {
  const api = new SlackApi(botToken, appToken);
  const me = await api.authTest();
  await api.openSocketConnection();
  return { user: me.user, team: me.team };
}

async function tryWhatsAppConnection(
  authDir: string,
  printQr: boolean,
  timeoutMs: number
): Promise<{ connected: boolean; selfId?: string; error?: string; status?: number }> {
  const sock = await createWhatsAppSocket({
    authDir,
    printQr,
    verbose: false,
  });
  try {
    const result = await waitForWhatsAppConnection(sock, timeoutMs);
    const selfId = getSocketSelfId(sock) || undefined;
    return { connected: result.connected, selfId, error: result.error, status: result.status };
  } finally {
    await closeWhatsAppSocket(sock);
  }
}

export async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("⛳ touchgrass.sh — Setup\n");

    const config = await loadConfig();
    console.log("Channels:");
    console.log("  1) telegram");
    console.log("  2) slack");
    console.log("  3) whatsapp\n");

    const channelChoice = parseChannelChoice(
      await rl.question("Select channel [telegram]: ")
    );
    if (!channelChoice) {
      console.error("Unsupported channel. Choose 'telegram', 'slack', or 'whatsapp'.");
      return;
    }

    // Current runtime supports one active channel config at a time.
    for (const key of Object.keys(config.channels)) {
      if (key !== channelChoice) {
        delete config.channels[key];
      }
    }

    if (!config.channels[channelChoice]) {
      config.channels[channelChoice] = {
        type: channelChoice,
        credentials: {},
        pairedUsers: [],
        linkedGroups: [],
      };
    }

    if (channelChoice === "telegram") {
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
    } else {
      if (channelChoice === "slack") {
        const existingBotToken = config.channels.slack.credentials.botToken as string | undefined;
        const existingAppToken = config.channels.slack.credentials.appToken as string | undefined;

        let botToken = existingBotToken || "";
        let appToken = existingAppToken || "";
        let tokenUpdated = false;

        if (existingBotToken && existingAppToken) {
          const action = parseTokenAction(
            await rl.question(
              "Slack tokens already configured. Use existing, overwrite, or abort? [use/overwrite/abort] (default: use) "
            )
          );
          if (action === "abort") {
            console.log("Aborted.");
            return;
          }
          if (action === "overwrite") {
            const tokens = await promptSlackTokens(rl);
            botToken = tokens.botToken;
            appToken = tokens.appToken;
            tokenUpdated = true;
          } else {
            console.log("Using existing Slack credentials from config.");
          }
        } else {
          const tokens = await promptSlackTokens(rl);
          botToken = tokens.botToken;
          appToken = tokens.appToken;
          tokenUpdated = true;
        }

        if (!botToken || !appToken) {
          console.error("Error: Slack bot/app token is required.");
          process.exit(1);
        }

        console.log("\nValidating Slack credentials...");
        try {
          const me = await validateSlackTokens(botToken, appToken);
          console.log(`Slack app validated: ${me.user || "bot"} in ${me.team || "workspace"}`);
        } catch {
          console.error("Error: Invalid Slack credentials. Could not reach Slack API.");
          process.exit(1);
        }

        if (tokenUpdated || !existingBotToken || !existingAppToken) {
          config.channels.slack.credentials.botToken = botToken;
          config.channels.slack.credentials.appToken = appToken;
        }
      } else {
        const defaultDir = defaultWhatsAppAuthDir();
        const existingAuthDirRaw = config.channels.whatsapp.credentials.authDir as string | undefined;
        const authDir = (existingAuthDirRaw || defaultDir).trim() || defaultDir;
        config.channels.whatsapp.credentials.authDir = authDir;

        const alreadyLinked = await hasWhatsAppCredentials(authDir);
        let action: "use" | "overwrite" | "abort" = "overwrite";
        if (alreadyLinked) {
          action = parseTokenAction(
            await rl.question(
              "WhatsApp session is already linked. Use existing, overwrite, or abort? [use/overwrite/abort] (default: use) "
            )
          );
        }
        if (action === "abort") {
          console.log("Aborted.");
          return;
        }

        if (action === "overwrite") {
          await rm(authDir, { recursive: true, force: true }).catch(() => {});
        }

        if (action === "use") {
          console.log("\nValidating linked WhatsApp session...");
          try {
            const check = await tryWhatsAppConnection(authDir, false, 45_000);
            if (check.connected) {
              console.log(`WhatsApp session validated${check.selfId ? ` (${check.selfId})` : ""}.`);
            } else {
              console.log(`Existing session could not be validated (${check.error || "not connected"}).`);
              const relinkAnswer = (
                await rl.question("Relink WhatsApp now? [Y/n] ")
              )
                .trim()
                .toLowerCase();
              if (relinkAnswer === "n" || relinkAnswer === "no") {
                console.log("Keeping existing session metadata. You can relink anytime with `tg init`.");
              } else {
                await rm(authDir, { recursive: true, force: true }).catch(() => {});
                console.log("\nLink WhatsApp by scanning the QR code:");
                const linked = await tryWhatsAppConnection(authDir, true, 180_000);
                if (!linked.connected) {
                  console.error(`Error: WhatsApp link failed (${linked.error || "connection closed"}).`);
                  process.exit(1);
                }
                console.log(`Linked successfully${linked.selfId ? ` as ${linked.selfId}` : ""}.`);
              }
            }
          } catch (e) {
            console.error(`Error: Failed to validate WhatsApp session: ${(e as Error).message}`);
            process.exit(1);
          }
        } else {
          console.log("\nLink WhatsApp by scanning the QR code:");
          try {
            const linked = await tryWhatsAppConnection(authDir, true, 180_000);
            if (!linked.connected) {
              console.error(`Error: WhatsApp link failed (${linked.error || "connection closed"}).`);
              process.exit(1);
            }
            console.log(`Linked successfully${linked.selfId ? ` as ${linked.selfId}` : ""}.`);
          } catch (e) {
            console.error(`Error: Failed to link WhatsApp: ${(e as Error).message}`);
            process.exit(1);
          }
        }
      }
    }

    await saveConfig(config);
    console.log(`\n✅ Config saved to ${paths.config}`);

    console.log("\nNext steps:");
    console.log("  1. tg pair      Generate a pairing code");
    if (channelChoice === "telegram") {
      console.log("  2. Send /pair <code> to your bot in Telegram");
    } else if (channelChoice === "slack") {
      console.log("  2. In Slack DM with your bot, send: tg pair <code>");
      console.log("  3. Invite the bot to channels with /invite @YourBot");
      console.log("  4. Link a channel or thread from Slack: tg link");
    } else {
      console.log("  2. In WhatsApp, send: tg pair <code>");
      console.log("  3. In a WhatsApp group, send: tg link");
    }
    console.log(`  ${channelChoice === "telegram" ? "3" : channelChoice === "slack" ? "5" : "4"}. tg claude    Start Claude with chat bridge`);
  } finally {
    rl.close();
  }
}
