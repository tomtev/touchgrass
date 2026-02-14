# ⛳ touchgrass.sh

## What This Project Does

touchgrass is a terminal bridge for controlling local AI CLI sessions from chat.

Supported channels:
- Telegram
- Slack
- WhatsApp

## Runtime

- Runtime: Bun
- Language: TypeScript (strict)
- Transport: daemon + PTY + channel adapters

## Core Commands

```bash
tg setup      # configure channel credentials (tg init is alias)
tg pair       # generate pairing code

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
- `src/channels/slack/*` - Slack implementation
- `src/channels/whatsapp/*` - WhatsApp implementation

## Operational Notes

- One configured channel per type is supported.
- Session IDs are tagged and partial matching is supported in several CLI commands.
- Use `tg stop` first and `tg kill` only if needed.
- Keep routing changes covered by tests in `src/__tests__/`.
