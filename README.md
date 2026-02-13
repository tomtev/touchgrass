# ⛳️ touchgrass.sh

Manage your Claude Code, Codex, and PI terminals on the go with Telegram. 

- ✅ **Simple to run** — just prefix terminal commands with `tg`, like `tg claude`
- ✅ **Mange your Claude Code, Codex etc terminals on-the-go** — send input, see responses
- ✅ **Run cron jobs and workflows** — Add a `HEARTBEAT.md` file to run schuedeled tasks.
- ✅ **Headless mode** — run long-lived JSON bridges for Claude, Codex, and PI (no local terminal interface)

### Quick install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tomtev/touchgrass/main/install.ps1 | iex
```

Add `tg` in front of any agent CLI command to bridge it to chat. See responses, send input, and manage sessions from channels like Telegram. Use it for direct sessions or autonomous agents built on Claude Code, Codex, PI, and other terminal tools.

```bash
tg init      # To setup telegram etc.
tg claude    # To start a Claude Code. All --props allowed.
tg codex     # To start Codex. All --props allowed.
```

More channels (Discord, Slack) coming soon.

## Table of contents

- [Setup](#setup)
- [How it works](#how-it-works)
- [CLI commands](#cli-commands)
- [Telegram commands](#telegram-commands)
- [Connect terminal sessions to Telegram](#connect-terminal-sessions-to-telegram)
- [Heartbeat](#heartbeat)
- [Headless Mode](#headless-mode)
- [FAQ](#faq)
- [Requirements](#requirements)

## Setup

### 1. Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tomtev/touchgrass/main/install.ps1 | iex
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

Start an agent (local terminal + Telegram bridge):

```bash
tg claude
tg codex
tg pi
```

Auto-accept mode (optional):

```bash
tg claude --dangerously-skip-permissions
tg codex --dangerously-bypass-approvals-and-sandbox
```

Headless mode (no local terminal interface):

```bash
tg claude --headless
tg codex --headless
tg pi --headless
tg claude --headless --dangerously-skip-permissions
tg codex --headless --dangerously-bypass-approvals-and-sandbox
```

Note: Headless mode currently does not support interactive approval prompts, so use permissive flags carefully.

Bind to a channel up front (skip picker):

```bash
tg claude --channel dm
tg claude --channel "Dev Team"
tg claude --channel telegram:-987:12
tg claude --channel none
```

Send a file to a session's channel(s):

```bash
tg send r-abc123 --file ./notes.md
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
   Control transport is Unix socket on macOS/Linux, localhost TCP on Windows.

## CLI commands

### CLI agent commands

| Command | Description |
|---------|-------------|
| `tg claude [args]` | Run Claude Code with chat bridge |
| `tg codex [args]` | Run Codex with chat bridge |
| `tg pi [args]` | Run PI with chat bridge |

### Tool commands

| Command | Description |
|---------|-------------|
| `tg init` | Set up bot token |
| `tg pair` | Generate a pairing code |
| `tg doctor` | Check system health |
| `tg config` | View configuration |
| `tg logs` | Tail the daemon log |

### Session commands

| Command | Description |
|---------|-------------|
| `tg ls` | List active sessions |
| `tg channels` | List available channels (DM, groups, topics) with busy status |
| `tg send <id> <message>` | Send a message to a session |
| `tg send --file <id> <path>` | Send a file to a session's channel(s) |
| `tg peek <id> [count]` | Peek at recent messages from a session (default: 10) |
| `tg peek --all [count]` | Peek at recent messages from all sessions |

## Telegram commands

| Command | Description |
|---------|-------------|
| `/sessions` | List active sessions |
| `/link` | Add this chat as a channel |
| `/help` | Show help |
| `/pair <code>` | Pair with a pairing code |

Any plain text you send goes to the connected session.

## Connect terminal sessions to Telegram

When you run `tg claude`, a picker lets you choose where to send output — your DM, a group, or a forum topic.

1. Add the bot to a Telegram group (or topic)
2. Send `/link` in the group to register it (or `/link TopicName` inside a topic)
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

All group members can see responses, but only paired users can send input.

**Note:** Disable "Group Privacy" in BotFather (`/setprivacy` -> Disable) so the bot can see non-command messages in groups.

## Heartbeat

Heartbeat runs automatically for `tg` agent sessions when a `HEARTBEAT.md` file exists in the working directory. It sends periodic instructions to your agent, which is useful for long-running autonomous workflows.

Behavior per tick:
- If `<run>` workflows are due, touchgrass loads each due workflow file and sends that workflow context to the agent.
- If no workflows are due, the tick is skipped.
- If there are no `<run>` entries, plain text inside `<heartbeat>` is sent (if present).

Create a `HEARTBEAT.md` in your project directory:

```markdown
/*
Optional notes here.
This comment block is ignored by heartbeat processing.
*/

<heartbeat interval="15">
  <run workflow="session-checkin" always="true" />
  <run workflow="email-check" every="15m" />
  <run workflow="calendar-digest" at="09:00" on="weekdays" />
</heartbeat>
```

Notes:
- Heartbeat interval is configured in `HEARTBEAT.md` via `<heartbeat interval="...">` (default `15` minutes).
- `/* ... */` comments are stripped before sending content to the agent.
- `<run>` entries are parsed from inside `<heartbeat>...</heartbeat>`.
- Workflow content is loaded from `workflows/<name>.md` (for example `workflows/email-check.md`).
- Text inside `<heartbeat>` is allowed and can be used as shared context.
- If `<run>` entries exist but none are due, that heartbeat cycle is skipped.
- If `HEARTBEAT.md` is empty (or comment-only), that heartbeat cycle is skipped.

Update `HEARTBEAT.md` any time (even from your phone via git push) and the agent picks up new instructions on the next heartbeat.

## Headless Mode

Headless mode runs a long-lived bridge process (`tg <tool> --headless`) without a local interactive terminal interface.
The bridge receives input from Telegram via the daemon, executes the tool-specific driver, and forwards assistant/tool output back to Telegram.

### Claude headless driver

For each inbound message, touchgrass runs one Claude process per turn:

```bash
claude [your args] [--resume <session-id> | --continue] \
  --print --input-format text --output-format stream-json "<message>"
```

Notes:
- `--print`, `--input-format`, and `--output-format` are normalized by touchgrass for headless mode.
- Session continuity is maintained by tracking Claude `session_id` and reusing `--resume`.
- Interactive approval prompts are not currently supported in headless mode; use `--dangerously-skip-permissions` when needed.

### Codex headless driver

For each inbound message, touchgrass runs Codex in JSON mode per turn:

```bash
codex exec --json [your args] "<message>"
```

After a thread is established, touchgrass resumes it on subsequent turns:

```bash
codex exec resume --json [your args] <thread-id> "<message>"
```

Notes:
- If `--last` is requested, touchgrass resumes the most recent thread once, then keeps using the discovered thread ID.
- Tool calls/results are parsed from Codex JSON events and forwarded to Telegram.
- Interactive approval prompts are not currently supported in headless mode; use `--dangerously-bypass-approvals-and-sandbox` when needed.

### PI headless driver

PI runs as one persistent RPC process:

```bash
pi [your args] --mode rpc
```

For each inbound message, touchgrass writes a prompt command to PI stdin:

```json
{"id":"prompt-1","type":"prompt","message":"<message>","streamingBehavior":"followUp"}
```

Notes:
- The bridge waits for PI `turn_end` before completing that input cycle.
- This keeps a single long-lived PI process while still using message-by-message control from Telegram.

## Resuming sessions

To resume an existing agent session with Telegram bridging:

```bash
tg claude --resume <session-id>
tg codex resume <session-id>
tg pi --continue
```

**Note:** If you use `/resume` inside Claude Code (after starting with `tg claude`), the Telegram bridge stays connected to the original session. To bridge the new session, restart with `tg claude --resume <id>`.

## FAQ

**Does `tg` change how my CLI tool works?**
No. It's a thin PTY wrapper — your tool runs in a real terminal and behaves identically. All flags, features, and keyboard shortcuts work as normal.

**How does it send messages to Telegram?**
A lightweight file watcher reads the session JSONL files that CLI tools like Claude Code, Codex, and PI already write. When new assistant output appears, it's forwarded to Telegram via the Bot API. No hooks or plugins are injected into the tool itself.

**How does heartbeat work?**
It reads `HEARTBEAT.md` on a schedule. `/* ... */` comments are ignored. If `<run>` entries are due, it loads the due `workflows/*.md` files and sends that context. If runs exist but none are due, the cycle is skipped. If there are no runs, plain `<heartbeat>` text is sent (if present). If the file is empty/comment-only, the cycle is skipped.

**Can I type locally and use Telegram at the same time?**
Yes. Both work in real-time. Avoid typing in both simultaneously as keystrokes could interleave.

## Requirements

- macOS/Linux (arm64 or x64), or Windows (x64)
- A Telegram account and bot token

## License

MIT

## [WIP] Agent Management

`tg agents` and Beekeeper scaffolding are under active development. Command flags and generated template fields may change.
