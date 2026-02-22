import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  scope: "project" | "personal";
}

/**
 * Parse YAML frontmatter (between --- markers) from a SKILL.md file.
 * Extracts `name` and `description` fields.
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: { name?: string; description?: string } = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)/);
    if (!kv) continue;
    const [, key, val] = kv;
    const cleaned = val.trim().replace(/^["']|["']$/g, "");
    if (key === "name") result.name = cleaned;
    else if (key === "description") result.description = cleaned;
  }
  return result;
}

async function scanSkillDir(dir: string, scope: "project" | "personal"): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(dir, entry.name, "SKILL.md");
      try {
        const content = await readFile(skillPath, "utf-8");
        const meta = parseFrontmatter(content);
        skills.push({
          id: `${scope}:${entry.name}`,
          name: meta.name || entry.name,
          description: meta.description || "",
          scope,
        });
      } catch {
        // SKILL.md doesn't exist or can't be read — skip
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }
  return skills;
}

/**
 * Discover SKILL.md files from:
 * 1. <cwd>/.agents/skills/
 * 2. <cwd>/.claude/skills/
 * 3. ~/.claude/skills/ (personal/global)
 */
export async function listSkills(cwd: string): Promise<SkillInfo[]> {
  const results = await Promise.all([
    scanSkillDir(join(cwd, ".agents", "skills"), "project"),
    scanSkillDir(join(cwd, ".claude", "skills"), "project"),
    scanSkillDir(join(homedir(), ".claude", "skills"), "personal"),
  ]);
  // Deduplicate by id (project skills take precedence)
  const seen = new Set<string>();
  const skills: SkillInfo[] = [];
  for (const list of results) {
    for (const skill of list) {
      if (!seen.has(skill.id)) {
        seen.add(skill.id);
        skills.push(skill);
      }
    }
  }
  return skills;
}
