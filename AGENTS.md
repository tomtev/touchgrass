# ⛳ touchgrass.sh

## What This Project Does

touchgrass is a terminal bridge for controlling local AI CLI sessions from chat.
Its core product goal is to be the best possible remote controller for Claude Code, Codex, PI, Kimi, and similar terminal-first AI tools.
Users can build personal agents on top of touchgrass by defining behavior in `AGENTS.md` (without needing a separate agent runtime flag).

Supported channels:
- Telegram

## Runtime

- Runtime: Bun
- Language: TypeScript (strict)
- Transport: daemon + PTY + channel adapters

## Core Commands

```bash
bun run src/main.ts setup      # configure channel credentials (init alias exists)
bun run src/main.ts pair       # generate pairing code
bun run src/main.ts camp [--root /path]

bun run src/main.ts claude
bun run src/main.ts codex
bun run src/main.ts pi
bun run src/main.ts kimi

bun run src/main.ts send <session_id> "text"
bun run src/main.ts send --file <session_id> <path>

bun run src/main.ts ls
bun run src/main.ts channels
bun run src/main.ts links
bun run src/main.ts peek <id>
bun run src/main.ts stop <id>
bun run src/main.ts kill <id>
```

Telegram chat shorthands:
- `/files` or `tg files <query>` opens the file picker (`.gitignore` aware when in a git repo)
- `@?<query>` is shorthand for the same picker
- `@?<query> - <prompt>` auto-resolves top fuzzy match and sends `@path - prompt`
- `/resume` or `tg resume` opens a picker of recent local sessions and restarts the same tool on the selected session

## Touchgrass Camp

- Command: `bun run src/main.ts camp [--root /path]`
- Purpose: long-lived Telegram control plane for launching project sessions from chat.
- Chat controls:
  - `/start claude|codex|pi|kimi [project-name]` starts a session in the camp root.
  - `/kill` kills the current chat-bound session process.
- Ownership:
  - only the paired owner account can create new camp sessions.
  - if camp is not active, `/start` returns a `tg camp` hint.
- Runtime behavior:
  - Camp launches normal `tg claude/codex/pi/kimi --channel <chatId>` commands under the hood.
  - spawned sessions behave like normal touchgrass sessions (same routing/output rules).

## Architecture

1. CLI process (`tg claude/codex/pi/kimi`):
- spawns PTY
- watches JSONL outputs
- bridges tool output to chat
- polls daemon for remote input

2. Daemon process:
- starts on demand
- receives messages from configured channel adapters
- routes messages to the correct session
- stops automatically after idle timeout

## Important Files

- `src/main.ts` - command entrypoint and help
- `src/cli/run.ts` - PTY/session bridge runtime
- `src/daemon/index.ts` - daemon wiring and routing
- `src/bot/command-router.ts` - inbound message routing
- `src/bot/handlers/stdin-input.ts` - session input auto-routing
- `src/channel/types.ts` - channel interface contracts
- `src/channel/factory.ts` - channel instance creation
- `src/channels/telegram/*` - Telegram implementation

## Operational Notes

- Telegram is the only supported channel.
- This repo workflow is local-dev only.
- Restart the daemon before testing runtime changes:
```bash
old_pid=$(cat ~/.touchgrass/daemon.pid 2>/dev/null || true)
[ -n "$old_pid" ] && kill "$old_pid" 2>/dev/null || true
bun run src/main.ts channels
```
- In dev mode (`bun run src/main.ts ...`), restart the daemon after code changes so Telegram reflects updates:
```bash
old_pid=$(cat ~/.touchgrass/daemon.pid 2>/dev/null || true)
[ -n "$old_pid" ] && kill "$old_pid" 2>/dev/null || true
bun run src/main.ts channels
```
- Session IDs are tagged and partial matching is supported in several CLI commands.
- Use `tg stop` first and `tg kill` only if needed.
- Keep routing changes covered by tests in `src/__tests__/`.
