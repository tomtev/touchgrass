# ⛳ touchgrass.sh

Use Telegram as a remote controller for Claude Code, Codex, Kimi, Pi and more.

- **Zero config** — wraps your existing CLI tools, no new runtime to learn
- **Works from your phone** — send prompts, approve tools, attach files from Telegram
- **Build agents** — scaffold personal agents with workflows, skills, and managed core updates
- **Multi-tool** — supports Claude Code, Codex, Pi, Kimi out of the box
- **Lightweight** — just a PTY bridge + daemon, auto-starts and auto-stops

## Table of Contents

- [Install](#install)
- [Setup](#setup)
- [Agents](#agents)
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

1. Create a Telegram bot and copy its token:
- Open [@BotFather](https://t.me/BotFather)
- Run `/newbot` and complete bot creation
- Copy the bot token

2. In your terminal:

```bash
tg setup
# or non-interactive:
tg setup --telegram <bot-token>
# configure an additional named Telegram bot entry:
tg setup --telegram <bot-token> --channel <name>
# inspect configured bot entries:
tg setup --list-channels
tg setup --channel <name> --show
```

3. Pair from your chat (DM bot):
- Telegram: `/pair <code>`
- `tg setup --telegram <bot-token>` prints a pairing code immediately.
- Fresh `tg setup` also prints a pairing code when no owner is paired yet.
- If no code is shown, run:

```bash
tg pair
```

4. Optional group/channel/thread linking:
- Use `/link` inside the group/thread you want to use for bridging.
- Group note: Disable BotFather group privacy (`/setprivacy` -> Disable) so non-command messages are visible.

5. Start a bridged terminal session:

```bash
tg claude
tg claude --dangerously-skip-permissions
tg codex
tg codex --dangerously-bypass-approvals-and-sandbox
tg pi
tg kimi
```

### Safer execution examples (recommended)

Prefer these over dangerous bypass flags when possible.

Claude (permission modes + tool/path controls):

```bash
# Default permission flow
tg claude --permission-mode default

# Auto-accept file edits, still keep permission model
tg claude --permission-mode acceptEdits

# Allow access to an extra directory in addition to current project
tg claude --add-dir ../shared-lib

# Restrict tool usage
tg claude --allowed-tools "Read,Edit,Bash(git:*)"
tg claude --disallowed-tools "Bash(rm:*)"
```

Codex (sandbox + approval policy):

```bash
# Recommended balanced mode
tg codex --sandbox workspace-write --ask-for-approval on-request

# Tighter mode: only trusted commands without approval
tg codex --sandbox workspace-write --ask-for-approval untrusted

# Auto-run in workspace sandbox, escalate only when needed
tg codex --sandbox workspace-write --ask-for-approval on-failure
```

## Agents

Create a personal agent powered by Claude Code, Codex, or any supported CLI tool. Agents are just folders with an `AGENTS.md` file that defines behavior, workflows, and skills.

### Create an agent

```bash
tg agent create my-agent --name "My Agent" --owner "Your Name" --description "What it does"
cd my-agent
tg claude
```

All flags are optional — defaults are used when omitted:

```bash
tg agent create my-agent
```

### What you get

```
my-agent/
  AGENTS.md          # Agent definition (soul, owner, core behavior)
  CLAUDE.md          # Points to AGENTS.md
  workflows/         # Reusable workflows (standalone .md files with frontmatter)
  skills/            # Reusable skills (SKILL.md files)
```

The `<agent-core>` block in `AGENTS.md` contains the managed agent behavior — resolution logic, workflow/skill patterns, and built-in capabilities. Everything outside that block (name, description, owner) is yours to customize.

### Update agent core

When a new version of the agent core is released, update in place:

```bash
cd my-agent
tg agent update
```

This replaces the `<agent-core>` block with the latest version while keeping your name, description, owner, workflows, and skills untouched.

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

- `/files` (or `tg files <query>`) opens inline picker buttons in the same chat, lets you select multiple `@path` entries, and queues them for your next message.
- `@?<query>` is shorthand for the same picker (example: `@?readme`).
- `@?<query> - <prompt>` resolves the top fuzzy match and sends `@path - prompt` directly (example: `@?readme - summarize this file`).
- `/resume` (or `tg resume`) opens a picker of recent local sessions for this tool and restarts into the selected session.
- `/output_mode simple|verbose` (or `tg output_mode simple|verbose`) sets bridge verbosity for the current chat (`simple` is default).
- `/thinking on|off|toggle` (or `tg thinking on|off|toggle`) controls whether thinking previews are forwarded for this chat (default: off).
- `/background_jobs` (Telegram command menu) or `/background-jobs` (or `tg background-jobs`) lists currently running background jobs for your connected session(s).

## Touchgrass CLI reference

### Bridge sessions

```bash
tg claude [args]
tg codex [args]
tg pi [args]
tg kimi [args]
```

- `tg claude [args]`: run Claude Code with chat bridge on the selected/linked channel.
- `tg codex [args]`: run Codex with chat bridge on the selected/linked channel.
- `tg pi [args]`: run PI with chat bridge on the selected/linked channel.
- `tg kimi [args]`: run Kimi with chat bridge on the selected/linked channel.

### Agents

```bash
tg agent create [folder] --name "Name" --owner "Owner" --description "Desc"
tg agent update
```

- `tg agent create [folder]`: scaffold a new agent from the template into the given folder (or current directory).
- `tg agent update`: update the `<agent-core>` block in `AGENTS.md` to the latest version.

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
