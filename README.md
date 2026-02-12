# ⛳️ touchgrass.sh

Manage Claude Code, Codex & Pi terminals on the go with Telegram.

- ✅ **Simple to run** — just prefix terminal commands with `tg`, like `tg claude`
- ✅ **Communicate with your terminals from Telegram** — send input, see responses
- ✅ **Connect terminal sessions to multiple groups and topics** — each session gets its own chat
- ✅ **Heartbeat mode** — run autonomous cron jobs and workflows with `--tg-heartbeat`

### Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash
```

Add `tg` in front of any agent CLI command to bridge it to Telegram. See responses, send input, and manage sessions — all from chat. Works with Claude Code, Codex, PI, and any terminal tool.

```bash
tg init      # To setup telegram etc.
tg claude    # To start a Claude Code. All --props allowed.
tg codex     # To start Codex. All --props allowed.
```

#### Heartbeat mode - Keep your terminals alive with workflows and cron jobs.

Set up autonomous workflows with **heartbeat mode** — your agent checks a `HEARTBEAT.md` file on a schedule and follows the instructions inside. Update the file from anywhere (even your phone) and the agent picks it up on the next beat.

```bash
tg claude --tg-heartbeat --tg-interval 30    # check in every 30 minutes
```

More channels (Discord, Slack) coming soon.

## Table of contents

- [Setup](#setup)
- [How it works](#how-it-works)
- [CLI commands](#cli-commands)
- [Telegram commands](#telegram-commands)
- [Connect terminal sessions to Telegram](#connect-terminal-sessions-to-telegram)
- [Heartbeat mode](#heartbeat-mode)
- [FAQ](#faq)
- [Requirements](#requirements)

## Setup

### 1. Install

```bash
curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash
```

### 2. Create a Telegram bot

1. Open Telegram and talk to [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 3. Configure touchgrass.sh

```bash
tg init
# Paste your bot token when prompted
```

### 4. Pair your Telegram account

```bash
tg pair
# Shows a pairing code
```

Send `/pair <code>` to your bot in Telegram.

### 5. Run an agent

```bash
tg claude                                # Start Claude Code
tg claude --dangerously-skip-permissions # Start Claude Code in auto-accept mode
tg codex                                              # Start Codex
tg codex --dangerously-bypass-approvals-and-sandbox   # Start Codex in auto-accept mode
tg pi                                    # Start PI
tg claude --tg-send-files                # Opt-in: auto-send assistant-referenced files
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
  Session manager  <---  Input routing
```

Two processes cooperate:

1. **CLI process** (`tg claude`) — spawns a PTY for the agent, watches its JSONL output for assistant responses, sends them to Telegram
2. **Daemon** — auto-starts when needed, polls Telegram for your messages, routes them to the right session, auto-stops after 30s of inactivity

## CLI commands

### Agent commands

| Command | Description |
|---------|-------------|
| `tg claude [args]` | Run Claude Code with chat bridge |
| `tg codex [args]` | Run Codex with chat bridge |
| `tg pi [args]` | Run PI with chat bridge |

### Tool commands

| Command | Description |
|---------|-------------|
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
| `/subscribe <id>` | Subscribe this chat to a session |
| `/unsubscribe` | Unsubscribe from current session |
| `/link` | Register this group/topic with the bot |
| `/help` | Show help |
| `/pair <code>` | Pair with a pairing code |

Any plain text you send goes to the subscribed session.

## Connect terminal sessions to Telegram

When you run `tg claude`, a picker lets you choose where to send output — your DM, a group, or a forum topic.

1. Add the bot to a Telegram group (or forum)
2. Send `/link` in the group to register it (or `/link TopicName` inside a forum topic)
3. Start a session — linked groups and topics appear in the picker

```
  ⛳ Select a Telegram channel:
  ❯ TouchgrassBot          (DM)
    Dev Team                (Group)
      Features              (Topic)
      Bugs                  (Topic)
    Other Group             (Group)

  Add bot to a Telegram group and send /link to add more channels
```

You can also subscribe from Telegram: `/subscribe <session-id>` in any linked group or topic.

All group members can see responses, but only paired users can send input.

**Note:** Disable "Group Privacy" in BotFather (`/setprivacy` -> Disable) so the bot can see non-command messages in groups.

## Heartbeat mode

Automatically send a periodic message to the agent, prompting it to check a `HEARTBEAT.md` file for instructions. Great for long-running autonomous workflows.

```bash
tg claude --tg-heartbeat                       # Default: every 60 minutes
tg claude --tg-heartbeat --tg-interval 30      # Every 30 minutes
```

Every interval, touchgrass.sh submits this to the agent's terminal:

```
[2025-06-15 14:30] Go check @HEARTBEAT.md file and follow instructions
```

Create a `HEARTBEAT.md` in your project directory with whatever instructions you want:

```markdown
# Heartbeat Instructions

1. Run the test suite: `bun test`
2. If any tests fail, fix them
3. Run `bun run typecheck` and fix any type errors
4. Commit any changes with a descriptive message
```

Update `HEARTBEAT.md` any time (even from your phone via git push) and the agent picks up new instructions on the next heartbeat.

## Resuming sessions

To resume an existing agent session with Telegram bridging:

```bash
tg claude --resume <session-id>
tg codex resume <session-id>
tg pi --continue
```

**Note:** If you use `/resume` inside Claude Code (after starting with `tg claude`), the Telegram bridge stays connected to the original session. To bridge the new session, restart with `tg claude --resume <id>`.

## FAQ

**Does `tg claude` change how Claude Code works?**
No. It's a thin PTY wrapper — Claude runs in a real terminal and behaves identically. All flags, features, and keyboard shortcuts work as normal.

**Can I type locally and use Telegram at the same time?**
Yes. Local input is instant. Telegram input is polled every 200ms. Avoid typing in both simultaneously as keystrokes could interleave.

## Requirements

- macOS or Linux (arm64 or x64)
- A Telegram account and bot token

## License

MIT
