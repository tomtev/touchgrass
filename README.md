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
touchgrass setup --telegram <bot-token>
```

Pair from Telegram by DMing your bot: `/pair <code>` (the code is printed by `touchgrass setup`).

> **Note:** `tg` works as a shorthand alias for `touchgrass` everywhere.

### 2. Start a CLI session

```bash
touchgrass claude
touchgrass codex
touchgrass pi
touchgrass kimi
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
touchgrass claude --dangerously-skip-permissions
touchgrass claude --permission-mode default
touchgrass claude --permission-mode acceptEdits
touchgrass claude --add-dir ../shared-lib
touchgrass claude --allowed-tools "Read,Edit,Bash(git:*)"
touchgrass claude --disallowed-tools "Bash(rm:*)"
```

Codex (sandbox + approval policy):

```bash
touchgrass codex --dangerously-bypass-approvals-and-sandbox
touchgrass codex --sandbox workspace-write --ask-for-approval on-request
touchgrass codex --sandbox workspace-write --ask-for-approval untrusted
```

## How it works

Two processes cooperate:

1. CLI process (`touchgrass claude` / `touchgrass codex` / `touchgrass pi` / `touchgrass kimi`):
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
  Use: `touchgrass setup --list-channels`, `touchgrass setup --channel <name> --show`, `touchgrass setup --channel <name>`.
- **Runtime chat channel**: a concrete DM/group/topic the daemon can route to right now.
  Use: `touchgrass channels`.
- **Session**: a running bridged CLI process (`touchgrass claude`, `touchgrass codex`, `touchgrass pi`, `touchgrass kimi`) with an `r-...` id.
  Use: `touchgrass ls`, `touchgrass stop <id>`, `touchgrass kill <id>`, `touchgrass send <id> ...`.

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
touchgrass claude [args]
touchgrass codex [args]
touchgrass pi [args]
touchgrass kimi [args]
```

- `touchgrass claude [args]`: run Claude Code with touchgrass bridge.
- `touchgrass codex [args]`: run Codex with touchgrass bridge.
- `touchgrass pi [args]`: run PI with touchgrass bridge.
- `touchgrass kimi [args]`: run Kimi with touchgrass bridge.

### Setup and health

```bash
touchgrass setup
touchgrass init
touchgrass pair
touchgrass doctor
touchgrass config
touchgrass logs
```

- `touchgrass setup`: interactive setup for channel credentials (Telegram token, etc.).
- `touchgrass setup --telegram <token>`: non-interactive setup; validates token, saves config, and prints a pairing code.
- `touchgrass setup --telegram <token> --channel <name>`: add/update a named Telegram bot config entry.
- `touchgrass setup --list-channels`: show configured Telegram channel entries.
- `touchgrass setup --channel <name> --show`: show details for one Telegram channel entry.
- `touchgrass init`: alias for `touchgrass setup`.
- `touchgrass pair`: generate a one-time code to pair your Telegram account in bot DM.
- `touchgrass doctor`: diagnostics for CLI/channel/daemon state.
- `touchgrass config`: print current config paths and resolved settings.
- `touchgrass logs`: show daemon logs.

### Session operations

```bash
touchgrass ls
touchgrass channels
touchgrass links
touchgrass peek <id> [count]
touchgrass stop <id>
touchgrass kill <id>
```

- `touchgrass ls`: list active bridge sessions.
- `touchgrass channels`: list runtime chat channels (DM/groups/topics) available via the daemon.
- `touchgrass links`: list chat link mappings.
- `touchgrass peek <id> [count]`: show latest output chunks for a session.
- `touchgrass stop <id>`: request graceful stop for a session.
- `touchgrass kill <id>`: force-kill a stuck session.

### Sending input and files

```bash
touchgrass send <id> "continue"
touchgrass send --file <id> ./notes.md
```

- `touchgrass send <id> "text"`: inject text input into a running session.
- `touchgrass send --file <id> <path>`: send a local file to the linked channel for that session.

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
