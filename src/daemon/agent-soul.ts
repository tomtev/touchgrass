import { readFile, writeFile } from "fs/promises";
import { join } from "path";

export interface AgentSoul {
  name: string;
  purpose: string;
  owner: string;
  dna?: string;
}

function extractTagContent(content: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "m");
  const match = content.match(re);
  if (!match) return null;
  return match[0];
}

function parseField(block: string, field: string): string {
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const match = block.match(re);
  return match?.[1]?.trim() ?? "";
}

export async function readAgentSoul(cwd: string): Promise<AgentSoul | null> {
  const filePath = join(cwd, "AGENTS.md");
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const soulBlock = extractTagContent(content, "agent-soul");
  if (!soulBlock) return null;

  const ownerBlock = extractTagContent(content, "agent-owner");

  const dna = parseField(soulBlock, "DNA") || undefined;

  return {
    name: parseField(soulBlock, "Name"),
    purpose: parseField(soulBlock, "Purpose"),
    owner: ownerBlock ? parseField(ownerBlock, "Name") : "",
    dna,
  };
}

export async function writeAgentSoul(cwd: string, soul: AgentSoul): Promise<void> {
  const filePath = join(cwd, "AGENTS.md");
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    throw new Error("AGENTS.md not found");
  }

  const dnaLine = soul.dna ? `\nDNA: ${soul.dna}` : "";
  const newSoulBlock = `<agent-soul>\nName: ${soul.name}\nPurpose: ${soul.purpose}${dnaLine}\n</agent-soul>`;
  const newOwnerBlock = `<agent-owner>\nName: ${soul.owner}\n</agent-owner>`;

  const existingSoul = extractTagContent(content, "agent-soul");
  if (existingSoul) {
    content = content.replace(existingSoul, newSoulBlock);
  }

  const existingOwner = extractTagContent(content, "agent-owner");
  if (existingOwner) {
    content = content.replace(existingOwner, newOwnerBlock);
  }

  await writeFile(filePath, content);
}
