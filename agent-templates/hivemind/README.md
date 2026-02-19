# Agent Template

An open alternative to OpenClaw, built on core Claude Code and Codex fundamentals.

Drop this template into any project to get a multi-agent orchestrator that works natively with Claude Code and Codex CLI — no proprietary runtime required. Designed to pair with tools like [touchgrass.sh](https://touchgrass.sh) for remote control from Telegram.

## How It Works

1. **`AGENTS.md`** defines the orchestrator — it tells Claude Code how to run, create, and manage agents
2. **`agents/`** holds agent folders; each agent has `agent.md` (options) + `WORKFLOW.md` (instructions)
3. **`agents/sync.sh`** generates CLI-specific configs (`.claude/agents/`, `.codex/`) from the agent definitions
4. **`skills/`** holds reusable skills that agents can reference

Each agent uses:
- `agent.md` for options/frontmatter and a `./agents/<name>/WORKFLOW.md` reference
- `WORKFLOW.md` for the actual system prompt + workflows

This means workflow edits do not require re-running `sync.sh`.

## Quick Start

```bash
# 1. Copy this template into your project root
cp -r agent-templates/[wip]/* your-project/

# 2. Create an agent
cp -r agents/example agents/my-agent
# Edit agents/my-agent/agent.md (options/frontmatter)
# Edit agents/my-agent/WORKFLOW.md (instructions)

# 3. Sync configs (needed when creating agent or editing options/frontmatter)
bash agents/sync.sh

# 4. Run it
# In Claude Code: use the Task tool with subagent_type="my-agent"
# In Codex: agents are available via the multi-agent config
```

## Running Examples

### Claude Code

```bash
# Interactive — the orchestrator manages agents via subagents
claude --dangerously-skip-permissions

# Give it a task directly
claude --dangerously-skip-permissions -p "run the helpscout-support agent"

# Resume a previous session
claude --dangerously-skip-permissions --resume
```

### Codex

```bash
# Interactive with full auto-approval
codex --dangerously-skip-permissions

# Give it a task directly
codex --dangerously-skip-permissions "run the helpscout-support agent"
```

### With touchgrass.sh (remote control from Telegram)

[touchgrass.sh](https://touchgrass.sh) bridges your local CLI sessions to Telegram, so you can control agents from your phone.

```bash
# Install
curl -fsSL https://touchgrass.sh/install.sh | bash

# Setup — connects your Telegram bot
tg setup

# Pair your Telegram chat to this machine
tg pair
```

Then start sessions that are controllable from Telegram:

```bash
# Start a Claude Code session bridged to Telegram
tg claude --dangerously-skip-permissions

# Start a Codex session bridged to Telegram
tg codex --dangerously-skip-permissions
```

Once running, send messages from Telegram to control the orchestrator — ask it to run agents, create new ones, or handle tasks directly.

## Why Not OpenClaw?

This template uses the native agent/subagent capabilities already built into Claude Code and Codex. No external runtime, no vendor lock-in, no extra dependencies. Just markdown files and a shell script.

- Works with Claude Code, Codex, and any CLI that reads `.claude/` or `.codex/` config
- Agents are plain markdown — version them, review them, share them
- Browser automation via `agent-browser` for agents that need web access
- Pairs with [touchgrass.sh](https://touchgrass.sh) for remote orchestration from Telegram
