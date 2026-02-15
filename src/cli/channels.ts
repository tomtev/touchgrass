import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";

interface ChannelInfo {
  chatId: string;
  title: string;
  type: "dm" | "group" | "topic";
  busy: boolean;
  busyLabel: string | null;
}

export async function runChannels(): Promise<void> {
  try {
    await ensureDaemon();
  } catch {
    console.error("Daemon is not running. Start a session first (e.g. `tg claude`).");
    process.exit(1);
  }

  let channels: ChannelInfo[];
  try {
    const res = await daemonRequest("/channels");
    channels = (res.channels as ChannelInfo[]) || [];
  } catch (e) {
    console.error(`Failed to fetch channels: ${(e as Error).message}`);
    process.exit(1);
  }

  if (channels.length === 0) {
    console.log("No channels available. Run `tg setup` and `tg pair` first.");
    process.exit(0);
  }

  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";
  const YELLOW = "\x1b[33m";

  console.log("\n  Channels:\n");

  // Group topics under their parent group for indented display
  const typeLabels: Record<string, string> = { dm: "DM", group: "Group", topic: "Topic" };

  for (const ch of channels) {
    const indent = ch.type === "topic" ? "    " : "  ";
    const typeTag = `${DIM}(${typeLabels[ch.type] || ch.type})${RESET}`;
    const chatIdCol = `${DIM}${ch.chatId}${RESET}`;
    const busyTag = ch.busy && ch.busyLabel
      ? `  ${YELLOW}<- ${ch.busyLabel}${RESET}`
      : "";

    // Pad title and type tag for alignment
    const titlePart = `${indent}${ch.title}`;
    const padded = titlePart.padEnd(30);
    console.log(`${padded} ${typeTag.padEnd(20)}  ${chatIdCol}${busyTag}`);
  }

  console.log(`\n  ${DIM}Use --channel <title|chatId|dm> to skip the picker.${RESET}\n`);
  process.exit(0);
}
