import { mkdir, stat } from "fs/promises";
import { join } from "path";
import { paths } from "../../config/paths";
import { jidToPhone } from "./normalize";

let baileysPromise: Promise<Record<string, unknown>> | null = null;

async function loadBaileys(): Promise<Record<string, unknown>> {
  if (!baileysPromise) {
    baileysPromise = import("@whiskeysockets/baileys") as unknown as Promise<Record<string, unknown>>;
  }
  return baileysPromise;
}

export function defaultWhatsAppAuthDir(): string {
  return join(paths.dir, "credentials", "whatsapp", "default");
}

export async function ensureWhatsAppAuthDir(authDir: string): Promise<void> {
  await mkdir(authDir, { recursive: true, mode: 0o700 });
}

export async function hasWhatsAppCredentials(authDir: string): Promise<boolean> {
  try {
    const file = join(authDir, "creds.json");
    const st = await stat(file);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

export function getDisconnectStatus(err: unknown): number | undefined {
  const e = err as { output?: { statusCode?: number }; status?: number };
  return e?.output?.statusCode ?? e?.status;
}

export function getSocketSelfId(sock: unknown): string | null {
  const userId = (sock as { user?: { id?: string } })?.user?.id;
  if (!userId || typeof userId !== "string") return null;
  return jidToPhone(userId) || userId;
}

async function printQr(qr: string): Promise<void> {
  try {
    const mod = (await import("qrcode-terminal")) as unknown as {
      default?: { generate?: (value: string, opts?: { small?: boolean }) => void };
      generate?: (value: string, opts?: { small?: boolean }) => void;
    };
    const fn = mod.default?.generate || mod.generate;
    if (fn) {
      fn(qr, { small: true });
      return;
    }
  } catch {
    // Fall through to plain-text fallback.
  }
  console.log(qr);
}

export async function createWhatsAppSocket(options: {
  authDir: string;
  printQr?: boolean;
  verbose?: boolean;
  onQr?: (qr: string) => void;
}): Promise<unknown> {
  const baileys = await loadBaileys();
  const makeWASocket = (baileys.default as (opts: Record<string, unknown>) => unknown) || null;
  const useMultiFileAuthState =
    (baileys.useMultiFileAuthState as (dir: string) => Promise<{ state: Record<string, unknown>; saveCreds: () => Promise<void> }>) ||
    null;
  const fetchLatestBaileysVersion =
    (baileys.fetchLatestBaileysVersion as () => Promise<{ version: number[] }>) || null;
  const makeCacheableSignalKeyStore =
    (baileys.makeCacheableSignalKeyStore as
      | ((keys: unknown, logger?: unknown) => unknown)
      | undefined) || undefined;

  if (!makeWASocket || !useMultiFileAuthState || !fetchLatestBaileysVersion) {
    throw new Error("Baileys runtime is missing required exports");
  }

  await ensureWhatsAppAuthDir(options.authDir);
  const { state, saveCreds } = await useMultiFileAuthState(options.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const auth = state as { creds?: unknown; keys?: unknown };
  const silentLogger = {
    level: "silent",
    child() {
      return silentLogger;
    },
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
  };
  const sock = makeWASocket({
    auth: {
      creds: auth.creds,
      keys: makeCacheableSignalKeyStore ? makeCacheableSignalKeyStore(auth.keys, undefined) : auth.keys,
    },
    version,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ["touchgrass.sh", "tg", "latest"],
    logger: options.verbose ? undefined : (silentLogger as unknown),
  });

  const ev = (sock as { ev?: { on?: (event: string, handler: (...args: unknown[]) => void) => void } }).ev;
  ev?.on?.("creds.update", () => {
    void Promise.resolve(saveCreds()).catch(() => {});
  });
  ev?.on?.("connection.update", (update: unknown) => {
    const qr = (update as { qr?: string })?.qr;
    if (!qr) return;
    options.onQr?.(qr);
    if (options.printQr) {
      console.log("Scan this QR in WhatsApp (Linked devices):");
      void printQr(qr);
    }
  });

  return sock;
}

export async function waitForWhatsAppConnection(
  sock: unknown,
  timeoutMs = 120_000
): Promise<{ connected: boolean; status?: number; error?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: { connected: boolean; status?: number; error?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve(value);
    };

    const timeout = setTimeout(() => {
      finish({ connected: false, error: "Timed out waiting for WhatsApp connection" });
    }, Math.max(1000, timeoutMs));

    const ev = (sock as { ev?: { on?: (event: string, handler: (...args: unknown[]) => void) => void } }).ev;
    ev?.on?.("connection.update", (update: unknown) => {
      const u = update as {
        connection?: string;
        lastDisconnect?: { error?: unknown };
      };
      if (u.connection === "open") {
        finish({ connected: true });
        return;
      }
      if (u.connection === "close") {
        finish({
          connected: false,
          status: getDisconnectStatus(u.lastDisconnect?.error),
          error: String(u.lastDisconnect?.error || "connection closed"),
        });
      }
    });
  });
}

export async function closeWhatsAppSocket(sock: unknown): Promise<void> {
  try {
    const ws = (sock as { ws?: { close?: () => void } }).ws;
    ws?.close?.();
  } catch {
    // Best-effort close
  }
}
