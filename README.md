# ⛳ touchgrass.sh

⛳️ Use Telegram as a remote controller for Claude Code, Codex, Kimi and Pi and more. Manage your code CLIs on the go.

- Runs on top of normal code CLIs commands (claude, codex, pi, kimi).
- Prefix it with `tg` (for example `tg claude`) to wrap that session with Touchgrass and bridge it to chat.

## Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tomtev/touchgrass/main/install.ps1 | iex
```

## Setup

1. Create a Telegram bot and copy its token:
- Open [@BotFather](https://t.me/BotFather)
- Run `/newbot` and complete bot creation
- Copy the bot token

2. In your terminal:

```bash
tg setup
```

3. Generate a pairing code:

```bash
tg pair
```

4. Pair from your chat (DM bot):
- Telegram: `/pair <code>`

5. Optional group/channel/thread linking:
- Use `/link` inside the group/thread you want want to use for bridging.

6. Start a bridged terminal session:

```bash
tg claude
tg claude --dangerously-skip-permissions
tg codex
tg codex --dangerously-bypass-approvals-and-sandbox
tg pi
tg kimi
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
tg kimi [args]
tg camp [--root /path]
```

### Touchgrass Camp (🏕️)

`tg camp` runs a long-lived control plane for Telegram groups/topics.

- Start it once from your projects root (or pass `--root /path`).
- In Telegram groups/topics, use `/start claude|codex|pi|kimi [project-name]` to launch a new session.
- Use `/stop` to stop the current chat-bound session.
- Only the paired owner account can start/stop Camp sessions.
- If Camp is not running, `/start` replies with a `tg camp` hint.
- Under the hood Camp spawns normal touchgrass commands with channel binding (for example `tg claude --channel <chatId>`), so session behavior stays consistent.

touchgrass auto-appends a small bridge context when the CLI supports direct prompt/config injection:
- `claude` / `pi`: `--append-system-prompt "<touchgrass bridge context>"`
- `codex`: `-c developer_instructions="<touchgrass bridge context>"`
- `kimi`: currently no equivalent flag, so touchgrass leaves args unchanged.
- The context tells the tool it is running inside a `tg` wrapper and users may communicate through Telegram now and other channels over time
- It includes send-back helpers: `tg send $TG_SESSION_ID "text"` and `tg send --file $TG_SESSION_ID <path>`
- If you already pass your own `--append-system-prompt` (Claude/PI) or `developer_instructions` config (Codex), touchgrass does not add a second one.

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
- `/output_mode simple|verbose` (or `tg output_mode simple|verbose`) sets bridge verbosity for the current chat (`simple` is default: concise tool activity + short main-tool outputs)
- Output mode details:
  - `simple` (default): concise tool-call events (except `Bash`/`bash`/`exec_command`), concise result summaries for `WebFetch`/`WebSearch`/`Task`, and all tool errors
  - `verbose`: full tool-call previews and fuller tool result blocks
- `/thinking on|off|toggle` (or `tg thinking on|off|toggle`) controls whether thinking previews are forwarded for this chat (default: off)
- `/background_jobs` (Telegram command menu) or `/background-jobs` (or `tg background-jobs`) lists currently running background jobs for your connected session(s)

### Setup & diagnostics

```bash
tg setup
tg init   # alias
tg pair
tg camp
tg doctor
tg config
tg logs
```

## How it works

Two processes cooperate:

1. CLI process (`tg claude` / `tg codex` / `tg pi` / `tg kimi`):
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
- Local Claude/Codex/PI/Kimi CLI installed

## License

MIT
