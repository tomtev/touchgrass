import { createInterface, type Interface } from "readline/promises";
import { access, mkdir, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { embeddedTemplates, type EmbeddedTemplate } from "./embedded-templates";

const BEEKEEPER_ID = "beekeeper";
const BEEKEEPER_NAME = "The Beekeeper 🐝";
const DEFAULT_BEEKEEPER_DESCRIPTION = "Smart keeper of your touchgrass sessions.";
const DEFAULT_AGENT_DESCRIPTION = "Operational agent for touchgrass tasks.";
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

export interface AgentInstallProfile {
  targetDir: string;
  agentName: string;
  description: string;
  ownerName: string;
  location: string;
  timezone: string;
}

interface InstallFromTemplateSpec {
  agentId: string;
  template: EmbeddedTemplate;
  profile: AgentInstallProfile;
  renderAgentsMd: (templateContent: string) => string;
}

function defaultOwnerName(): string {
  return process.env.USER || process.env.USERNAME || "Owner";
}

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function toTitleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function createDefaultBeekeeperInstallProfile(targetDir = process.cwd()): AgentInstallProfile {
  return {
    targetDir,
    agentName: BEEKEEPER_NAME,
    description: DEFAULT_BEEKEEPER_DESCRIPTION,
    ownerName: defaultOwnerName(),
    location: "",
    timezone: defaultTimezone(),
  };
}

function createDefaultAgentInstallProfile(agentId: string): AgentInstallProfile {
  return {
    targetDir: join(process.cwd(), "agents", agentId),
    agentName: toTitleCaseFromSlug(agentId) || agentId,
    description: DEFAULT_AGENT_DESCRIPTION,
    ownerName: defaultOwnerName(),
    location: "",
    timezone: defaultTimezone(),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function escapeQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function renderTemplateVariables(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    if (key in variables) return variables[key];
    return `{{${key}}}`;
  });
}

function renderBeekeeperAgentsMd(template: string, profile: AgentInstallProfile): string {
  const rendered = renderTemplateVariables(template, {
    OWNER_NAME: escapeQuoted(profile.ownerName),
    OWNER_LOCATION: escapeQuoted(profile.location),
    OWNER_TIMEZONE: escapeQuoted(profile.timezone),
    AGENT_NAME: escapeQuoted(profile.agentName),
    AGENT_DESCRIPTION: escapeQuoted(profile.description),
  });

  const updatedContextLine = rendered.replace(
    /^.* is a living assistant for `touchgrass` users\.$/m,
    `${profile.agentName} is a living assistant for \`touchgrass\` users.`
  );

  return ensureTrailingNewline(updatedContextLine);
}

function renderGenericAgentMd(template: string, profile: AgentInstallProfile, agentId: string): string {
  const rendered = renderTemplateVariables(template, {
    OWNER_NAME: escapeQuoted(profile.ownerName),
    OWNER_LOCATION: escapeQuoted(profile.location),
    OWNER_TIMEZONE: escapeQuoted(profile.timezone),
    AGENT_NAME: escapeQuoted(profile.agentName),
    AGENT_DESCRIPTION: escapeQuoted(profile.description),
    AGENT_ID: escapeQuoted(agentId),
  });
  return ensureTrailingNewline(rendered);
}

async function installFromTemplate(spec: InstallFromTemplateSpec): Promise<string> {
  const installDir = resolve(spec.profile.targetDir);
  await mkdir(installDir, { recursive: true });

  const fileEntries = Object.entries(spec.template.files);
  if (fileEntries.length === 0) {
    throw new Error(`Template for ${spec.agentId} has no files`);
  }
  if (!spec.template.files["AGENTS.md"]) {
    throw new Error(`Template for ${spec.agentId} is missing AGENTS.md`);
  }

  // Preflight collision check so install is all-or-nothing.
  for (const [relativePath] of fileEntries) {
    const targetPath = join(installDir, relativePath);
    if (await pathExists(targetPath)) {
      throw new Error(`Refusing to overwrite existing file: ${targetPath}`);
    }
  }

  for (const [relativePath, rawContent] of fileEntries) {
    const targetPath = join(installDir, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    const content = relativePath === "AGENTS.md"
      ? spec.renderAgentsMd(rawContent)
      : ensureTrailingNewline(rawContent);
    await writeFile(targetPath, content, "utf-8");
  }

  return installDir;
}

export async function installBeekeeper(profile: AgentInstallProfile): Promise<string> {
  return installFromTemplate({
    agentId: BEEKEEPER_ID,
    template: embeddedTemplates.beekeeper,
    profile,
    renderAgentsMd: (template) => renderBeekeeperAgentsMd(template, profile),
  });
}

async function createAgent(agentId: string, profile: AgentInstallProfile): Promise<string> {
  return installFromTemplate({
    agentId,
    template: embeddedTemplates.newAgent,
    profile,
    renderAgentsMd: (template) => renderGenericAgentMd(template, profile, agentId),
  });
}

async function questionWithDefault(rl: Interface, label: string, fallback: string): Promise<string> {
  const prompt = fallback ? `${label} [${fallback}]: ` : `${label}: `;
  const answer = (await rl.question(prompt)).trim();
  return answer || fallback;
}

async function promptForProfile(
  initial: AgentInstallProfile,
  askForDirectory: boolean
): Promise<AgentInstallProfile> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const targetDir = askForDirectory
      ? await questionWithDefault(rl, "Install directory", initial.targetDir)
      : initial.targetDir;
    const agentName = await questionWithDefault(rl, "Agent name", initial.agentName);
    const description = await questionWithDefault(rl, "Agent description", initial.description);
    const ownerName = await questionWithDefault(rl, "Owner name", initial.ownerName);
    const location = await questionWithDefault(rl, "Location", initial.location);
    const timezone = await questionWithDefault(rl, "Timezone", initial.timezone);

    return { targetDir, agentName, description, ownerName, location, timezone };
  } finally {
    rl.close();
  }
}

interface ProfileOptions {
  profile: AgentInstallProfile;
  assumeYes: boolean;
  explicitDir: boolean;
}

function parseProfileOptions(args: string[], defaults: AgentInstallProfile): ProfileOptions {
  const profile = { ...defaults };
  let assumeYes = false;
  let explicitDir = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case "--dir":
        if (!value) throw new Error("Missing value for --dir");
        profile.targetDir = value;
        explicitDir = true;
        i++;
        break;
      case "--name":
        if (!value) throw new Error("Missing value for --name");
        profile.agentName = value;
        i++;
        break;
      case "--description":
        if (!value) throw new Error("Missing value for --description");
        profile.description = value;
        i++;
        break;
      case "--owner-name":
        if (!value) throw new Error("Missing value for --owner-name");
        profile.ownerName = value;
        i++;
        break;
      case "--location":
        if (!value) throw new Error("Missing value for --location");
        profile.location = value;
        i++;
        break;
      case "--timezone":
        if (!value) throw new Error("Missing value for --timezone");
        profile.timezone = value;
        i++;
        break;
      case "--yes":
        assumeYes = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { profile, assumeYes, explicitDir };
}

function printTemplatesAndUsage(): void {
  console.log("Agent templates:");
  console.log(`  - ${BEEKEEPER_ID}: ${BEEKEEPER_NAME}`);
  console.log("      Full operational template with AGENTS.md, CLAUDE.md, HEARTBEAT.md, workflows/, and core skills.");
  console.log("  - custom (<agent-id>)");
  console.log("      General-purpose template for creating a new agent package.");
  console.log("");
  console.log("Create commands:");
  console.log("  tg agents add beekeeper");
  console.log("  tg agents create <agent-id>");
  console.log("");
  console.log("Options:");
  console.log("  --dir <path>          Target directory");
  console.log("  --name <name>         Agent display name");
  console.log("  --description <text>  Agent description");
  console.log("  --owner-name <name>   Owner name for AGENTS.md");
  console.log("  --location <text>     Owner location for AGENTS.md");
  console.log("  --timezone <tz>       Owner timezone for AGENTS.md");
  console.log("  --yes                 Skip prompts and use provided/default values");
}

export async function runAgents(): Promise<void> {
  const args = process.argv.slice(3);

  if (args.length === 0) {
    printTemplatesAndUsage();
    return;
  }

  if (args[0] === "ls") {
    printTemplatesAndUsage();
    return;
  }

  if (args[0] === "add") {
    const agentId = args[1];
    if (agentId !== BEEKEEPER_ID) {
      console.error(`Unknown agent: ${agentId || "(missing)"}`);
      console.error("For custom agents use: tg agents create <agent-id>");
      process.exit(1);
    }

    let parsed: ProfileOptions;
    try {
      parsed = parseProfileOptions(
        args.slice(2),
        createDefaultBeekeeperInstallProfile(process.cwd())
      );
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
      return;
    }

    const profile = (parsed.assumeYes || !process.stdin.isTTY)
      ? parsed.profile
      : await promptForProfile(parsed.profile, !parsed.explicitDir);
    const installDir = await installBeekeeper(profile);
    console.log(`✅ Installed ${profile.agentName} in ${installDir}`);
    return;
  }

  if (args[0] === "create") {
    const agentId = (args[1] || "").trim();
    if (!agentId) {
      console.error("Usage: tg agents create <agent-id> [options]");
      process.exit(1);
    }
    if (agentId === BEEKEEPER_ID) {
      console.error("Use 'tg agents add beekeeper' to install Beekeeper.");
      process.exit(1);
    }
    if (!AGENT_ID_PATTERN.test(agentId)) {
      console.error(`Invalid agent id: ${agentId}`);
      console.error("Agent ids must match: [a-z0-9][a-z0-9-_]*");
      process.exit(1);
    }

    let parsed: ProfileOptions;
    try {
      parsed = parseProfileOptions(
        args.slice(2),
        createDefaultAgentInstallProfile(agentId)
      );
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
      return;
    }

    const profile = (parsed.assumeYes || !process.stdin.isTTY)
      ? parsed.profile
      : await promptForProfile(parsed.profile, !parsed.explicitDir);
    const installDir = await createAgent(agentId, profile);
    console.log(`✅ Created agent '${agentId}' (${profile.agentName}) in ${installDir}`);
    return;
  }

  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printTemplatesAndUsage();
    return;
  }

  printTemplatesAndUsage();
  process.exit(1);
}
