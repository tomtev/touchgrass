import { loadConfig, saveConfig } from "../config/store";
import { getTelegramBotToken } from "../config/schema";
import { paths } from "../config/paths";

export async function runConfig(): Promise<void> {
  const args = process.argv.slice(3);

  if (args.length === 0 || args[0] === "show") {
    const config = await loadConfig();
    console.log(`Config file: ${paths.config}\n`);
    // Redact bot tokens in channel credentials
    const display = JSON.parse(JSON.stringify(config));
    for (const ch of Object.values(display.channels) as Array<Record<string, unknown>>) {
      const creds = ch.credentials as Record<string, unknown>;
      if (typeof creds.botToken === "string" && creds.botToken) {
        const token = creds.botToken as string;
        creds.botToken = token.slice(0, 6) + "..." + token.slice(-4);
      }
    }
    console.log(JSON.stringify(display, null, 2));
    return;
  }

  if (args[0] === "set") {
    const key = args[1];
    const value = args[2];
    if (!key || value === undefined) {
      console.error("Usage: tg config set <key> <value>");
      console.error("Keys: outputBatchMinMs, outputBatchMaxMs, outputBufferMaxChars, maxSessions, defaultShell");
      process.exit(1);
    }

    const config = await loadConfig();
    const settingsKey = key as keyof typeof config.settings;
    if (!(settingsKey in config.settings)) {
      console.error(`Unknown setting: ${key}`);
      process.exit(1);
    }

    // Parse value based on existing type
    const existing = config.settings[settingsKey];
    if (typeof existing === "number") {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        console.error(`Value must be a number for ${key}`);
        process.exit(1);
      }
      (config.settings as unknown as Record<string, unknown>)[settingsKey] = num;
    } else {
      (config.settings as unknown as Record<string, unknown>)[settingsKey] = value;
    }

    await saveConfig(config);
    console.log(`Set ${key} = ${value}`);
    return;
  }

  if (args[0] === "path") {
    console.log(paths.config);
    return;
  }

  console.error("Usage: tg config [show|set <key> <value>|path]");
  process.exit(1);
}
