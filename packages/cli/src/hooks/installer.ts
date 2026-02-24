import { join } from "path";
import { homedir } from "os";
import { paths } from "../config/paths";

const HOOK_SCRIPT_NAME = "claude-hooks.sh";
const HOOK_SCRIPT_PATH = join(paths.hooksDir, HOOK_SCRIPT_NAME);
const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
// Superset wrapper overrides settings via --settings flag; check for its config too
const SUPERSET_SETTINGS_PATH = join(homedir(), ".superset", "hooks", "claude-settings.json");

const HOOK_EVENTS = ["UserPromptSubmit", "Stop", "PermissionRequest"] as const;

function buildHookEntry(event: string): { matcher?: string; hooks: { type: string; command: string; async: boolean; timeout: number }[] } {
  const entry: { matcher?: string; hooks: { type: string; command: string; async: boolean; timeout: number }[] } = {
    hooks: [{ type: "command", command: HOOK_SCRIPT_PATH, async: true, timeout: 5 }],
  };
  if (event === "PermissionRequest") {
    entry.matcher = "*";
  }
  return entry;
}

export async function installClaudeHooks(): Promise<{ scriptInstalled: boolean; settingsUpdated: boolean }> {
  const { readFile, writeFile, copyFile, chmod, mkdir } = await import("fs/promises");

  // Ensure hooks dir exists
  await mkdir(paths.hooksDir, { recursive: true, mode: 0o700 }).catch(() => {});

  // Copy hook script from source to ~/.touchgrass/hooks/
  let scriptInstalled = false;
  try {
    const bundledScript = join(import.meta.dir, HOOK_SCRIPT_NAME);
    await copyFile(bundledScript, HOOK_SCRIPT_PATH);
    await chmod(HOOK_SCRIPT_PATH, 0o755);
    scriptInstalled = true;
  } catch {
    // Script copy failed — not fatal
  }

  // Update ~/.claude/settings.json with hook entries
  let settingsUpdated = false;
  try {
    let settings: Record<string, unknown> = {};
    try {
      const raw = await readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      settings = JSON.parse(raw);
    } catch {
      // No existing settings — start fresh
    }

    const hooks = (settings.hooks || {}) as Record<string, unknown[]>;
    let needsWrite = false;

    for (const event of HOOK_EVENTS) {
      const existing = hooks[event] as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
      const alreadyInstalled = existing?.some(
        (entry) => entry.hooks?.some((h) => h.command === HOOK_SCRIPT_PATH)
      );
      if (!alreadyInstalled) {
        if (!hooks[event]) hooks[event] = [];
        (hooks[event] as unknown[]).push(buildHookEntry(event));
        needsWrite = true;
      }
    }

    if (needsWrite) {
      settings.hooks = hooks;
      // Ensure ~/.claude/ directory exists
      await mkdir(join(homedir(), ".claude"), { recursive: true }).catch(() => {});
      await writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
      settingsUpdated = true;
    }
  } catch {
    // Settings update failed — not fatal
  }

  // Also update Superset's override settings if present (it uses --settings flag which overrides ~/.claude/settings.json)
  try {
    const raw = await readFile(SUPERSET_SETTINGS_PATH, "utf-8");
    const supersetSettings = JSON.parse(raw) as Record<string, unknown>;
    const supersetHooks = (supersetSettings.hooks || {}) as Record<string, unknown[]>;
    let needsSupersetWrite = false;
    for (const event of HOOK_EVENTS) {
      const existing = supersetHooks[event] as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
      const alreadyInstalled = existing?.some(
        (entry) => entry.hooks?.some((h) => h.command === HOOK_SCRIPT_PATH)
      );
      if (!alreadyInstalled) {
        // Superset uses a flat hooks array per event — add our hook to each entry's hooks array
        if (Array.isArray(supersetHooks[event])) {
          for (const entry of supersetHooks[event] as Array<{ hooks?: unknown[] }>) {
            if (Array.isArray(entry.hooks)) {
              entry.hooks.push({ type: "command", command: HOOK_SCRIPT_PATH, async: true, timeout: 5 });
              needsSupersetWrite = true;
            }
          }
        }
      }
    }
    if (needsSupersetWrite) {
      supersetSettings.hooks = supersetHooks;
      await writeFile(SUPERSET_SETTINGS_PATH, JSON.stringify(supersetSettings) + "\n", "utf-8");
      settingsUpdated = true;
    }
  } catch {
    // Superset not installed or settings not found — skip
  }

  return { scriptInstalled, settingsUpdated };
}
