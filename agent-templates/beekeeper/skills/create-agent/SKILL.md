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

## Included Starter Template

This skill ships with a full starter package at:

- `templates/new-agent/AGENTS.md`
- `templates/new-agent/CLAUDE.md`
- `templates/new-agent/HEARTBEAT.md`
- `templates/new-agent/workflows/README.md`
- `templates/new-agent/skills/find-skills/SKILL.md`

Always start from this template when creating a new agent so every package has a consistent baseline.

## Standard Package

When creating an agent package, include:

- `AGENTS.md` with owner/soul/context
- `CLAUDE.md` pointing to `@AGENTS.md`
- `HEARTBEAT.md` if scheduled workflows are relevant
- `workflows/` folder with one or more markdown workflow files
- `skills/<skill-name>/SKILL.md` for specialized capabilities
- `skills/find-skills/SKILL.md` by default for capability discovery

## Workflow

### 1) Duplicate the starter template

Use template duplication as the default path:

```bash
mkdir -p <target-agent-dir>
cp -R agent-templates/beekeeper/skills/create-agent/templates/new-agent/. <target-agent-dir>/
```

If working from another root, adjust the source path to this skill's `templates/new-agent/` directory.

### 2) Customize identity and purpose

1. Edit `<target-agent-dir>/AGENTS.md`:
   - set owner
   - set agent name/personality
   - define mission and guardrails
2. Keep `CLAUDE.md` as `@AGENTS.md`.
3. Configure cadence in `HEARTBEAT.md` only when scheduling is needed.
4. Add workflow files in `<target-agent-dir>/workflows/` for detailed steps.
5. Keep `skills/find-skills/SKILL.md` included unless explicitly removed by the user.

### 3) Validate package structure

Required files before handoff:

- `AGENTS.md`
- `CLAUDE.md`
- `HEARTBEAT.md` (or intentionally omitted with user approval)
- `skills/find-skills/SKILL.md`

## Quality Bar

- Prefer simple defaults over complex frameworks.
- Prefer skill-first expansion over ad-hoc prompt sprawl.
- Keep user-facing language direct and practical.
