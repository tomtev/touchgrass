import { createInterface, type Interface } from "readline/promises";
import { access, cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { tmpdir } from "os";
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

interface AddSourceOptions {
  targetDir?: string;
  explicitDir: boolean;
  branch?: string;
  assumeYes: boolean;
}

interface ParsedAgentSource {
  type: "local-path" | "git-repo" | "git-repo-subpath";
  displaySource: string;
  targetDirName: string;
  localPath?: string;
  cloneUrl?: string;
  branch?: string;
  subpath?: string;
}

interface GitRunResult {
  stdout: string;
  stderr: string;
}

interface SourceInstallResult {
  installDir: string;
  updated: boolean;
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

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}

function sanitizeDirName(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]/g, "-");
  return cleaned || fallback;
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

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function hasUrlScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

function isGitSshSource(value: string): boolean {
  return /^git@[^:]+:.+/.test(value);
}

function isGithubShorthand(value: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value);
}

function isExplicitLocalPath(value: string): boolean {
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    value.startsWith("~/") ||
    /^[a-zA-Z]:[\\/]/.test(value)
  );
}

function resolveLocalPath(value: string): string {
  if (value.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
      return resolve(home, value.slice(2));
    }
  }
  return resolve(value);
}

function extractRepoNameFromGitSource(source: string): string {
  if (isGithubShorthand(source)) {
    const repo = source.split("/")[1] || "";
    return sanitizeDirName(stripGitSuffix(repo), "agent");
  }

  if (isGitSshSource(source)) {
    const sshMatch = source.match(/^git@[^:]+:(.+)$/);
    if (sshMatch) {
      const pathParts = sshMatch[1].split("/").filter(Boolean);
      return sanitizeDirName(stripGitSuffix(pathParts[pathParts.length - 1] || ""), "agent");
    }
  }

  if (hasUrlScheme(source)) {
    try {
      const parsed = new URL(source);
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] || "";
      return sanitizeDirName(stripGitSuffix(lastPart), "agent");
    } catch {
      // Fall through to generic parsing below.
    }
  }

  const genericParts = source.split("/").filter(Boolean);
  const fallbackRepo = genericParts[genericParts.length - 1] || source;
  return sanitizeDirName(stripGitSuffix(fallbackRepo), "agent");
}

function parseGithubTreeSource(source: string): ParsedAgentSource | null {
  const match = source.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/i);
  if (!match) return null;

  const owner = decodeURIComponent(match[1]);
  const repo = stripGitSuffix(decodeURIComponent(match[2]));
  const branch = decodeURIComponent(match[3]);
  const subpath = decodeURIComponent(match[4]).replace(/^\/+|\/+$/g, "");
  const subpathName = basename(subpath);

  if (!owner || !repo || !branch || !subpath) {
    return null;
  }

  return {
    type: "git-repo-subpath",
    displaySource: source,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    branch,
    subpath,
    targetDirName: sanitizeDirName(subpathName || repo, "agent"),
  };
}

function parseAgentSource(source: string): ParsedAgentSource | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  if (isExplicitLocalPath(trimmed)) {
    const localPath = resolveLocalPath(trimmed);
    return {
      type: "local-path",
      displaySource: trimmed,
      localPath,
      targetDirName: sanitizeDirName(basename(localPath), "agent"),
    };
  }

  const githubTree = parseGithubTreeSource(trimmed);
  if (githubTree) return githubTree;

  if (isGithubShorthand(trimmed)) {
    const repoName = extractRepoNameFromGitSource(trimmed);
    return {
      type: "git-repo",
      displaySource: trimmed,
      cloneUrl: `https://github.com/${trimmed}.git`,
      targetDirName: repoName,
    };
  }

  if (isGitSshSource(trimmed) || hasUrlScheme(trimmed)) {
    return {
      type: "git-repo",
      displaySource: trimmed,
      cloneUrl: trimmed,
      targetDirName: extractRepoNameFromGitSource(trimmed),
    };
  }

  return null;
}

function normalizeRemoteForComparison(value: string): string {
  if (isGithubShorthand(value)) {
    return `github.com/${stripGitSuffix(value)}`.toLowerCase().replace(/\/+$/g, "");
  }

  if (isGitSshSource(value)) {
    const match = value.match(/^git@([^:]+):(.+)$/);
    if (match) {
      return `${match[1]}/${stripGitSuffix(match[2])}`.toLowerCase().replace(/\/+$/g, "");
    }
  }

  if (hasUrlScheme(value)) {
    try {
      const parsed = new URL(value);
      return `${parsed.host}/${stripGitSuffix(parsed.pathname.replace(/^\/+/, ""))}`
        .toLowerCase()
        .replace(/\/+$/g, "");
    } catch {
      return stripGitSuffix(value).toLowerCase().replace(/\/+$/g, "");
    }
  }

  return stripGitSuffix(value).toLowerCase().replace(/\/+$/g, "");
}

function runGit(args: string[], cwd?: string): GitRunResult {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    throw new Error(`Failed to run git: ${(err as Error).message}`);
  }

  const stdout = Buffer.from(result.stdout || "").toString("utf-8").trim();
  const stderr = Buffer.from(result.stderr || "").toString("utf-8").trim();
  if (result.exitCode !== 0) {
    const details = stderr || stdout || `exit code ${result.exitCode}`;
    throw new Error(`git ${args.join(" ")} failed: ${details}`);
  }

  return { stdout, stderr };
}

async function requireDirectory(path: string, label: string): Promise<void> {
  if (!await pathExists(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!await isDirectory(path)) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

async function installFromLocalPath(
  sourcePath: string,
  targetDir: string
): Promise<SourceInstallResult> {
  const sourceDir = resolve(sourcePath);
  await requireDirectory(sourceDir, "Local source path");

  if (sourceDir === targetDir) {
    throw new Error(`Source and destination are the same: ${sourceDir}`);
  }

  if (await pathExists(targetDir)) {
    throw new Error(`Refusing to overwrite existing path: ${targetDir}`);
  }

  await mkdir(dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: false, errorOnExist: true });
  return { installDir: targetDir, updated: false };
}

async function installFromGitRepo(
  cloneUrl: string,
  targetDir: string,
  branch?: string
): Promise<SourceInstallResult> {
  const targetExists = await pathExists(targetDir);
  if (targetExists) {
    const targetStats = await stat(targetDir);
    if (!targetStats.isDirectory()) {
      throw new Error(`Target path exists and is not a directory: ${targetDir}`);
    }

    if (await isDirectory(join(targetDir, ".git"))) {
      const { stdout: originUrl } = runGit(["-C", targetDir, "remote", "get-url", "origin"]);
      const expectedRemote = normalizeRemoteForComparison(cloneUrl);
      const currentRemote = normalizeRemoteForComparison(originUrl);

      if (expectedRemote && currentRemote && expectedRemote !== currentRemote) {
        throw new Error(
          `Target directory is a different git repo (${originUrl}). Use --dir to choose another path.`
        );
      }

      const pullArgs = ["-C", targetDir, "pull", "--ff-only"];
      if (branch) pullArgs.push("origin", branch);
      runGit(pullArgs);
      return { installDir: targetDir, updated: true };
    }

    const existingEntries = await readdir(targetDir);
    if (existingEntries.length > 0) {
      throw new Error(`Refusing to clone into non-empty directory: ${targetDir}`);
    }
  } else {
    await mkdir(dirname(targetDir), { recursive: true });
  }

  const cloneArgs = ["clone"];
  if (branch) {
    cloneArgs.push("--branch", branch, "--single-branch");
  }
  cloneArgs.push(cloneUrl, targetDir);
  runGit(cloneArgs);
  return { installDir: targetDir, updated: false };
}

async function installFromGitSubpath(
  cloneUrl: string,
  subpath: string,
  targetDir: string,
  branch?: string
): Promise<SourceInstallResult> {
  if (await pathExists(targetDir)) {
    throw new Error(`Refusing to overwrite existing path: ${targetDir}`);
  }

  const tmpRoot = await mkdtemp(join(tmpdir(), "touchgrass-agent-"));
  const repoDir = join(tmpRoot, "repo");

  try {
    const cloneArgs = ["clone"];
    if (branch) {
      cloneArgs.push("--branch", branch, "--single-branch");
    }
    cloneArgs.push(cloneUrl, repoDir);
    runGit(cloneArgs);

    const sourcePath = join(repoDir, subpath);
    await requireDirectory(sourcePath, "Git source subpath");

    await mkdir(dirname(targetDir), { recursive: true });
    await cp(sourcePath, targetDir, { recursive: true, force: false, errorOnExist: true });
    return { installDir: targetDir, updated: false };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function installFromSource(
  source: ParsedAgentSource,
  options: AddSourceOptions
): Promise<SourceInstallResult> {
  const targetDir = resolve(options.targetDir || source.targetDirName);

  if (source.type === "local-path") {
    return installFromLocalPath(source.localPath || "", targetDir);
  }

  const cloneUrl = source.cloneUrl || "";
  const branch = options.branch || source.branch;

  if (source.type === "git-repo-subpath") {
    return installFromGitSubpath(cloneUrl, source.subpath || "", targetDir, branch);
  }

  return installFromGitRepo(cloneUrl, targetDir, branch);
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

function parseAddSourceOptions(args: string[]): AddSourceOptions {
  let targetDir: string | undefined;
  let explicitDir = false;
  let branch: string | undefined;
  let assumeYes = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case "--dir":
        if (!value) throw new Error("Missing value for --dir");
        targetDir = value;
        explicitDir = true;
        i++;
        break;
      case "--branch":
        if (!value) throw new Error("Missing value for --branch");
        branch = value;
        i++;
        break;
      case "--yes":
        assumeYes = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { targetDir, explicitDir, branch, assumeYes };
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
  console.log("Install commands:");
  console.log("  tg agents add beekeeper");
  console.log("  tg agents add vercel-labs/agent-skills");
  console.log("  tg agents add https://github.com/vercel-labs/agent-skills");
  console.log("  tg agents add https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines");
  console.log("  tg agents add git@github.com:vercel-labs/agent-skills.git");
  console.log("  tg agents add ./my-local-agents");
  console.log("");
  console.log("Create command:");
  console.log("  tg agents create <agent-id>");
  console.log("");
  console.log("Options:");
  console.log("  --dir <path>          Target directory");
  console.log("  --branch <name>       Git branch for tg agents add <source>");
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
    const sourceArg = (args[1] || "").trim();
    if (!sourceArg) {
      console.error("Usage: tg agents add <beekeeper|git-url|owner/repo|local-path> [options]");
      process.exit(1);
      return;
    }

    if (sourceArg === BEEKEEPER_ID) {
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

    const source = parseAgentSource(sourceArg);
    if (!source) {
      console.error(`Unknown agent source: ${sourceArg}`);
      console.error("Use 'tg agents add beekeeper' for template install, or pass a git/local source.");
      process.exit(1);
      return;
    }

    let addSourceOptions: AddSourceOptions;
    try {
      addSourceOptions = parseAddSourceOptions(args.slice(2));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
      return;
    }

    try {
      // Validate git availability early with a fast command.
      if (source.type !== "local-path") {
        runGit(["--version"]);
      }

      const result = await installFromSource(source, addSourceOptions);
      if (result.updated) {
        console.log(`✅ Updated agent source ${source.displaySource} in ${result.installDir}`);
      } else {
        console.log(`✅ Installed agent source ${source.displaySource} in ${result.installDir}`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
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

export const __cliAgentsTestUtils = {
  parseAgentSource,
  parseAddSourceOptions,
  normalizeRemoteForComparison,
};
