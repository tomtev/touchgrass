# Agents

Each agent lives in its own folder.
- `agent.md` contains options/frontmatter and references `WORKFLOW.md`
- `WORKFLOW.md` contains the full instructions/workflows

## Create a new agent

1. Duplicate `example/` and rename it
2. Edit `agent.md` with your agent options/frontmatter
3. Edit `WORKFLOW.md` with your instructions/workflows
4. Run `bash sync.sh` when you change options/frontmatter

## Folder structure

```
agents/<name>/
  agent.md      # Frontmatter/options + ./agents/<name>/WORKFLOW.md reference
  WORKFLOW.md   # System prompt + workflows
  browser/      # Persistent browser profile
  memory/       # Agent-scoped notes
```
