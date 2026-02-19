#!/usr/bin/env bash
# Sync agent definitions (`agents/*/agent.md`) → .claude/agents/ and .codex/ configs.
# `agent.md` should contain options/frontmatter plus a workflow reference line
# like: CORE OBJECTIVE: Follow the workflow in ./agents/<name>/WORKFLOW.md
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$DIR")"

CLAUDE_DIR="$ROOT/.claude/agents"
CODEX_DIR="$ROOT/.codex"
CODEX_AGENTS_DIR="$CODEX_DIR/agents"

# Clean generated dirs
rm -rf "$CLAUDE_DIR" "$CODEX_DIR"
mkdir -p "$CLAUDE_DIR" "$CODEX_AGENTS_DIR"

# Start codex config with features + built-in agents
cat > "$CODEX_DIR/config.toml" <<'TOML'
[features]
multi_agent = true

[agents]
max_threads = 4

[agents.default]
description = "General-purpose helper."

[agents.explorer]
description = "Fast codebase explorer for read-heavy tasks."
TOML

# Parse each agent folder (agents/<name>/agent.md)
for file in "$DIR"/*/agent.md; do
  [ -f "$file" ] || continue

  # --- Parse frontmatter ---
  name="" description="" read_only="" skills=""
  claude_model="" claude_tools="" claude_skills="" claude_memory=""
  codex_model="" codex_reasoning=""
  in_frontmatter=false
  in_claude=false
  in_codex=false
  body=""
  frontmatter_done=false

  while IFS= read -r line; do
    if ! $frontmatter_done; then
      # First line: start of frontmatter
      if ! $in_frontmatter && [[ "$line" == "---" ]]; then
        in_frontmatter=true
        continue
      fi
      # End of frontmatter
      if $in_frontmatter && [[ "$line" == "---" ]]; then
        frontmatter_done=true
        continue
      fi
      if $in_frontmatter; then
        # Detect nested sections
        if [[ "$line" == "claude:" ]]; then
          in_claude=true; in_codex=false; continue
        elif [[ "$line" == "codex:" ]]; then
          in_codex=true; in_claude=false; continue
        fi

        # Nested claude fields
        if $in_claude; then
          case "$line" in
            *model:*)    claude_model="${line#*: }" ;;
            *tools:*)    claude_tools="${line#*: }" ;;
            *skills:*)   claude_skills="${line#*: }" ;;
            *memory:*)   claude_memory="${line#*: }" ;;
            *)           in_claude=false ;;
          esac
          $in_claude && continue
        fi

        # Nested codex fields
        if $in_codex; then
          case "$line" in
            *model:*)                   codex_model="${line#*: }" ;;
            *model_reasoning_effort:*)  codex_reasoning="${line#*: }" ;;
            *)                          in_codex=false ;;
          esac
          $in_codex && continue
        fi

        # Top-level fields
        case "$line" in
          name:*)        name="${line#*: }" ;;
          description:*) description="${line#*: }" ;;
          read_only:*)   read_only="${line#*: }" ;;
          skills:*)      skills="${line#*: }" ;;
        esac
      fi
    else
      # Accumulate body (skip leading blank lines)
      if [ -z "$body" ] && [ -z "$line" ]; then
        continue
      fi
      body+="$line"$'\n'
    fi
  done < "$file"

  [ -z "$name" ] && continue

  # --- Generate Claude Code agent ---
  {
    echo "---"
    echo "name: $name"
    echo "description: $description"
    if [ -n "$claude_tools" ]; then
      echo "tools: $claude_tools"
    elif [ "$read_only" = "true" ]; then
      echo "tools: Read, Grep, Glob, Bash"
    fi
    [ -n "$claude_model" ]  && echo "model: $claude_model"
    [ -n "$claude_memory" ] && echo "memory: $claude_memory"
    # claude.skills overrides top-level skills
    _skills="${claude_skills:-$skills}"
    [ -n "$_skills" ] && echo "skills: $_skills"
    echo "---"
    echo ""
    printf '%s' "$body"
  } > "$CLAUDE_DIR/$name.md"
  echo "  .claude/agents/$name.md"

  # --- Generate Codex agent TOML ---
  {
    codex_sandbox=""
    [ "$read_only" = "true" ] && codex_sandbox="read-only"

    [ -n "$codex_model" ]     && echo "model = \"$codex_model\""
    [ -n "$codex_reasoning" ] && echo "model_reasoning_effort = \"$codex_reasoning\""
    [ -n "$codex_sandbox" ]   && echo "sandbox_mode = \"$codex_sandbox\""
    # Write body as developer_instructions (escape quotes, collapse to single line)
    instructions="$(printf '%s' "$body" | sed 's/"/\\"/g' | tr '\n' ' ' | sed 's/  */ /g; s/ *$//')"
    echo "developer_instructions = \"$instructions\""
  } > "$CODEX_AGENTS_DIR/$name.toml"

  # Append agent section to codex config
  cat >> "$CODEX_DIR/config.toml" <<TOML

[agents.$name]
description = "$description"
config_file = ".codex/agents/$name.toml"
TOML
  echo "  .codex/agents/$name.toml"

done

echo ""
echo "Codex config:"
echo "  .codex/config.toml"
echo "Tip: editing WORKFLOW.md usually does not require re-running sync.sh unless agent options/frontmatter changed."
echo ""
echo "Done."
