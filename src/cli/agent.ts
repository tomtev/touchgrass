import { join, resolve } from "path";
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";

const REPO = "tomtev/touchgrass";
const BRANCH = "main";
const TEMPLATE_DIR = "agent-template";
const TARBALL_URL = `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz`;

export async function runAgent(): Promise<void> {
  const sub = process.argv[3];

  switch (sub) {
    case "create": {
      // Parse args: tg agent create [folder] --name "My Agent"
      const args = process.argv.slice(4);
      let targetDir: string | null = null;
      let agentName: string | null = null;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--name" && i + 1 < args.length) {
          agentName = args[++i];
        } else if (!args[i].startsWith("--") && !targetDir) {
          targetDir = args[i];
        }
      }

      const dest = targetDir ? resolve(targetDir) : process.cwd();
      if (targetDir) {
        await Bun.spawn(["mkdir", "-p", dest]).exited;
      }

      await createAgent(dest, agentName);
      break;
    }
    case "update": {
      await updateAgent(process.cwd());
      break;
    }
    default: {
      console.log(`Usage: tg agent <command>

Commands:
  create [folder] --name "My Agent"   Scaffold a new agent
  update                               Update agent-core and skills to latest`);
      if (sub) process.exit(1);
      break;
    }
  }
}

// --- Shared helpers ---

async function downloadTemplate(): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), "tg-agent-"));

  const res = await fetch(TARBALL_URL, {
    headers: { "User-Agent": "touchgrass-cli" },
  });
  if (!res.ok) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to download template (HTTP ${res.status}). Check your network connection.`);
  }

  const tarPath = join(tmpDir, "repo.tar.gz");
  await Bun.write(tarPath, await res.arrayBuffer());

  const archivePrefix = `touchgrass-${BRANCH}/${TEMPLATE_DIR}/`;
  const extractDir = join(tmpDir, "out");
  await Bun.spawn(["mkdir", "-p", extractDir]).exited;

  const proc = Bun.spawn(["tar", "xzf", tarPath, "--strip-components=2", "-C", extractDir, archivePrefix], {
    stderr: "pipe",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to extract template: ${stderr.trim()}`);
  }

  const extracted = await readdir(extractDir);
  if (extracted.length === 0) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error("Template appears to be empty.");
  }

  await removeDsStore(extractDir);
  return tmpDir;
}

async function removeDsStore(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.name === ".DS_Store") {
      await unlink(full).catch(() => {});
    } else if (entry.isDirectory()) {
      await removeDsStore(full);
    }
  }
}

/** Extract a tagged block like <tag version="1.0">...</tag> including the tags themselves. */
function extractBlock(content: string, tag: string): { full: string; version: string | null } | null {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "m");
  const match = content.match(re);
  if (!match) return null;
  const versionMatch = match[1]?.match(/version="([^"]+)"/);
  return { full: match[0], version: versionMatch?.[1] ?? null };
}

// --- create ---

async function createAgent(dest: string, agentName: string | null): Promise<void> {
  console.log("Downloading agent template...");
  const tmpDir = await downloadTemplate();
  const extractDir = join(tmpDir, "out");

  try {
    // Replace agent name in AGENTS.md if --name was provided
    if (agentName) {
      const agentsPath = join(extractDir, "AGENTS.md");
      try {
        const content = await readFile(agentsPath, "utf-8");
        const updated = content.replace(
          /(<agent-soul>\s*\nName:\s*).+/,
          `$1${agentName}`
        );
        await writeFile(agentsPath, updated);
      } catch {
        // AGENTS.md missing or unreadable — skip name replacement
      }
    }

    // Copy to destination preserving symlinks
    const rsync = Bun.spawn(["rsync", "-a", `${extractDir}/`, `${dest}/`], {
      stderr: "pipe",
    });
    const rsyncExit = await rsync.exited;
    if (rsyncExit !== 0) {
      const rsyncErr = await new Response(rsync.stderr).text();
      throw new Error(`Failed to copy template files: ${rsyncErr.trim()}`);
    }

    const label = agentName ? `"${agentName}"` : "Agent";
    console.log(`${label} created in ${dest}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// --- update ---

async function updateAgent(dir: string): Promise<void> {
  // Read local AGENTS.md
  const localPath = join(dir, "AGENTS.md");
  let localContent: string;
  try {
    localContent = await readFile(localPath, "utf-8");
  } catch {
    throw new Error("No AGENTS.md found in current directory. Are you in an agent folder?");
  }

  const local = extractBlock(localContent, "agent-core");
  if (!local) {
    throw new Error("No <agent-core> block found in AGENTS.md.");
  }

  console.log("Checking for updates...");
  const tmpDir = await downloadTemplate();
  const extractDir = join(tmpDir, "out");

  try {
    const remotePath = join(extractDir, "AGENTS.md");
    const remoteContent = await readFile(remotePath, "utf-8");

    const remote = extractBlock(remoteContent, "agent-core");
    if (!remote) {
      throw new Error("No <agent-core> block found in upstream template.");
    }

    if (local.full === remote.full) {
      console.log(`Already up to date (${local.version || "unknown"}).`);
      return;
    }

    const updated = localContent.replace(local.full, remote.full);
    await writeFile(localPath, updated);

    const from = local.version || "unknown";
    const to = remote.version || "unknown";
    console.log(`Updated agent-core: ${from} → ${to}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
