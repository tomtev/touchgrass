# ⛳️ touchgrass.sh

Go outside. Your agents have it covered.

Manage your AI coding agents (Claude Code, Codex, PI) from your phone via Telegram. Start a session, walk away, get updates, send input — all from chat.

More channels (Discord, Slack) coming soon.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash
```

## Setup

### 1. Create a Telegram bot

1. Open Telegram and talk to [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 2. Configure TouchGrass

```bash
tg init
# Paste your bot token when prompted
```

### 3. Pair your Telegram account

```bash
tg pair
# Shows a pairing code
```

Send `/pair <code>` to your bot in Telegram.

### 4. Run an agent

```bash
tg claude          # Start Claude Code
tg codex           # Start Codex
tg pi              # Start PI
tg claude --name my-project   # Custom session name
```

That's it. You'll get agent responses in Telegram and can send input back from your phone.

## How it works

```
Your terminal                        Telegram
    |                                    |
  tg claude                         Bot receives
    |                               your messages
  PTY + JSONL watcher                   |
    |                                   |
  Daemon (auto-started)  <--------> Message router
    |                                   |
  Session manager  <---  Input routing (reply-to, prefix, connect)
```

Two processes cooperate:

1. **CLI process** (`tg claude`) — spawns a PTY for the agent, watches its JSONL output for assistant responses, sends them to Telegram
2. **Daemon** — auto-starts when needed, polls Telegram for your messages, routes them to the right session, auto-stops after 30s of inactivity

## CLI commands

| Command | Description |
|---------|-------------|
| `tg claude [args]` | Run Claude Code with chat bridge |
| `tg codex [args]` | Run Codex with chat bridge |
| `tg pi [args]` | Run PI with chat bridge |
| `tg ls` | List active sessions |
| `tg init` | Set up bot token |
| `tg pair` | Generate a pairing code |
| `tg doctor` | Check system health |
| `tg config` | View configuration |
| `tg logs` | Tail the daemon log |

## Telegram commands

| Command | Description |
|---------|-------------|
| `/sessions` | List active sessions |
| `/connect <id>` | Connect chat to a session |
| `/disconnect` | Disconnect from current session |
| `/send <id> <text>` | Send to a specific session |
| `/help` | Show help |
| `/pair <code>` | Pair with a pairing code |

Any plain text you send goes to the connected session. Reply to a bot message to send input to that specific session.

## Group chats

Add the bot to a Telegram group, then use `/connect <session-id>` to subscribe the group to a session's output. All group members can see responses, but only paired users can send input.

**Note:** Disable "Group Privacy" in BotFather (`/setprivacy` -> Disable) so the bot can see non-command messages in groups.

## Multiple sessions

Run multiple agents at once:

```bash
# Terminal 1
tg claude --name frontend

# Terminal 2
tg codex --name backend
```

In Telegram:
- `/sessions` — see all running sessions
- `/connect r-abc123` — switch which session receives your messages
- Reply to any bot message to send to that specific session
- `/send r-abc123 do something` — send to a session without switching

## Requirements

- [Bun](https://bun.sh) (for building from source)
- macOS or Linux
- A Telegram account and bot token

## License

MIT
