import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { dirname, join, relative, resolve } from "path";

interface TemplateTarget {
  key: string;
  folder: string;
}

const TEMPLATE_TARGETS: TemplateTarget[] = [
  { key: "beekeeper", folder: "beekeeper" },
  { key: "newAgent", folder: "new-agent" },
];

async function collectFiles(root: string, current: string, out: Record<string, string>): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const abs = join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = relative(root, abs).replaceAll("\\", "/");
    out[rel] = await readFile(abs, "utf-8");
  }
}

async function buildTemplatesObject(repoRoot: string): Promise<Record<string, { files: Record<string, string> }>> {
  const templatesRoot = join(repoRoot, "agent-templates");
  const result: Record<string, { files: Record<string, string> }> = {};

  for (const target of TEMPLATE_TARGETS) {
    const dir = join(templatesRoot, target.folder);
    const files: Record<string, string> = {};
    await collectFiles(dir, dir, files);
    result[target.key] = { files };
  }

  return result;
}

function renderModuleCode(templates: Record<string, { files: Record<string, string> }>): string {
  const body = JSON.stringify(templates, null, 2);
  return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: scripts/generate-embedded-templates.ts

export interface EmbeddedTemplate {
  files: Record<string, string>;
}

export const embeddedTemplates = ${body} as const satisfies Record<string, EmbeddedTemplate>;
`;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, "..");
  const templates = await buildTemplatesObject(repoRoot);
  const outputPath = join(repoRoot, "src", "generated", "embedded-templates.ts");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderModuleCode(templates), "utf-8");
  console.log(`Generated ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
