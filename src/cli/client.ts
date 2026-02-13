import { readFile } from "fs/promises";
import { CONTROL_HOST, paths, useTcpControlServer } from "../config/paths";
import { readDaemonAuthToken } from "../security/daemon-auth";

async function readControlPort(): Promise<number | null> {
  try {
    const raw = await readFile(paths.controlPortFile, "utf-8");
    const port = parseInt(raw.trim(), 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) return null;
    return port;
  } catch {
    return null;
  }
}

export async function daemonRequest(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const headers: Record<string, string> = {};
    const authToken = await readDaemonAuthToken();
    if (authToken) {
      headers["x-touchgrass-auth"] = authToken;
    }

    const opts: Record<string, unknown> = { method };
    let baseUrl = "http://localhost";
    if (useTcpControlServer()) {
      const port = await readControlPort();
      if (!port) throw new Error("Daemon is not running.");
      baseUrl = `http://${CONTROL_HOST}:${port}`;
    } else {
      opts.unix = paths.socket;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    if (Object.keys(headers).length > 0) {
      opts.headers = headers;
    }

    const res = await fetch(`${baseUrl}${path}`, opts as RequestInit);
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok || payload.ok === false) {
      const error = typeof payload.error === "string"
        ? payload.error
        : `Daemon request failed (${res.status})`;
      throw new Error(error);
    }
    return payload;
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message?.includes("ENOENT") || err.message?.includes("ECONNREFUSED")) {
      throw new Error("Daemon is not running.");
    }
    throw e;
  }
}
