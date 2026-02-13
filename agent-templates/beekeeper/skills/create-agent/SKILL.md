---
name: create-agent
description: Create or update installable agent packages with practical AGENTS/CLAUDE/HEARTBEAT scaffolds and focused skills.
---

# Create Agent

Use this skill when the user wants a new agent, a new agent template, or a significant update to an existing agent profile.

## Goals

1. Deliver a minimal, usable agent package quickly.
2. Keep behavior explicit in `AGENTS.md`.
3. Keep skills focused and composable.

## Standard Package

When creating an agent package, include:

- `AGENTS.md` with owner/soul/context
- `CLAUDE.md` pointing to `@AGENTS.md`
- `HEARTBEAT.md` if scheduled workflows are relevant
- `workflows/` folder with one or more markdown workflow files
- `skills/<skill-name>/SKILL.md` for specialized capabilities

## Workflow

1. Clarify purpose (what the agent should do daily).
2. Define operation mode (interactive, scheduled, or mixed).
3. Add or reuse skills for repeated tasks.
4. Keep commands and examples runnable.
5. Validate the folder structure and references.

## Quality Bar

- Prefer simple defaults over complex frameworks.
- Prefer skill-first expansion over ad-hoc prompt sprawl.
- Keep user-facing language direct and practical.
