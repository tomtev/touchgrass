import { readFile } from "fs/promises";
import { paths } from "../config/paths";

export async function runLogs(): Promise<void> {
  const lines = process.argv.includes("-n")
    ? parseInt(process.argv[process.argv.indexOf("-n") + 1] || "20", 10)
    : 20;

  const follow = process.argv.includes("-f") || process.argv.includes("--follow");

  try {
    const content = await readFile(paths.logFile, "utf-8");
    const allLines = content.trim().split("\n").filter(Boolean);
    const tail = allLines.slice(-lines);

    for (const line of tail) {
      printLogLine(line);
    }

    if (follow) {
      // Watch for new lines
      const file = Bun.file(paths.logFile);
      let lastSize = file.size;

      console.log("--- Following log (Ctrl+C to stop) ---");

      while (true) {
        await Bun.sleep(500);
        const currentFile = Bun.file(paths.logFile);
        const currentSize = currentFile.size;

        if (currentSize > lastSize) {
          const content = await readFile(paths.logFile, "utf-8");
          const newContent = content.slice(lastSize);
          const newLines = newContent.trim().split("\n").filter(Boolean);
          for (const line of newLines) {
            printLogLine(line);
          }
          lastSize = currentSize;
        }
      }
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("No log file found. Is the daemon running?");
      console.log(`Expected at: ${paths.logFile}`);
    } else {
      throw e;
    }
  }
}

function printLogLine(raw: string): void {
  try {
    const entry = JSON.parse(raw);
    const level = (entry.level || "?").toUpperCase().padEnd(5);
    const ts = entry.ts?.slice(11, 23) || "";
    const msg = entry.msg || "";
    const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
    console.log(`${ts} [${level}] ${msg}${data}`);
  } catch {
    console.log(raw);
  }
}
