import { listRecentSessions, type ResumeTool } from "../bot/handlers/resume";
import type { ResumeSessionCandidate } from "../session/manager";
import { terminalPicker } from "./run";

const TOOLS: ResumeTool[] = ["claude", "codex", "pi", "kimi"];
const MAX_PICKER_OPTIONS = 20;

interface ToolSession extends ResumeSessionCandidate {
  tool: ResumeTool;
}

function scanAllTools(cwd: string): ToolSession[] {
  const all: ToolSession[] = [];
  for (const tool of TOOLS) {
    for (const s of listRecentSessions(tool, cwd)) {
      all.push({ ...s, tool });
    }
  }
  return all.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function launchTool(tool: ResumeTool, sessionRef: string, channelFlag: string | null): void {
  const argv = ["bun", "tg", tool];
  if (channelFlag) argv.push("--channel", channelFlag);

  if (tool === "claude") {
    argv.push("--resume", sessionRef);
  } else if (tool === "codex") {
    argv.push("resume", sessionRef);
  } else if (tool === "kimi") {
    argv.push("--session", sessionRef);
  } else {
    argv.push("--session", sessionRef);
  }

  process.argv = argv;
}

export async function runResume(): Promise<void> {
  const args = process.argv.slice(3);
  const isLast = args.includes("--last");

  let channelFlag: string | null = null;
  const channelIdx = args.indexOf("--channel");
  if (channelIdx !== -1) {
    if (channelIdx + 1 >= args.length) {
      console.error("--channel requires a value");
      process.exit(1);
    }
    channelFlag = args[channelIdx + 1];
  }

  const cwd = process.cwd();
  const sessions = scanAllTools(cwd);

  if (sessions.length === 0) {
    console.error("No recent sessions found for this directory.");
    process.exit(1);
  }

  let selected: ToolSession;

  if (isLast) {
    selected = sessions[0];
  } else {
    const visible = sessions.slice(0, MAX_PICKER_OPTIONS);
    const labels = visible.map((s) => `[${s.tool}] ${s.label}`);
    const idx = await terminalPicker("Resume session", labels, "↑/↓ navigate · Enter select · Esc cancel");
    if (idx < 0) {
      process.exit(0);
    }
    selected = visible[idx];
  }

  console.log(`Resuming ${selected.tool} session...`);
  launchTool(selected.tool, selected.sessionRef, channelFlag);

  const { runRun } = await import("./run");
  await runRun();
}
