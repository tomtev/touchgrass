import { join, resolve } from "path";
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { generateRandomDNA, renderTerminal, renderSVG, decodeDNA, encodeDNA, traitsFromName, generateGrid, hslToRgb, LEGS } from "termlings";
import type { Pixel, DecodedDNA } from "termlings";

const REPO = "tomtev/touchgrass";
const BRANCH = "main";
const TEMPLATE_DIR = "agent-template";
const TARBALL_URL = `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz`;

import { createInterface } from "readline";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runAgent(): Promise<void> {
  const sub = process.argv[3];

  switch (sub) {
    case "create": {
      // Parse args: tg agent create [folder] --name "X" --owner "Y" --purpose "Z"
      const args = process.argv.slice(4);
      let targetDir: string | null = null;
      const vars: Record<string, string> = {};

      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--name" && i + 1 < args.length) {
          vars["AGENT_NAME"] = args[++i];
        } else if (args[i] === "--owner" && i + 1 < args.length) {
          vars["OWNER_NAME"] = args[++i];
        } else if (args[i] === "--purpose" && i + 1 < args.length) {
          vars["AGENT_PURPOSE"] = args[++i];
        } else if (!args[i].startsWith("--") && !targetDir) {
          targetDir = args[i];
        }
      }

      // Interactive prompts for missing fields
      if (!vars["AGENT_NAME"]) {
        vars["AGENT_NAME"] = await prompt("Agent name: ") || "My Agent";
      }
      if (!vars["AGENT_PURPOSE"]) {
        vars["AGENT_PURPOSE"] = await prompt("Purpose: ") || "A personal agent that helps with tasks using workflows and skills.";
      }

      const slug = vars["AGENT_NAME"].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
      const dest = targetDir ? resolve(targetDir) : resolve(slug);
      await Bun.spawn(["mkdir", "-p", dest]).exited;

      await createAgent(dest, vars);
      break;
    }
    case "update": {
      const targetDir = process.argv[4];
      await updateAgent(targetDir ? resolve(targetDir) : process.cwd());
      break;
    }
    case "avatar": {
      const targetDir = process.argv[4];
      await generateAvatarSVGs(targetDir ? resolve(targetDir) : process.cwd());
      break;
    }
    case "demo": {
      const demoInput = process.argv[4];
      const demoFlags = new Set(process.argv.slice(4).filter(a => a.startsWith("--")).map(a => a.slice(2)));
      await animateTermling(demoInput, demoFlags);
      break;
    }
    default: {
      console.log(`Usage: touchgrass agent <command>

Commands:
  create [folder]   Scaffold a new agent
  update            Update agent-core to latest
  avatar            Regenerate avatar SVGs from DNA
  demo [dna|name]   Animate a termling in the terminal

Create options:
  --name <name>              Agent name
  --owner <name>             Owner name
  --purpose <text>           Agent purpose

Demo options:
  --walk                     Walk animation
  --talk                     Talk animation
  --wave                     Wave animation
  --compact                  Half-height rendering`);
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

async function detectOwnerName(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "config", "user.name"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    const name = (await new Response(proc.stdout).text()).trim();
    if (name) return name;
  } catch {}
  return require("os").userInfo().username || "Owner";
}

async function createAgent(dest: string, vars: Record<string, string>): Promise<void> {
  const agentName = vars["AGENT_NAME"] || "My Agent";
  const ownerName = vars["OWNER_NAME"] || await detectOwnerName();

  // --- Avatar approval loop (wave while waiting) ---
  let dna = generateRandomDNA();

  while (true) {
    const traits = decodeDNA(dna);
    const fRgb = hslToRgb(traits.faceHue * 30, 0.5, 0.5);
    const dRgb = hslToRgb(traits.faceHue * 30, 0.5, 0.28);
    const hRgb = hslToRgb(traits.hatHue * 30, 0.5, 0.5);

    // Show waving animation while waiting for input
    const BOLD = "\x1b[1m";
    const DIM = "\x1b[2m";
    const RESET = "\x1b[0m";

    console.log("");
    const info = [
      `${BOLD}${agentName}${RESET}`,
      `${DIM}dna: ${dna}${RESET}`,
    ];

    // Start waving animation
    process.stdout.write("\x1b[?25l"); // hide cursor
    let waveFrame = 1;
    let tick = 0;

    const avatarWidth = 18;
    const visLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

    function renderMergedFrame(wFrame: number): { output: string; lineCount: number } {
      const grid = generateGrid(traits, 0, 0, wFrame);
      const rendered = renderTerminalFromGrid(grid, fRgb, dRgb, hRgb);
      const avatarLines = rendered.split("\n");
      const infoStart = Math.max(0, Math.floor((avatarLines.length - info.length) / 2));
      const merged: string[] = [];
      for (let i = 0; i < avatarLines.length; i++) {
        const left = avatarLines[i];
        const pad = " ".repeat(Math.max(0, avatarWidth - visLen(left)));
        const right = info[i - infoStart] ?? "";
        merged.push(`${left}${pad}  ${right}`);
      }
      return { output: merged.join("\n"), lineCount: avatarLines.length };
    }

    // Draw first frame (end with \n so cursor is on line below)
    const first = renderMergedFrame(1);
    process.stdout.write(first.output + "\n");
    const frameLineCount = first.lineCount;

    const drawFrame = () => {
      tick++;
      waveFrame = (tick % 2) + 1;
      const frame = renderMergedFrame(waveFrame);
      // Move up from blank line below avatar to first avatar line
      process.stdout.write(`\x1b[${frameLineCount}A`);
      process.stdout.write(frame.output + "\n");
    };

    const interval = setInterval(drawFrame, 400);

    // Ask for approval
    const answer = await prompt(`\n${RESET}Keep this avatar? ${DIM}(Y)es / (r)eroll / (q)uit${RESET} `);
    clearInterval(interval);
    process.stdout.write("\x1b[?25h"); // show cursor

    const a = answer.toLowerCase();
    if (a === "q" || a === "quit") {
      console.log("Cancelled.");
      process.exit(0);
    }
    if (a === "r" || a === "reroll") {
      dna = generateRandomDNA();
      continue;
    }
    // Accept (enter, y, yes)
    break;
  }

  const resolved: Record<string, string> = {
    AGENT_NAME: agentName,
    AGENT_PURPOSE: vars["AGENT_PURPOSE"] || "A personal agent that helps with tasks using workflows and skills.",
    OWNER_NAME: ownerName,
    AGENT_DNA: dna,
  };

  console.log("\nSpawning agent...");
  const tmpDir = await downloadTemplate();
  const extractDir = join(tmpDir, "out");

  try {
    // Replace {{VAR}} placeholders in AGENTS.md
    const agentsPath = join(extractDir, "AGENTS.md");
    try {
      let content = await readFile(agentsPath, "utf-8");
      for (const [key, value] of Object.entries(resolved)) {
        content = content.split(`{{${key}}}`).join(value);
      }
      await writeFile(agentsPath, content);
    } catch {
      // AGENTS.md missing or unreadable — skip replacements
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

    // Generate avatar SVG
    await writeFile(join(dest, "avatar.svg"), renderSVG(dna, 10, 0, null));

    console.log(`\nCreated in ${dest}`);
    console.log(`  avatar.svg (dna: ${dna})`);
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

// --- avatar ---

function extractDNA(content: string): string | null {
  const soulBlock = extractBlock(content, "agent-soul");
  if (!soulBlock) return null;
  const dnaMatch = soulBlock.full.match(/dna:\s*([a-f0-9]{6,7})/i);
  return dnaMatch?.[1] ?? null;
}

async function generateAvatarSVGs(dir: string): Promise<void> {
  const agentsPath = join(dir, "AGENTS.md");
  let content: string;
  try {
    content = await readFile(agentsPath, "utf-8");
  } catch {
    throw new Error("No AGENTS.md found in current directory. Are you in an agent folder?");
  }

  const dna = extractDNA(content);
  if (!dna) {
    throw new Error("No DNA found in <agent-soul> block of AGENTS.md.");
  }

  const outPath = join(dir, "avatar.svg");
  await writeFile(outPath, renderSVG(dna, 10, 0, null));

  console.log(renderTerminal(dna));
  console.log("");
  console.log(`Avatar saved to ${outPath} (dna: ${dna})`);
}

// --- demo ---

async function animateTermling(input: string | undefined, flags: Set<string>): Promise<void> {
  // Resolve DNA
  let dna: string;
  if (!input || input.startsWith("--")) {
    // Try to read from AGENTS.md in cwd
    try {
      const content = await readFile(join(process.cwd(), "AGENTS.md"), "utf-8");
      const found = extractDNA(content);
      if (found) {
        dna = found;
      } else {
        dna = generateRandomDNA();
      }
    } catch {
      dna = generateRandomDNA();
    }
  } else if (/^[0-9a-f]{6,7}$/i.test(input)) {
    dna = input;
  } else {
    dna = encodeDNA(traitsFromName(input));
    console.log(`"${input}" → dna: ${dna}`);
  }

  const walking = flags.has("walk") || (!flags.has("talk") && !flags.has("wave"));
  const talking = flags.has("talk");
  const waving = flags.has("wave");
  const compact = flags.has("compact");

  const traits = decodeDNA(dna);
  const legFrameCount = LEGS[traits.legs].length;
  const faceRgb = hslToRgb(traits.faceHue * 30, 0.5, 0.5);
  const darkRgb = hslToRgb(traits.faceHue * 30, 0.5, 0.28);
  const hatRgb = hslToRgb(traits.hatHue * 30, 0.5, 0.5);

  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";
  console.log(`${DIM}dna: ${dna}  (Ctrl+C to exit)${RESET}\n`);

  let walkFrame = 0;
  let talkFrame = 0;
  let waveFrame = 0;
  let tick = 0;

  // Hide cursor
  process.stdout.write("\x1b[?25l");

  function cleanup() {
    process.stdout.write("\x1b[?25h\n");
    process.exit(0);
  }
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Draw first frame (always end with \n so cursor is on line below)
  const firstOutput = compact
    ? renderTerminalSmallFromGrid(generateGrid(traits, 0, 0, 0), faceRgb, darkRgb, hatRgb)
    : renderTerminalFromGrid(generateGrid(traits, 0, 0, 0), faceRgb, darkRgb, hatRgb);
  const lineCount = firstOutput.split("\n").length;
  process.stdout.write(firstOutput + "\n");

  await new Promise<void>(() => {
    const interval = setInterval(() => {
      tick++;
      if (walking) walkFrame = tick % legFrameCount;
      if (talking) talkFrame = tick % 2;
      if (waving) waveFrame = (tick % 2) + 1;

      const grid = generateGrid(traits, walkFrame, talkFrame, waveFrame);
      const output = compact
        ? renderTerminalSmallFromGrid(grid, faceRgb, darkRgb, hatRgb)
        : renderTerminalFromGrid(grid, faceRgb, darkRgb, hatRgb);

      // Move up lineCount lines (cursor is on blank line below avatar)
      process.stdout.write(`\x1b[${lineCount}A`);
      process.stdout.write(output + "\n");
    }, 300);

    process.on("SIGINT", () => {
      clearInterval(interval);
      cleanup();
    });
  });
}

function renderTerminalFromGrid(
  grid: Pixel[][],
  faceRgb: [number, number, number],
  darkRgb: [number, number, number],
  hatRgb: [number, number, number],
): string {
  const faceAnsi = `\x1b[38;2;${faceRgb[0]};${faceRgb[1]};${faceRgb[2]}m`;
  const darkAnsi = `\x1b[38;2;${darkRgb[0]};${darkRgb[1]};${darkRgb[2]}m`;
  const hatAnsi = `\x1b[38;2;${hatRgb[0]};${hatRgb[1]};${hatRgb[2]}m`;
  const reset = "\x1b[0m";
  const faceBg = `\x1b[48;2;${faceRgb[0]};${faceRgb[1]};${faceRgb[2]}m`;

  const lines: string[] = [];
  for (const row of grid) {
    let line = "";
    for (const cell of row) {
      if (cell === "_") line += "  ";
      else if (cell === "f") line += `${faceAnsi}██${reset}`;
      else if (cell === "l") line += `${faceAnsi}▌${reset} `;
      else if (cell === "e" || cell === "d") line += `${darkAnsi}██${reset}`;
      else if (cell === "s") line += `${darkAnsi}${faceBg}▄▄${reset}`;
      else if (cell === "n") line += `${darkAnsi}${faceBg}▐▌${reset}`;
      else if (cell === "m") line += `${darkAnsi}${faceBg}▀▀${reset}`;
      else if (cell === "q") line += `${darkAnsi}${faceBg} ▗${reset}`;
      else if (cell === "r") line += `${darkAnsi}${faceBg}▖ ${reset}`;
      else if (cell === "a") line += `${faceAnsi}▄▄${reset}`;
      else if (cell === "h") line += `${hatAnsi}██${reset}`;
      else if (cell === "k") line += `${hatAnsi}▐▌${reset}`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function renderTerminalSmallFromGrid(
  grid: Pixel[][],
  faceRgb: [number, number, number],
  darkRgb: [number, number, number],
  hatRgb: [number, number, number],
): string {
  const reset = "\x1b[0m";

  function cellRgb(cell: Pixel): [number, number, number] | null {
    if (cell === "f" || cell === "l" || cell === "a" || cell === "q" || cell === "r") return faceRgb;
    if (cell === "e" || cell === "s" || cell === "n" || cell === "d" || cell === "m") return darkRgb;
    if (cell === "h" || cell === "k") return hatRgb;
    return null;
  }

  const lines: string[] = [];
  for (let r = 0; r < grid.length; r += 2) {
    const topRow = grid[r];
    const botRow = r + 1 < grid.length ? grid[r + 1] : null;
    let line = "";
    for (let c = 0; c < topRow.length; c++) {
      const top = cellRgb(topRow[c]);
      const bot = botRow ? cellRgb(botRow[c]) : null;
      if (top && bot) {
        line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m\x1b[48;2;${bot[0]};${bot[1]};${bot[2]}m▀${reset}`;
      } else if (top) {
        line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m▀${reset}`;
      } else if (bot) {
        line += `\x1b[38;2;${bot[0]};${bot[1]};${bot[2]}m▄${reset}`;
      } else {
        line += " ";
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}
