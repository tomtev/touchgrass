#!/usr/bin/env bun

const command = process.argv[2] || "help";

async function main() {
  switch (command) {
    case "init": {
      const { runInit } = await import("./cli/init");
      await runInit();
      break;
    }
    case "logs": {
      const { runLogs } = await import("./cli/logs");
      await runLogs();
      break;
    }
    case "doctor": {
      const { runDoctor } = await import("./cli/doctor");
      await runDoctor();
      break;
    }
    case "config": {
      const { runConfig } = await import("./cli/config");
      await runConfig();
      break;
    }
    case "pair": {
      const { runPair } = await import("./cli/pair");
      await runPair();
      break;
    }
    case "ls": {
      const { runLs } = await import("./cli/ls");
      await runLs();
      break;
    }
    case "links": {
      const { runLinks } = await import("./cli/links");
      await runLinks();
      break;
    }
    case "send": {
      const { runSend } = await import("./cli/send");
      await runSend();
      break;
    }
    case "peek": {
      const { runPeek } = await import("./cli/peek");
      await runPeek();
      break;
    }
    case "claude":
    case "codex":
    case "pi": {
      const { runRun } = await import("./cli/run");
      await runRun();
      break;
    }
    case "__daemon__": {
      const { startDaemon } = await import("./daemon/index");
      await startDaemon();
      break;
    }
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default: {
      console.error(`Unknown command: ${command}`);
      console.error("Supported commands: tg claude, tg codex, tg pi");
      console.error(`Run "tg help" for more information.`);
      process.exit(1);
    }
  }
}

function printHelp() {
  console.log(`⛳ touchgrass.sh — manage your AI agents from your phone
   https://touchgrass.sh

Usage: tg <command>

Commands:
  claude   Run Claude Code with chat bridge
  codex    Run Codex with chat bridge
  pi       Run PI with chat bridge

Options (for claude/codex/pi):
  (Heartbeat runs automatically when HEARTBEAT.md exists)
  (Set heartbeat interval in HEARTBEAT.md: <heartbeat interval="15">...</heartbeat>)
  --tg-send-files        Allow assistant output paths to be auto-sent as Telegram files

  ls       List active sessions
  send     Send a message to a session (tg send <id> "msg")
  peek     Peek at last messages from session(s) (tg peek <id>|--all [count])
  links    List and manage linked groups/topics
  init     Set up bot token
  pair     Generate a pairing code
  logs     Tail the daemon log
  doctor   Check system health
  config   View or edit configuration
  help     Show this help message

The daemon starts automatically when you run a command
and stops 30s after all sessions disconnect.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
