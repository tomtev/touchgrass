import { paths, useTcpControlServer } from "../config/paths";
import { loadConfig } from "../config/store";
import { getAllPairedUsers } from "../config/schema";
import { readPidFile, isDaemonRunning } from "../daemon/lifecycle";
import { daemonRequest } from "./client";
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
        detail: "No channels configured. Run `tg init`",
      });
    }

    // 2. Channel credentials validity
    for (const [name, channel] of Object.entries(config.channels)) {
      if (channel.type === "telegram") {
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
        continue;
      }

      if (channel.type === "slack") {
        const botToken = channel.credentials.botToken as string | undefined;
        const appToken = channel.credentials.appToken as string | undefined;
        if (!botToken || !appToken) {
          checks.push({
            name: `Channel ${name}`,
            status: "warn",
            detail: "Slack bot/app token missing",
          });
          continue;
        }
        try {
          const api = new SlackApi(botToken, appToken);
          const me = await api.authTest();
          await api.openSocketConnection();
          checks.push({
            name: `Channel ${name}`,
            status: "ok",
            detail: `Slack ${me.user || "bot"} (${me.team || "workspace"})`,
          });
        } catch {
          checks.push({
            name: `Channel ${name}`,
            status: "fail",
            detail: "Could not reach Slack API / Socket Mode",
          });
        }
        continue;
      }

      if (channel.type === "whatsapp") {
        const authDirRaw = channel.credentials.authDir as string | undefined;
        const authDir = (authDirRaw || defaultWhatsAppAuthDir()).trim() || defaultWhatsAppAuthDir();
        const linked = await hasWhatsAppCredentials(authDir);
        if (!linked) {
          checks.push({
            name: `Channel ${name}`,
            status: "warn",
            detail: "WhatsApp not linked. Run `tg init` and scan QR",
          });
          continue;
        }

        try {
          const sock = await createWhatsAppSocket({ authDir, printQr: false, verbose: false });
          try {
            const result = await waitForWhatsAppConnection(sock, 30_000);
            if (!result.connected) {
              checks.push({
                name: `Channel ${name}`,
                status: "warn",
                detail: `WhatsApp linked but not connected (${result.error || "connection closed"})`,
              });
            } else {
              const selfId = getSocketSelfId(sock) || "connected";
              checks.push({
                name: `Channel ${name}`,
                status: "ok",
                detail: `WhatsApp ${selfId}`,
              });
            }
          } finally {
            await closeWhatsAppSocket(sock);
          }
        } catch {
          checks.push({
            name: `Channel ${name}`,
            status: "fail",
            detail: "Could not connect to WhatsApp Web session",
          });
        }
        continue;
      }

      checks.push({
        name: `Channel ${name}`,
        status: "warn",
        detail: `Unknown channel type: ${channel.type}`,
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
