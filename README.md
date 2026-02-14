# ⛳️ touchgrass.sh

A framework for building and running personal agents on top of Claude Code, Codex, and PI, and for managing agent sessions and coding terminals on the go via Telegram, Slack, WhatsApp, and other messaging platforms.

Run mode overview:
- ✅ **Simple to run** — prefix supported CLIs with `tg`, like `tg claude`
- ✅ **Terminal mode** — Manage `claude code` terminals on the go with Telegram, Slack and more.
- ✅ **Agent mode (`--agent-mode`)** — Run Claude, Codex etc in JSON mode for agent tasks and cron jobs with Skills.

### Quick install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tomtev/touchgrass/main/install.ps1 | iex
```

Add `tg` in front of any agent CLI command to bridge it to chat. See responses, send input, and manage sessions from channels like Telegram, Slack, and WhatsApp. Use it for direct sessions or autonomous agents built on Claude Code, Codex, PI, and other terminal tools.

```bash
tg init
tg claude
tg codex
```

Current channels: Telegram, Slack, WhatsApp. More channels coming soon.

## Table of contents

- [Setup](#setup)
- [Channel setup guides](#channel-setup-guides)
- [How it works](#how-it-works)
- [CLI commands](#cli-commands)
- [Chat commands](#chat-commands)
- [Connect terminal sessions to channels](#connect-terminal-sessions-to-channels)
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

### 2. Configure a channel

```bash
tg init
# Choose telegram, slack, or whatsapp
```

`tg init` currently keeps one active channel config at a time.

### 3. Pair your account

```bash
tg pair
# Shows a pairing code
```

Send the code in your channel DM:
- Telegram: `/pair <code>`
- Slack: `tg pair <code>`
- WhatsApp: `tg pair <code>`

### 4. (Optional) Link a group/channel/thread

In any group/channel/thread you want to use for output, send `/link` (or `tg link`).

### 5. Choose a run mode

Terminal mode (local terminal interface + channel bridge):

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

If `AGENTS.md` contains `<agent-heartbeat>` and you start without `--agent-mode`, `tg` prompts you to switch to agent mode for that run.

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

That's it. You'll get agent responses in your selected channel and can send input back from your phone.

## Channel setup guides

### Telegram

1. Open Telegram and talk to [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token
4. Run `tg init` and choose `telegram`
5. Run `tg pair` and send `/pair <code>` to your bot DM
6. For groups/topics, add the bot and send `/link` in that chat

Telegram group note:
- Disable "Group Privacy" in BotFather (`/setprivacy` -> Disable) so the bot can read normal group messages.

### Slack

1. Create a Slack app and enable Socket Mode
2. Install the app to your workspace
3. Copy the bot token (`xoxb-...`) and app token (`xapp-...`)
4. Run `tg init` and choose `slack`
5. Run `tg pair` and send `tg pair <code>` in bot DM
6. Invite the bot to channels you want to use
7. Send `tg link` in a channel or thread to register it

Slack note:
- In private channels, the bot must be invited before it can read/send messages there.

### WhatsApp

1. Run `tg init` and choose `whatsapp`
2. Scan the QR code from WhatsApp Linked Devices
3. Run `tg pair` and send `tg pair <code>` in direct chat
4. Add the linked account to any WhatsApp group you want to use
5. Send `tg link` in that group

WhatsApp note:
- If the linked session expires or logs out, run `tg init` again to relink via QR.

## How it works

```
Your terminal                      Chat channel
    |                                    |
  tg claude                        Bot receives
    |                               your messages
  PTY + JSONL watcher                   |
    |                                   |
  Daemon (auto-started)  <--------> Message router
    |                                   |
  Session manager  <---  Input routing
```

Two processes cooperate:

1. **CLI process** (`tg claude`) — spawns a PTY for the agent, watches its JSONL output for assistant responses, sends them to the selected channel
2. **Daemon** — auto-starts when needed, polls the selected channel for your messages, routes them to the right session, auto-stops after 30s of inactivity
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
| `tg init` | Set up channel credentials |
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
| `tg stop <id>` | Stop a session (SIGTERM / remote stop request) |
| `tg kill <id>` | Kill a session (SIGKILL / remote kill request) |

## Chat commands

| Command | Description |
|---------|-------------|
| `/sessions` or `tg sessions` | List active sessions |
| `/link` or `tg link` | Add this chat as a channel |
| `/unlink` or `tg unlink` | Remove this chat as a channel |
| `/help` or `tg help` | Show help |
| `/pair <code>` or `tg pair <code>` | Pair with a pairing code |

Any plain text you send goes to the connected session.

## Connect terminal sessions to channels

When you run `tg claude`, a picker lets you choose where to send output — your DM, or any linked group/channel/thread.

1. Link your target chat with `/link` or `tg link`
2. Start a session with `tg claude` (or `tg codex`, `tg pi`)
3. Pick the destination chat from the list

```
  ⛳ Select a channel:
  ❯ TouchgrassBot          (DM)
    Dev Team                (Group)
      Features              (Topic)
      Bugs                  (Topic)
    Other Group             (Group)

  Link more chats with /link or tg link
```

All group members can see responses, but only paired users can send input.

## Terminal Mode

Terminal mode runs your CLI tool with its normal local terminal interface, while also bridging input/output to your selected channel.

Use terminal mode when you want:
- Full local interactive UX (TTY UI, keyboard controls, approval prompts)
- Channel mirroring and remote input from your phone

Commands:

```bash
tg claude
tg codex
tg pi
```

Note: Heartbeat does not run in terminal mode.

## Agent Mode

Agent mode runs a long-lived bridge process (`tg <tool> --agent-mode`) without a local interactive terminal interface.
The bridge receives input from your selected channel via the daemon, executes the tool-specific driver, and forwards assistant/tool output back to that channel.

Use agent mode when you want:
- Long-running autonomous behavior
- Heartbeat-driven workflows from `<agent-heartbeat>` in `AGENTS.md`
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

1. Starts a long-lived bridge process and links it to your selected chat.
2. Waits for inbound user messages from that channel.
3. For each message, forwards it to Claude/Codex/PI and waits for the result.
4. Sends assistant output and tool events back to the channel.
5. Repeats until you stop the bridge (`Ctrl+C`).

If `AGENTS.md` contains `<agent-heartbeat>`, scheduled workflow inputs are also injected on each heartbeat tick (agent mode only).

### Heartbeat and workflows

Heartbeat is supported only in `--agent-mode`. If `AGENTS.md` contains an `<agent-heartbeat>` block, touchgrass sends periodic instructions to your agent for long-running workflows and cron-style tasks.
If you start without `--agent-mode` and `<agent-heartbeat>` is detected, `tg` asks whether to switch to agent mode for that run.

Behavior per tick:
- If `<run>` workflows are due, touchgrass loads each due workflow file and sends that workflow context to the agent.
- If no workflows are due, the tick is skipped.
- If there are no `<run>` entries, plain text inside `<agent-heartbeat>` is sent (if present).

Configure heartbeat inside your project `AGENTS.md`:

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

/*
Optional notes here.
This comment block is ignored by heartbeat processing.
*/

<agent-heartbeat interval="15">
  <run workflow="session-checkin" always="true" />
  <run workflow="email-check" every="15m" />
  <run workflow="calendar-digest" at="09:00" on="weekdays" />
</agent-heartbeat>
```

Notes:
- Heartbeat interval is configured in `AGENTS.md` via `<agent-heartbeat interval="...">` (default `15` minutes).
- `/* ... */` comments are stripped before sending content to the agent.
- `<run>` entries are parsed from inside `<agent-heartbeat>...</agent-heartbeat>`.
- Workflow content is loaded from `workflows/<name>.md` (for example `workflows/email-check.md`).
- Text inside `<agent-heartbeat>` is allowed and can be used as shared context.
- If `<run>` entries exist but none are due, that heartbeat cycle is skipped.
- If `<agent-heartbeat>` is empty (or comment-only), that heartbeat cycle is skipped.

Update `AGENTS.md` any time (even from your phone via git push) and the agent picks up new instructions on the next heartbeat.

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

<agent-heartbeat interval="15">
  <run workflow="session-checkin" every="15m" />
</agent-heartbeat>

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

### Resuming sessions

To resume an existing agent session with channel bridging:

```bash
tg claude --resume <session-id>
tg codex resume <session-id>
tg pi --continue
```

**Note:** If you use `/resume` inside Claude Code (after starting with `tg claude`), the bridge stays connected to the original session. To bridge the new session, restart with `tg claude --resume <id>`.

## FAQ

**Does `tg` change how my CLI tool works?**
In terminal mode, no. It's a thin PTY wrapper and your tool runs in a real terminal with normal behavior. In agent mode, touchgrass runs a non-interactive bridge (no local terminal UI).

**How does it send messages to channels?**
Terminal mode uses a JSONL/file watcher to forward assistant output. Agent mode uses tool-specific JSON/RPC drivers and forwards events/results through the daemon to the selected channel.

**How does heartbeat work?**
In agent mode, it reads `<agent-heartbeat>` from `AGENTS.md` on a schedule. `/* ... */` comments are ignored. If `<run>` entries are due, it loads the due `workflows/*.md` files and sends that context. If runs exist but none are due, the cycle is skipped. If there are no runs, plain `<agent-heartbeat>` text is sent (if present). If the block is empty/comment-only, the cycle is skipped.

**Can I type locally and use chat at the same time?**
Yes. Both work in real-time. Avoid typing in both simultaneously as keystrokes could interleave.

## Requirements

- macOS/Linux (arm64 or x64), or Windows (x64)
- A Telegram, Slack, or WhatsApp account

## License

MIT

## [WIP] Agent Management

`tg agents` and Beekeeper scaffolding are under active development. Command flags and generated template fields may change.
