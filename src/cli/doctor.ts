import { paths } from "../config/paths";
import { loadConfig } from "../config/store";
import { getTelegramBotToken, getAllPairedUsers } from "../config/schema";
import { readPidFile, isDaemonRunning } from "../daemon/lifecycle";
import { daemonRequest } from "./client";
import { TelegramApi } from "../channels/telegram/api";

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export async function runDoctor(): Promise<void> {
  console.log("tg doctor - System health check\n");
  const checks: Check[] = [];

  // 1. Config file
  try {
    const config = await loadConfig();
    const botToken = getTelegramBotToken(config);
    if (botToken) {
      checks.push({ name: "Config", status: "ok", detail: paths.config });
    } else {
      checks.push({
        name: "Config",
        status: "warn",
        detail: "No bot token. Run `tg init`",
      });
    }

    // 2. Bot token validity
    if (botToken) {
      try {
        const api = new TelegramApi(botToken);
        const me = await api.getMe();
        checks.push({
          name: "Bot API",
          status: "ok",
          detail: `@${me.username}`,
        });
      } catch {
        checks.push({
          name: "Bot API",
          status: "fail",
          detail: "Could not reach Telegram API",
        });
      }
    }

    // 3. Paired users
    const pairedUsers = getAllPairedUsers(config);
    checks.push({
      name: "Paired users",
      status: pairedUsers.length > 0 ? "ok" : "warn",
      detail: `${pairedUsers.length} user(s)`,
    });
  } catch {
    checks.push({ name: "Config", status: "fail", detail: "Could not read config" });
  }

  // 4. Daemon status
  const pid = await readPidFile();
  if (pid && isDaemonRunning(pid)) {
    checks.push({ name: "Daemon", status: "ok", detail: `PID ${pid}` });

    // 5. Control socket
    try {
      const status = await daemonRequest("/health");
      checks.push({
        name: "Control socket",
        status: "ok",
        detail: "Responding",
      });
    } catch {
      checks.push({
        name: "Control socket",
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
      check.status === "ok" ? "+" : check.status === "warn" ? "!" : "x";
    console.log(`  [${icon}] ${check.name}: ${check.detail}`);
  }

  const failures = checks.filter((c) => c.status === "fail");
  if (failures.length > 0) {
    console.log(`\n${failures.length} issue(s) found.`);
    process.exit(1);
  } else {
    console.log("\nAll checks passed.");
  }
}
