import { join } from "path";
import { paths } from "../config/paths";
import { logger } from "./logger";

const appPortFile = join(paths.dir, "app.port");

interface AppEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Push an event to the desktop app's hook server (fire-and-forget).
 * Reads ~/.touchgrass/app.port to discover the app. If the app isn't
 * running or the port file doesn't exist, silently does nothing.
 */
export function notifyApp(event: AppEvent): void {
  // Async but we don't await — fire and forget
  doNotify(event).catch(() => {});
}

async function doNotify(event: AppEvent): Promise<void> {
  let portStr: string;
  try {
    portStr = await Bun.file(appPortFile).text();
  } catch {
    return; // App not running
  }

  const port = parseInt(portStr.trim(), 10);
  if (!port || port < 1 || port > 65535) return;

  const body = JSON.stringify(event);
  try {
    await fetch(`http://127.0.0.1:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
      body,
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // App not reachable — ignore
  }
}
