# ⛳ touchgrass.sh

Remote control Claude Code, Codex and more with Telegram.

touchgrass is terminal-first:
- you run the real CLI locally (`claude`, `codex`, `pi`)
- touchgrass bridges input/output to chat

## Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tomtev/touchgrass/main/install.ps1 | iex
```

## Quick start

```bash
tg setup
tg pair
tg claude
```

Current channels:
- Telegram

## Setup

1. Configure channel credentials:

```bash
tg setup
# (or: tg init)
```

2. Generate a pairing code:

```bash
tg pair
```

3. Pair from your chat:
- Telegram: `/pair <code>`

4. Optional group/channel/thread linking:
- Use `/link` or `tg link` inside the group/thread you want as a destination

5. Start a bridged terminal session:

```bash
tg claude
tg codex
tg pi
```

## Channel setup guide

### Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Copy bot token
3. Run `tg setup` and choose Telegram
4. Run `tg pair`, then send `/pair <code>` in bot DM

Group note:
- Disable BotFather group privacy (`/setprivacy` -> Disable) so non-command messages are visible.

## Commands

### Session start

```bash
tg claude [args]
tg codex [args]
tg pi [args]
```

Use `--channel` to skip picker:

```bash
tg claude --channel dm
tg claude --channel "Dev Team"
tg claude --channel telegram:-987:12
tg claude --channel none
```

### Session management

```bash
tg ls
tg channels
tg links
tg peek <id> [count]
tg stop <id>
tg kill <id>
```

### Send input / files

```bash
tg send <id> "continue"
tg send --file <id> ./notes.md
```

From Telegram chat:
- `/files` (or `tg files <query>`) opens inline picker buttons in the same chat, lets you select multiple `@path` entries, and queues them for your next message
- `@?<query>` is shorthand for the same picker (example: `@?readme`)
- `@?<query> - <prompt>` resolves the top fuzzy match and sends `@path - prompt` directly (example: `@?readme - summarize this file`)
- `/resume` (or `tg resume`) opens a picker of recent local sessions for this tool and restarts into the selected session

### Setup & diagnostics

```bash
tg setup
tg init   # alias
tg pair
tg doctor
tg config
tg logs
```

## How it works

Two processes cooperate:

1. CLI process (`tg claude` / `tg codex` / `tg pi`):
- starts PTY
- watches tool JSONL output
- sends output to selected chat destination

2. Daemon:
- auto-starts on demand
- receives channel messages
- routes input into the right session
- auto-stops after 30s idle

## FAQ

**Does touchgrass change how Claude/Codex/PI run?**
No. You still run the normal local terminal CLI.

**Can I type locally and from chat at the same time?**
Yes, but avoid simultaneous input bursts to prevent interleaving.

**Does touchgrass include a non-interactive autonomous runtime?**
No. This project is focused on remote terminal control only.

## Requirements

- Bun runtime
- Telegram account
- Local Claude/Codex/PI CLI installed

## License

MIT
