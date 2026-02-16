# ⛳ touchgrass.sh

## What This Project Does

touchgrass is a terminal bridge for controlling local AI CLI sessions from chat.
Its core product goal is to be the best possible remote controller for Claude Code, Codex, PI, and similar terminal-first AI tools.
Users can build personal agents on top of touchgrass by defining behavior in `AGENTS.md` (without needing a separate agent runtime flag).

Supported channels:
- Telegram

## Runtime

- Runtime: Bun
- Language: TypeScript (strict)
- Transport: daemon + PTY + channel adapters

## Core Commands

```bash
tg setup      # configure channel credentials (tg init is alias)
tg pair       # generate pairing code
curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash  # update/install latest CLI

tg claude
tg codex
tg pi

tg send <session_id> "text"
tg send --file <session_id> <path>

tg ls
tg channels
tg links
tg peek <id>
tg stop <id>
tg kill <id>
```

Telegram chat shorthands:
- `/files` or `tg files <query>` opens the file picker (`.gitignore` aware when in a git repo)
- `@?<query>` is shorthand for the same picker
- `@?<query> - <prompt>` auto-resolves top fuzzy match and sends `@path - prompt`
- `/resume` or `tg resume` opens a picker of recent local sessions and restarts the same tool on the selected session

## Architecture

1. CLI process (`tg claude/codex/pi`):
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
- If the user asks to "update", that means running the curl installer command above.
- After every new release/update, always restart the daemon before testing:
```bash
old_pid=$(cat ~/.touchgrass/daemon.pid 2>/dev/null || true)
[ -n "$old_pid" ] && kill "$old_pid" 2>/dev/null || true
tg channels
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
