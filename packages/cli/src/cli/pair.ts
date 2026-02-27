import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";

export async function runPair(): Promise<void> {
  try {
    await ensureDaemon();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  try {
    const res = await daemonRequest("/generate-code", "POST");
    if (!res.ok || !res.code) {
      console.error("Failed to generate pairing code.");
      process.exit(1);
    }
    console.log(`⛳ Pairing code: ${res.code}`);
    console.log(`\nSend this to your bot: /pair ${res.code}`);
    console.log("⏳ Code expires in 10 minutes.");
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
