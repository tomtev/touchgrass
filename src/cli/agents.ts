import { createInterface, type Interface } from "readline/promises";
import { access, mkdir, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { type TgConfig } from "../config/schema";
import { loadConfig, saveConfig } from "../config/store";
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
  kind: string;
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

async function installFromTemplate(config: TgConfig, spec: InstallFromTemplateSpec): Promise<string> {
  if (config.agents?.[spec.agentId]) {
    const current = config.agents[spec.agentId];
    throw new Error(`${spec.agentId} is already installed at ${current.directory}`);
  }

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

  if (!config.agents) config.agents = {};
  config.agents[spec.agentId] = {
    kind: spec.kind,
    displayName: spec.profile.agentName,
    description: spec.profile.description,
    ownerName: spec.profile.ownerName,
    location: spec.profile.location,
    timezone: spec.profile.timezone,
    directory: installDir,
    installedAt: new Date().toISOString(),
  };
  await saveConfig(config);

  return installDir;
}

export async function installBeekeeper(config: TgConfig, profile: AgentInstallProfile): Promise<string> {
  return installFromTemplate(config, {
    agentId: BEEKEEPER_ID,
    kind: BEEKEEPER_ID,
    template: embeddedTemplates.beekeeper,
    profile,
    renderAgentsMd: (template) => renderBeekeeperAgentsMd(template, profile),
  });
}

async function createAgent(config: TgConfig, agentId: string, profile: AgentInstallProfile): Promise<string> {
  return installFromTemplate(config, {
    agentId,
    kind: "custom",
    template: embeddedTemplates.newAgent,
    profile,
    renderAgentsMd: (template) => renderGenericAgentMd(template, profile, agentId),
  });
}

function printAgents(config: TgConfig): void {
  const agents = config.agents || {};
  const entries = Object.entries(agents);
  if (entries.length === 0) {
    console.log("No agents installed.");
    return;
  }

  console.log("Installed agents:");
  for (const [id, agent] of entries) {
    console.log(`  - ${id}: ${agent.displayName} (${agent.directory})`);
  }
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

async function promptInstallIfEmpty(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("The Beekeeper scaffolds AGENTS.md, CLAUDE.md, HEARTBEAT.md, workflows/, and core skills.");
    const answer = (await rl.question(
      "No agents installed. Install now or later? [later/install] (default: later) "
    )).trim().toLowerCase();
    if (answer === "" || answer === "later" || answer === "l" || answer === "n" || answer === "no") {
      return false;
    }
    if (answer === "install" || answer === "i" || answer === "y" || answer === "yes") {
      return true;
    }
    console.log("Unrecognized option. Keeping later.");
    return false;
  } finally {
    rl.close();
  }
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  tg agents                           # list agents, or prompt install when none exist");
  console.log("  tg agents add beekeeper             # install Beekeeper template");
  console.log("  tg agents create <agent-id>         # create a new agent from shared template");
  console.log("  tg agents create <agent-id> --dir <path>");
  console.log("  tg agents create <agent-id> --yes");
  console.log("  tg agents ls");
}

export async function runAgents(): Promise<void> {
  const args = process.argv.slice(3);
  const config = await loadConfig();

  if (args.length === 0) {
    const agentCount = Object.keys(config.agents || {}).length;
    if (agentCount === 0) {
      if (!process.stdin.isTTY) {
        console.log("No agents installed.");
        console.log("Run: tg agents add beekeeper --yes");
        return;
      }
      const shouldInstall = await promptInstallIfEmpty();
      if (!shouldInstall) {
        console.log("No changes made.");
        return;
      }
      const profile = await promptForProfile(
        createDefaultBeekeeperInstallProfile(process.cwd()),
        true
      );
      const installDir = await installBeekeeper(config, profile);
      console.log(`✅ Installed ${profile.agentName} in ${installDir}`);
      return;
    }

    printAgents(config);
    return;
  }

  if (args[0] === "ls") {
    printAgents(config);
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
    const installDir = await installBeekeeper(config, profile);
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
    const installDir = await createAgent(config, agentId, profile);
    console.log(`✅ Created agent '${agentId}' (${profile.agentName}) in ${installDir}`);
    return;
  }

  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    return;
  }

  printUsage();
  process.exit(1);
}
