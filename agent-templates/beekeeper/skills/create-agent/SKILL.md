---
name: create-agent
description: Create or update installable agent packages with practical AGENTS/CLAUDE/workflow scaffolds and focused skills.
---

# Create Agent

Use this skill when the user wants a new agent, a new agent template, or a significant update to an existing agent profile.

## Goals

1. Deliver a minimal, usable agent package quickly.
2. Keep behavior explicit in `AGENTS.md`.
3. Keep skills focused and composable.

## Included Starter Template

Use the shared starter package in `agent-templates/`:

- `agent-templates/new-agent/AGENTS.md`
- `agent-templates/new-agent/CLAUDE.md`
- `agent-templates/new-agent/workflows/README.md`
- `agent-templates/new-agent/skills/find-skills/SKILL.md`

Always start from this shared template when creating a new agent so every package has a consistent baseline.

## Standard Package

When creating an agent package, include:

- `AGENTS.md` with owner/soul/context
- `CLAUDE.md` pointing to `@AGENTS.md`
- `<agent-heartbeat>` block in `AGENTS.md` for scheduled workflows
- `workflows/` folder with one or more markdown workflow files
- `skills/<skill-name>/SKILL.md` for specialized capabilities
- `skills/find-skills/SKILL.md` by default for capability discovery

## Workflow

### 1) Create via CLI (default path)

Use the `tg agents` CLI command:

```bash
tg agents create <agent-id> --dir <target-agent-dir>
```

To run non-interactively and set identity fields in one command:

```bash
tg agents create <agent-id> \
  --dir <target-agent-dir> \
  --name "<agent-name>" \
  --description "<description>" \
  --owner-name "<owner>" \
  --location "<location>" \
  --timezone "<timezone>" \
  --yes
```

The CLI renders dynamic placeholders in `AGENTS.md` (owner, name, description, location, timezone).

### 2) Customize identity and purpose

1. Edit `<target-agent-dir>/AGENTS.md`:
   - set owner
   - set agent name/personality
   - define mission and guardrails
2. Keep `CLAUDE.md` as `@AGENTS.md`.
3. Configure cadence in `<agent-heartbeat>` in `AGENTS.md` when scheduling is needed.
4. Add workflow files in `<target-agent-dir>/workflows/` for detailed steps.
5. Keep `skills/find-skills/SKILL.md` included unless explicitly removed by the user.

### 3) Validate package structure

Required files before handoff:

- `AGENTS.md`
- `CLAUDE.md`
- `skills/find-skills/SKILL.md`

### 4) Fallback (only if CLI is unavailable)

```bash
mkdir -p <target-agent-dir>
cp -R agent-templates/new-agent/. <target-agent-dir>/
```

## Quality Bar

- Prefer simple defaults over complex frameworks.
- Prefer skill-first expansion over ad-hoc prompt sprawl.
- Keep user-facing language direct and practical.
