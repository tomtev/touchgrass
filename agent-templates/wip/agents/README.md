# Agents

Each agent lives in its own folder. The `agent.md` file is the single source of truth.

## Create a new agent

1. Duplicate `example/` and rename it
2. Edit `agent.md` with your agent's config and prompt
3. Run `bash sync.sh` to generate CLI configs

## Folder structure

```
agents/<name>/
  agent.md      # Frontmatter + system prompt
  workflows/    # Browser workflows, runbooks
  browser/      # Persistent browser profile
  memory/       # Agent-scoped notes
```
