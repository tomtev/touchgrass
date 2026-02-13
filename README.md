# ⛳️ touchgrass.sh

A framework for building and running personal agents on top of Claude Code, Codex, and PI, and for managing agent sessions and coding terminals on the go via Telegram and other messaging platforms.

Run mode overview:
- ✅ **Terminal mode** — normal local CLI interface + Telegram bridge
- ✅ **Agent mode (`--agent-mode`)** — long-lived JSON bridge for autonomous flows (no local terminal interface)
- ✅ **Heartbeat (agent mode)** — add a `HEARTBEAT.md` file for scheduled workflows and cron-style tasks
- ✅ **Simple to run** — prefix supported CLIs with `tg`, like `tg claude`

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
tg init
tg claude
tg codex
```

More channels (Discord, Slack) coming soon.

## Table of contents

- [Setup](#setup)
- [How it works](#how-it-works)
- [CLI commands](#cli-commands)
- [Telegram commands](#telegram-commands)
- [Connect terminal sessions to Telegram](#connect-terminal-sessions-to-telegram)
- [Terminal Mode](#terminal-mode)
- [Agent Mode](#agent-mode)
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

### 5. Choose a run mode

Terminal mode (local terminal interface + Telegram bridge):

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

Agent mode (no local terminal interface):

```bash
tg claude --agent-mode
tg codex --agent-mode
tg pi --agent-mode
tg claude --agent-mode --dangerously-skip-permissions
tg codex --agent-mode --dangerously-bypass-approvals-and-sandbox
```

Note: Agent mode currently does not support interactive approval prompts, so use permissive flags carefully.

If `HEARTBEAT.md` is present and you start without `--agent-mode`, `tg` prompts you to switch to agent mode for that run.

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

## Terminal Mode

Terminal mode runs your CLI tool with its normal local terminal interface, while also bridging input/output to Telegram.

Use terminal mode when you want:
- Full local interactive UX (TTY UI, keyboard controls, approval prompts)
- Telegram mirroring and remote input from your phone

Commands:

```bash
tg claude
tg codex
tg pi
```

Note: Heartbeat does not run in terminal mode.

## Agent Mode

Agent mode runs a long-lived bridge process (`tg <tool> --agent-mode`) without a local interactive terminal interface.
The bridge receives input from Telegram via the daemon, executes the tool-specific driver, and forwards assistant/tool output back to Telegram.

Use agent mode when you want:
- Long-running autonomous behavior
- Heartbeat-driven workflows from `HEARTBEAT.md`
- A non-interactive bridge process instead of a local terminal UI

### Starting agent mode

```bash
tg claude --agent-mode
tg codex --agent-mode
tg pi --agent-mode
tg claude --agent-mode --dangerously-skip-permissions
tg codex --agent-mode --dangerously-bypass-approvals-and-sandbox
```

Note: Agent mode currently does not support interactive approval prompts, so use permissive flags carefully.

### Under the hood (simple)

When you run `tg <tool> --agent-mode`, touchgrass does this:

1. Starts a long-lived bridge process and links it to your selected Telegram chat/topic.
2. Waits for inbound user messages from Telegram.
3. For each message, forwards it to Claude/Codex/PI and waits for the result.
4. Sends assistant output and tool events back to Telegram.
5. Repeats until you stop the bridge (`Ctrl+C`).

If `HEARTBEAT.md` exists, scheduled workflow inputs are also injected on each heartbeat tick (agent mode only).

Advanced per-tool protocol details are in the driver sections below.

### Heartbeat and workflows

Heartbeat is supported only in `--agent-mode`. If a `HEARTBEAT.md` file exists in the working directory, touchgrass sends periodic instructions to your agent for long-running workflows and cron-style tasks.
If you start without `--agent-mode` and `HEARTBEAT.md` is detected, `tg` asks whether to switch to agent mode for that run.

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

### AGENTS.md structure and naming

Use `AGENTS.md` as the source of truth for agent identity and behavior.

Naming conventions:
- `agent-id` (CLI/package identity): lowercase slug, numbers, `-` or `_` (example: `ops-bot`, `support_agent`).
- Agent display name: set in `<agent-soul>` as `Your name is: "..."` (example: `"Ops Bot"`).
- Description: set in `<agent-soul>` as `Description: "..."` and keep it short and operational.

Core block structure:

```markdown
<agent-owner>
Owner name: "Tommy"
Location: "Oslo"
Timezone: "Europe/Oslo"
</agent-owner>

<agent-soul>
Your name is: "Ops Bot"
Description: "Operational agent for project support."
</agent-soul>

<agent-context version="1.0">
...managed instructions, guardrails, and workflow policy...
</agent-context>
```

Guidelines:
- Keep owner metadata in `<agent-owner>`.
- Keep human-facing identity in `<agent-soul>`.
- Keep durable operating policy in `<agent-context>`.
- If the template says the context block is managed/versioned, treat `<agent-context version="...">` as release-managed content.
- If a user asks to rename the agent, update `Your name is: "..."` in `<agent-soul>`.
- Keep `CLAUDE.md` pointing to `@AGENTS.md`.

### Advanced: Claude driver

For each inbound message, touchgrass runs one Claude process per turn:

```bash
claude [your args] [--resume <session-id> | --continue] \
  --print --input-format text --output-format stream-json "<message>"
```

Notes:
- `--print`, `--input-format`, and `--output-format` are normalized by touchgrass for agent mode.
- Session continuity is maintained by tracking Claude `session_id` and reusing `--resume`.
- Interactive approval prompts are not currently supported in agent mode; use `--dangerously-skip-permissions` when needed.

### Advanced: Codex driver

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
- Interactive approval prompts are not currently supported in agent mode; use `--dangerously-bypass-approvals-and-sandbox` when needed.

### Advanced: PI driver

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

### Resuming sessions

To resume an existing agent session with Telegram bridging:

```bash
tg claude --resume <session-id>
tg codex resume <session-id>
tg pi --continue
```

**Note:** If you use `/resume` inside Claude Code (after starting with `tg claude`), the Telegram bridge stays connected to the original session. To bridge the new session, restart with `tg claude --resume <id>`.

## FAQ

**Does `tg` change how my CLI tool works?**
In terminal mode, no. It's a thin PTY wrapper and your tool runs in a real terminal with normal behavior. In agent mode, touchgrass runs a non-interactive bridge (no local terminal UI).

**How does it send messages to Telegram?**
Terminal mode uses a JSONL/file watcher to forward assistant output. Agent mode uses tool-specific JSON/RPC drivers and forwards events/results through the daemon to Telegram.

**How does heartbeat work?**
In agent mode, it reads `HEARTBEAT.md` on a schedule. `/* ... */` comments are ignored. If `<run>` entries are due, it loads the due `workflows/*.md` files and sends that context. If runs exist but none are due, the cycle is skipped. If there are no runs, plain `<heartbeat>` text is sent (if present). If the file is empty/comment-only, the cycle is skipped.

**Can I type locally and use Telegram at the same time?**
Yes. Both work in real-time. Avoid typing in both simultaneously as keystrokes could interleave.

## Requirements

- macOS/Linux (arm64 or x64), or Windows (x64)
- A Telegram account and bot token

## License

MIT

## [WIP] Agent Management

`tg agents` and Beekeeper scaffolding are under active development. Command flags and generated template fields may change.
