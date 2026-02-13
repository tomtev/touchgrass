# Workflows

Use this folder for detailed workflow markdown files.

Pattern:
- Keep schedule/cadence in `<agent-heartbeat>` in `AGENTS.md`
- Keep execution details in `workflows/*.md`

Example files:
- `workflows/email-check.md`
- `workflows/calendar-digest.md`
- `workflows/follow-up-reminders.md`

Suggested file format:

```markdown
# Workflow: Email Check

## Purpose
Triage inbox and surface important updates.

## Preconditions
- Required skill installed
- Required credentials configured

## Steps
1. Read newest messages
2. Summarize important items
3. Flag follow-ups

## Output
- Brief summary
- Suggested next action
```
