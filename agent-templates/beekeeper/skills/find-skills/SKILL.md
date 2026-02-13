---
name: find-skills
description: Discover and install skills for personal agent workflows (email, calendar, reminders, monitoring, notifications, and recurring automation).
---

# Find Skills

Use this skill to discover and install skills for personal assistant and life-ops automation.
Default focus is personal agent work, not web development.
Scheduling is handled by `<agent-heartbeat>` in `AGENTS.md` and `workflows/*.md`, not by finding scheduler skills.

## When to Use This Skill

Use this skill when the user:

- Asks for recurring personal automation
- Asks for capabilities like email triage, reminders, scheduling, check-ins, or notifications
- Says "find a skill for X" or "is there a skill for X"
- Wants the agent to improve itself with installable skills

Do not use this skill to solve cadence itself (every 15 minutes, hourly, daily).
Use heartbeat/workflow files for cadence.

## What is the Skills CLI?

The Skills CLI (`npx skills`) is the package manager for the open agent skills ecosystem. Skills are modular packages that extend agent capabilities with specialized knowledge, workflows, and tools.

**Key commands:**

- `npx skills find [query]` - Search for skills interactively or by keyword
- `npx skills add <package>` - Install a skill from GitHub or other sources
- `npx skills check` - Check for skill updates
- `npx skills update` - Update all installed skills

**Browse skills at:** https://skills.sh/

## How to Help Users Find Skills

### Step 1: Understand What They Need

Identify:

1. Task domain (email, calendar, reminders, tasks, notifications, check-ins)
2. Trigger pattern (manual, every N minutes, daily, event-based)
3. Provider context (Gmail, Outlook, IMAP, Google Calendar, etc.)
4. Safety/privacy expectations (read-only vs. send/edit access)

### Step 2: Search for Skills

Run targeted searches with both domain and behavior terms:

```bash
npx skills find [query]
```

For example:

- "Check my email every 15 minutes" -> `npx skills find email inbox triage`
- "Summarize my inbox each morning" -> `npx skills find inbox summary daily`
- "Alert me about calendar conflicts" -> `npx skills find calendar conflict alerts`
- "Ping me if no reply in 2 days" -> `npx skills find follow-up email automation`

The command will return results like:

```text
Install with npx skills add <owner/repo@skill>
owner/repo@skill-name
https://skills.sh/<owner>/<repo>/<skill-name>
```

### Step 3: Present Options to the User

When you find relevant skills, present them to the user with:

1. The skill name and what it does
2. The install command they can run
3. A link to learn more at skills.sh
4. Any required accounts/permissions (email/calendar provider, API keys)

Example response:

```text
I found a skill that can help with inbox automation and scheduled checks.

To install it:
npx skills add <owner/repo@skill-name>

Learn more: https://skills.sh/<owner>/<repo>/<skill-name>
```

### Step 4: Offer to Install

If the user wants to proceed, you can install the skill for them:

```bash
npx skills add <owner/repo@skill> -g -y
```

The `-g` flag installs globally (user-level) and `-y` skips confirmation prompts.

After installation:

1. Add the skill path to `AGENTS.md` under `## Available Skills`
2. Create or update `workflows/<workflow-name>.md` with concrete steps
3. Update `<agent-heartbeat>` in `AGENTS.md` for that workflow cadence/routing
4. Confirm behavior with one simple test command

## Priority Domains

When searching, prioritize personal agent domains:

| Domain | Example Queries |
| --- | --- |
| Email | email triage, inbox summary, follow-up reminders, imap, gmail |
| Calendar | calendar check, scheduling, conflict alerts, meeting prep |
| Reminders | recurring reminders, daily digest, periodic check-ins |
| Tasks | task capture, todo sync, project checklists |
| Notifications | sms alerts, push notifications, digest reports |
| Monitoring | status checks, heartbeat reports, exception alerts |

## Tips for Effective Searches

1. Use domain + behavior + cadence in one query (`email + check + every 15 min`)
   Cadence belongs in heartbeat/workflow setup, not in a scheduler skill.
2. Try provider-specific variants (`gmail`, `outlook`, `imap`, `calendar`)
3. Prefer least-privilege skills when multiple options exist
4. Prefer maintained sources and transparent setup docs

## When No Skills Are Found

If no relevant skills exist:

1. Acknowledge that no existing skill was found
2. Offer a lightweight custom workflow in existing agent context
3. Suggest creating a local skill (or use create-agent workflow)

Example:

```text
I could not find a good installable skill for that exact workflow.
I can set up a lightweight custom flow now, then we can promote it to a reusable local skill.

If this will be used often, create a reusable skill:
npx skills init my-xyz-skill
```
