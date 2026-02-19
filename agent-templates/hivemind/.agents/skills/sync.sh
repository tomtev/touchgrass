#!/usr/bin/env bash
# Sync skills: create symlinks in all IDE skills dirs for each skill in .agents/skills/
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$(dirname "$DIR")")"

# Find all .*/skills/ directories (excluding .agents/skills/ itself)
for ide_skills in "$ROOT"/.*/skills/; do
  [ -d "$ide_skills" ] || continue
  ide_name="$(basename "$(dirname "$ide_skills")")"
  [ "$ide_name" = ".agents" ] && continue

  for skill_dir in "$DIR"/*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    target="../../.agents/skills/$name"
    link="$ide_skills$name"
    if [ -L "$link" ]; then
      rm "$link"
    fi
    ln -s "$target" "$link"
  done
  echo "  $ide_name: synced"
done

echo ""
echo "Done."
