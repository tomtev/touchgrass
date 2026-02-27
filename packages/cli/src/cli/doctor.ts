import { paths, useTcpControlServer } from "../config/paths";
import { loadConfig } from "../config/store";
import { getAllPairedUsers, getTelegramChannelEntries, getSlackChannelEntries } from "../config/schema";
import { readPidFile, isDaemonRunning } from "../daemon/lifecycle";
import { daemonRequest } from "./client";
import { TelegramApi } from "../channels/telegram/api";
import { SlackApi } from "../channels/slack/api";

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export async function runDoctor(): Promise<void> {
  console.log("⛳ touchgrass.sh — Health Check\n");
  const checks: Check[] = [];

  // 1. Config file
  try {
    const config = await loadConfig();
    if (Object.keys(config.channels).length > 0) {
      checks.push({ name: "Config", status: "ok", detail: paths.config });
    } else {
      checks.push({
        name: "Config",
        status: "warn",
        detail: "No channels configured. Run `touchgrass setup`",
      });
    }

    // 2. Channel credentials validity
    const telegramChannels = getTelegramChannelEntries(config);
    const slackChannels = getSlackChannelEntries(config);
    if (telegramChannels.length === 0 && slackChannels.length === 0) {
      checks.push({
        name: "Channels",
        status: "warn",
        detail: "No channels configured. Run `touchgrass setup`",
      });
    }
    for (const [name, channel] of telegramChannels) {
      const botToken = channel.credentials.botToken as string | undefined;
      if (!botToken) {
        checks.push({
          name: `Channel ${name}`,
          status: "warn",
          detail: "Telegram bot token missing",
        });
        continue;
      }
      try {
        const api = new TelegramApi(botToken);
        const me = await api.getMe();
        checks.push({
          name: `Channel ${name}`,
          status: "ok",
          detail: `Telegram @${me.username || me.first_name || "bot"}`,
        });
      } catch {
        checks.push({
          name: `Channel ${name}`,
          status: "fail",
          detail: "Could not reach Telegram API",
        });
      }
    }
    for (const [name, channel] of slackChannels) {
      const botToken = channel.credentials.botToken as string | undefined;
      if (!botToken) {
        checks.push({
          name: `Channel ${name}`,
          status: "warn",
          detail: "Slack bot token missing",
        });
        continue;
      }
      try {
        const api = new SlackApi(botToken);
        const auth = await api.authTest();
        checks.push({
          name: `Channel ${name}`,
          status: "ok",
          detail: `Slack ${auth.user} (${auth.team})`,
        });
      } catch {
        checks.push({
          name: `Channel ${name}`,
          status: "fail",
          detail: "Could not reach Slack API",
        });
      }
    }

    const supportedTypes = new Set(["telegram", "slack"]);
    const unsupported = Object.entries(config.channels)
      .filter(([, ch]) => !supportedTypes.has(ch.type))
      .map(([name, ch]) => `${name}:${ch.type}`);
    if (unsupported.length > 0) {
      checks.push({
        name: "Unsupported channels",
        status: "warn",
        detail: `${unsupported.join(", ")} (unsupported type)`,
      });
    }

    // 3. Paired users
    const pairedUsers = getAllPairedUsers(config);
    checks.push({
      name: "Paired users",
      status: pairedUsers.length >= 1 ? "ok" : "warn",
      detail: `${pairedUsers.length} user(s)`,
    });
  } catch {
    checks.push({ name: "Config", status: "fail", detail: "Could not read config" });
  }

  // 4. Daemon status
  const pid = await readPidFile();
  if (pid && isDaemonRunning(pid)) {
    checks.push({ name: "Daemon", status: "ok", detail: `PID ${pid}` });

    // 5. Control server
    try {
      await daemonRequest("/health");
      checks.push({
        name: "Control server",
        status: "ok",
        detail: useTcpControlServer() ? "Responding (localhost TCP)" : "Responding (Unix socket)",
      });
    } catch {
      checks.push({
        name: "Control server",
        status: "fail",
        detail: "Not responding",
      });
    }
  } else {
    checks.push({
      name: "Daemon",
      status: "ok",
      detail: "Not running (starts on demand)",
    });
  }

  // 6. Bun version
  checks.push({
    name: "Bun",
    status: "ok",
    detail: Bun.version,
  });

  // Print results
  for (const check of checks) {
    const icon =
      check.status === "ok" ? "✅" : check.status === "warn" ? "⚠️" : "❌";
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }

  const failures = checks.filter((c) => c.status === "fail");
  if (failures.length > 0) {
    console.log(`\n${failures.length} issue(s) found.`);
    process.exit(1);
  } else {
    console.log("\n⛳ All checks passed.");
  }
}
