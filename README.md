# ⛳ touchgrass.sh

Use Telegram as a remote controller for Claude Code, Codex, Kimi, Pi and more.

- **Zero config** — wraps your existing CLI tools, no new runtime to learn
- **Works from your phone** — send prompts, approve tools, attach files from Telegram
- **Multi-tool** — supports Claude Code, Codex, Pi, Kimi out of the box
- **Lightweight** — just a PTY bridge + daemon, auto-starts and auto-stops

## Table of Contents

- [Install](#install)
- [Setup](#setup)
- [How it works](#how-it-works)
- [CLI reference](#touchgrass-cli-reference)
- [FAQ](#faq)
- [Requirements](#requirements)

## Install

macOS / Linux:

```bash
curl -fsSL https://touchgrass.sh/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://touchgrass.sh/install.ps1 | iex
```

## Setup

### 1. Setup channel

Create a Telegram bot via [@BotFather](https://t.me/BotFather) (`/newbot`), then:

```bash
tg setup --telegram <bot-token>
```

Pair from Telegram by DMing your bot: `/pair <code>` (the code is printed by `tg setup`).

### 2. Start a CLI session

```bash
tg claude
tg codex
tg pi
tg kimi
```

You'll see a banner confirming the session is touchgrass-wrapped:

```
⛳ touchgrass · /start_remote_control to connect from Telegram
```

### 3. Remote control

From any Telegram chat where your bot is present (DM or group), run `/start_remote_control` to pick a session and connect.

For groups: add your bot and disable BotFather group privacy (`/setprivacy` -> Disable) so it can see messages.

### CLI flags

Claude (permission modes + tool/path controls):

```bash
tg claude --dangerously-skip-permissions
tg claude --permission-mode default
tg claude --permission-mode acceptEdits
tg claude --add-dir ../shared-lib
tg claude --allowed-tools "Read,Edit,Bash(git:*)"
tg claude --disallowed-tools "Bash(rm:*)"
```

Codex (sandbox + approval policy):

```bash
tg codex --dangerously-bypass-approvals-and-sandbox
tg codex --sandbox workspace-write --ask-for-approval on-request
tg codex --sandbox workspace-write --ask-for-approval untrusted
```

## How it works

Two processes cooperate:

1. CLI process (`tg claude` / `tg codex` / `tg pi` / `tg kimi`):
- starts PTY
- watches tool JSONL output (the session files for the CLIs)
- sends output to selected chat destination

2. Daemon:
- auto-starts on demand
- receives channel messages
- routes input into the right session
- auto-stops after 30s idle

### Channels vs sessions

- **Configured channel entry (bot config)**: a Telegram bot definition in `config.json` (token, paired users, linked chats).  
  Use: `tg setup --list-channels`, `tg setup --channel <name> --show`, `tg setup --channel <name>`.
- **Runtime chat channel**: a concrete DM/group/topic the daemon can route to right now.  
  Use: `tg channels`.
- **Session**: a running bridged CLI process (`tg claude`, `tg codex`, `tg pi`, `tg kimi`) with an `r-...` id.  
  Use: `tg ls`, `tg stop <id>`, `tg kill <id>`, `tg send <id> ...`.

### Telegram commands

- `/start_remote_control` — pick a running session to connect to this chat.
- `/stop_remote_control` — disconnect the current session from this chat.
- `/files` (or `@?<query>`) — inline file picker; select `@path` entries for your next message.
- `@?<query> - <prompt>` — resolve top fuzzy match and send `@path - prompt` directly.
- `/change_session` — switch to a different running session.
- `/output_mode simple|verbose` — set bridge verbosity for this chat.
- `/thinking on|off|toggle` — toggle thinking previews for this chat.
- `/background_jobs` — list running background jobs for connected sessions.

## Touchgrass CLI reference

### Bridge sessions

```bash
tg claude [args]
tg codex [args]
tg pi [args]
tg kimi [args]
```

- `tg claude [args]`: run Claude Code with touchgrass bridge.
- `tg codex [args]`: run Codex with touchgrass bridge.
- `tg pi [args]`: run PI with touchgrass bridge.
- `tg kimi [args]`: run Kimi with touchgrass bridge.

### Setup and health

```bash
tg setup
tg init
tg pair
tg doctor
tg config
tg logs
```

- `tg setup`: interactive setup for channel credentials (Telegram token, etc.).
- `tg setup --telegram <token>`: non-interactive setup; validates token, saves config, and prints a pairing code.
- `tg setup --telegram <token> --channel <name>`: add/update a named Telegram bot config entry.
- `tg setup --list-channels`: show configured Telegram channel entries.
- `tg setup --channel <name> --show`: show details for one Telegram channel entry.
- `tg init`: alias for `tg setup`.
- `tg pair`: generate a one-time code to pair your Telegram account in bot DM.
- `tg doctor`: diagnostics for CLI/channel/daemon state.
- `tg config`: print current config paths and resolved settings.
- `tg logs`: show daemon logs.

### Session operations

```bash
tg ls
tg channels
tg links
tg peek <id> [count]
tg stop <id>
tg kill <id>
```

- `tg ls`: list active bridge sessions.
- `tg channels`: list runtime chat channels (DM/groups/topics) available via the daemon.
- `tg links`: list chat link mappings.
- `tg peek <id> [count]`: show latest output chunks for a session.
- `tg stop <id>`: request graceful stop for a session.
- `tg kill <id>`: force-kill a stuck session.

### Sending input and files

```bash
tg send <id> "continue"
tg send --file <id> ./notes.md
```

- `tg send <id> "text"`: inject text input into a running session.
- `tg send --file <id> <path>`: send a local file to the linked channel for that session.

## FAQ

**Does touchgrass change how Claude/Codex/PI/Kimi run?**
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
