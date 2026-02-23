#!/usr/bin/env bun

const command = process.argv[2] || "help";

async function main() {
  switch (command) {
    case "setup":
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
    case "send": {
      const { runSend } = await import("./cli/send");
      await runSend();
      break;
    }
    case "write": {
      const { runWrite } = await import("./cli/send");
      await runWrite();
      break;
    }
    case "peek": {
      const { runPeek } = await import("./cli/peek");
      await runPeek();
      break;
    }
    case "stop":
    case "kill": {
      const { runStopOrKill } = await import("./cli/stop");
      await runStopOrKill();
      break;
    }
    case "restart": {
      const { runRestart } = await import("./cli/restart");
      await runRestart();
      break;
    }
    case "resume": {
      const { runResume } = await import("./cli/resume");
      await runResume();
      break;
    }
    case "agent": {
      const { runAgent } = await import("./cli/agent");
      await runAgent();
      break;
    }
    case "claude":
    case "codex":
    case "pi":
    case "kimi": {
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
      console.error("Supported commands: tg setup, tg claude, tg codex, tg pi, tg kimi, tg write, tg send, tg stop, tg kill, tg restart");
      console.error(`Run "tg help" for more information.`);
      process.exit(1);
    }
  }
}

function printHelp() {
  console.log(`⛳ touchgrass.sh — remote control your terminal tools from your phone
   https://touchgrass.sh

Usage: tg <command>

Commands:
  claude   Run Claude Code with chat bridge
  codex    Run Codex with chat bridge
  pi       Run PI with chat bridge
  kimi     Run Kimi CLI with chat bridge
  resume   Resume a recent session (picker or --last for most recent)

Options (for claude/codex/pi/kimi/resume):
  --channel <value>      Skip channel picker (use "dm", a chatId, or title substring)
  --last                 Skip session picker, resume most recent (resume only)

  ls       List active sessions
  channels List available channels (DM, groups, topics) with busy status
  write    Write text into a session's terminal (tg write <id> "text" | tg write <id> --file <path>)
  send     Send a message or file to a session's channel(s) (tg send <id> "text" | tg send <id> --file <path>)
  peek     Peek at last messages from session(s) (tg peek <id>|--all [count])
  stop     Stop a session (SIGTERM / remote stop request)
  kill     Kill a session (SIGKILL / remote kill request)
  restart  Restart a tg session wrapper on its current tool session (tg restart [tg_session_id])
  links    List and manage linked groups/topics
  agent    Create or update agents (tg agent create | tg agent update)
  setup    Set up Telegram credentials (supports --telegram <token>, --channel <name>, --list-channels, --show)
  init     Alias for setup
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
