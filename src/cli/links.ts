import { loadConfig, saveConfig } from "../config/store";
import { getAllLinkedGroups, removeLinkedGroup } from "../config/schema";

export async function runLinks(): Promise<void> {
  const config = await loadConfig();
  const groups = getAllLinkedGroups(config);

  if (groups.length === 0) {
    console.log("No linked groups or topics.");
    process.exit(0);
  }

  console.log("\nLinked groups and topics:\n");
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const isTopic = g.chatId.split(":").length >= 3;
    const type = isTopic ? "Topic" : "Group";
    console.log(`  ${i + 1}. ${g.title || g.chatId}  (${type})  [${g.chatId}]`);
  }

  console.log("\nEnter number to remove, or press Enter to cancel: ");
  const input = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data: Buffer) => resolve(data.toString().trim()));
  });

  if (!input) {
    process.exit(0);
  }

  const idx = parseInt(input) - 1;
  if (isNaN(idx) || idx < 0 || idx >= groups.length) {
    console.error("Invalid selection.");
    process.exit(1);
  }

  const target = groups[idx];
  if (removeLinkedGroup(config, target.chatId)) {
    await saveConfig(config);
    console.log(`Removed: ${target.title || target.chatId}`);
  } else {
    console.error("Failed to remove.");
  }
  process.exit(0);
}
