# Agent Sync

One markdown file per agent in this folder is the single source of truth. Run `sync.sh` to generate CLI-specific configs for Claude Code and Codex.

## Usage

```bash
bash agents/sync.sh
```

This generates:
- `.claude/agents/<name>.md` — Claude Code agent files
- `.codex/agents/<name>.toml` — Codex agent config files
- `.codex/config.toml` — Codex main config with all agents registered

Generated directories are wiped and rebuilt on each run, so deleting or renaming an agent file cleanly removes its configs.

## Agent file format

```markdown
---
name: my-agent
description: What this agent does.
read_only: true
skills: find-skills, another-skill
claude:
  model: sonnet
  memory: project
codex:
  model: gpt-5.3-codex
  model_reasoning_effort: high
---

System prompt goes here.
```

## Fields

| Field | Effect |
|---|---|
| `name` | Agent identifier, used for filenames and config sections |
| `description` | Shared description across CLIs |
| `read_only: true` | Claude: `tools: Read, Grep, Glob, Bash`. Codex: `sandbox_mode = "read-only"` |
| `skills` | Skills to preload (comma-separated). Maps to Claude `skills:` field |
| `claude.model` | Claude Code model (`sonnet`, `opus`, `haiku`) |
| `claude.tools` | Override tool list (takes precedence over `read_only`) |
| `claude.skills` | Override skills (takes precedence over top-level `skills`) |
| `claude.memory` | Memory scope (`user`, `project`, `local`) |
| `codex.model` | Codex model |
| `codex.model_reasoning_effort` | Reasoning effort (`low`, `medium`, `high`) |
| Body | System prompt — used as markdown body for Claude, `developer_instructions` for Codex |

## Adding a new agent

1. Create `<name>.md` in this folder
2. Run `bash agents/sync.sh`
3. Configs appear in `.claude/agents/` and `.codex/`
