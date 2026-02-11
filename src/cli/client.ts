import { paths } from "../config/paths";

export async function daemonRequest(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const opts: Record<string, unknown> = {
      method,
      unix: paths.socket,
    };
    if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://localhost${path}`, opts as RequestInit);
    return (await res.json()) as Record<string, unknown>;
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message?.includes("ENOENT") || err.message?.includes("ECONNREFUSED")) {
      throw new Error("Daemon is not running.");
    }
    throw e;
  }
}
