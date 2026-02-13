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
    case "channels": {
      const { runChannels } = await import("./cli/channels");
      await runChannels();
      break;
    }
    case "agents": {
      const { runAgents } = await import("./cli/agents");
      await runAgents();
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
      console.error("Supported commands: tg claude, tg codex, tg pi, tg agents");
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
  --channel <value>      Skip channel picker (use "dm", a chatId, or title substring)
  --headless             Run in long-lived JSON headless mode (no local TTY UI)

  ls       List active sessions
  channels List available channels (DM, groups, topics) with busy status
  agents   Manage local agents (install Beekeeper, create custom agents, or install from git/local source)
  send     Send text to session stdin or send file to its channel(s) (tg send <id> "msg" | tg send --file <id> <path>)
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
