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
    case "sessions":
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
    case "office": {
      const subcommand = process.argv[3];
      if (subcommand === "walk" || subcommand === "map" || subcommand === "gesture" || subcommand === "create" || subcommand === "list") {
        const { runOfficeCommand } = await import("./cli/office");
        await runOfficeCommand(subcommand, process.argv.slice(4));
      } else {
        // Parse --office flag for the visual view
        let officeName = "default";
        const restArgs = process.argv.slice(3);
        for (let i = 0; i < restArgs.length; i++) {
          if (restArgs[i] === "--office" && restArgs[i + 1]) {
            officeName = restArgs[i + 1]!;
            break;
          }
        }
        const { runOffice } = await import("./cli/office");
        await runOffice(officeName);
      }
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
      console.error("Supported commands: touchgrass setup, touchgrass claude, touchgrass codex, touchgrass pi, touchgrass kimi, touchgrass write, touchgrass send, touchgrass stop, touchgrass kill, touchgrass restart");
      console.error(`Run "touchgrass help" for more information.`);
      process.exit(1);
    }
  }
}

function printHelp() {
  console.log(`⛳ touchgrass.sh — remote control your terminal tools from your phone
   https://touchgrass.sh

Usage: touchgrass <command>  (alias: tg)

Commands:
  claude   Run Claude Code with chat bridge
  codex    Run Codex with chat bridge
  pi       Run PI with chat bridge
  kimi     Run Kimi CLI with chat bridge
  resume   Resume a recent session (picker or --last for most recent)

Options (for claude/codex/pi/kimi/resume):
  --channel <value>      Skip channel picker (use "dm", a chatId, or title substring)
  --name <value>         Give the session a human-readable name
  --last                 Skip session picker, resume most recent (resume only)

  sessions List active sessions (alias: ls)
  channels List available channels (DM, groups, topics) with busy status
  write    Write text into a session's terminal (touchgrass write <id> "text" | touchgrass write <id> --file <path>)
  send     Send a message or file to a session's channel(s) (touchgrass send <id> "text" | touchgrass send <id> --file <path>)
  peek     Peek at last messages from session(s) (touchgrass peek <id>|--all [count])
  stop     Stop a session (SIGTERM / remote stop request)
  kill     Kill a session (SIGKILL / remote kill request)
  restart  Restart a touchgrass session wrapper on its current tool session (touchgrass restart [session_id])
  links    List and manage linked groups/topics
  office           Visual office view (--office <name> for named offices)
  office create    Create a named office (office create <name> --dir <path>)
  office list      List configured offices
  office walk X,Y  Move your avatar to coordinates (--office <name>)
  office map       Print ASCII map with entity positions (--office <name>)
  office gesture   Trigger gesture (--wave or --talk, --office <name>)
  agent    Create or update agents (touchgrass agent create | touchgrass agent update)
  setup    Set up channel credentials (--telegram <token> | --slack <token> --slack-app-token <token>, --channel, --list-channels, --show)
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
