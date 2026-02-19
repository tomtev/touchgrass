# Touchgrass Agent Template

A personal agent template for CLI tools like Claude Code, Codex, Pi etc,
controlled from Telegram via [touchgrass.sh](https://touchgrass.sh).

## Quick Start

```bash
# Install touchgrass
curl -fsSL https://touchgrass.sh/install.sh | bash

# Create your agent
tg agent create my-agent --name "My Agent"
cd my-agent

# Setup Telegram bot and pair
tg setup
tg pair

# Run it
tg claude
```

## How It Works

1. **`AGENTS.md`** defines the agent — personality, resolution logic, and core capabilities
2. **`workflows/`** holds reusable workflows as standalone markdown files
3. **`skills/`** holds reusable skills that extend what the agent can do


## Structure

```
AGENTS.md          # Agent definition
CLAUDE.md          # Points to AGENTS.md
workflows/         # Reusable workflows (standalone .md files with frontmatter)
skills/            # Reusable skills (SKILL.md files)
```

### Workflows

Each workflow is a standalone markdown file with YAML frontmatter:

```markdown
---
title: Deploy to production
purpose: Build, test, and deploy the app to production server
---

## Steps
...
```

The agent searches workflows by frontmatter, runs them in sub-agents, and can create new ones on the fly.

### Skills

Skills are installable capabilities (SKILL.md files) that handle common patterns — browser automation, web scraping, skill creation, etc. The agent prefers existing skills over custom scripts.

## Running

### With touchgrass.sh (remote control from Telegram)

[touchgrass.sh](https://touchgrass.sh) bridges your local CLI sessions to Telegram, so you can control the agent from your phone.

```bash
# Install
curl -fsSL https://touchgrass.sh/install.sh | bash

# Setup — connects your Telegram bot
tg setup

# Pair your Telegram chat to this machine
tg pair

# Start a session bridged to Telegram
tg claude --dangerously-skip-permissions
```
