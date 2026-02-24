import { randomBytes } from "crypto";
import { readFile, writeFile, chmod } from "fs/promises";
import { ensureDirs, paths } from "../config/paths";

const TOKEN_BYTES = 32;

export async function rotateDaemonAuthToken(): Promise<string> {
  await ensureDirs();
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  await writeFile(paths.authToken, `${token}\n`, { encoding: "utf-8", mode: 0o600 });
  await chmod(paths.authToken, 0o600).catch(() => {});
  return token;
}

export async function readDaemonAuthToken(): Promise<string | null> {
  try {
    const token = (await readFile(paths.authToken, "utf-8")).trim();
    return token || null;
  } catch {
    return null;
  }
}
