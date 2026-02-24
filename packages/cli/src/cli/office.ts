import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  FrameBufferRenderable,
  RGBA,
} from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { paths } from "../config/paths";
import { daemonRequest } from "./client";
import { ensureDaemon } from "./ensure-daemon";
import { generateGrid, decodeDNA, hslToRgb, LEGS } from "termlings";
import type { Pixel, DecodedDNA } from "termlings";

// --- Types ---

interface SessionManifest {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  jsonlFile: string | null;
  startedAt: string;
}

interface DaemonSession {
  id: string;
  command: string;
  state: string;
}

interface InputNeeded {
  sessionId: string;
  command: string;
  type: "approval" | "question";
}

interface AgentSoul {
  name: string;
  purpose: string;
  owner: string;
  dna?: string;
}

interface AgentInfo {
  sessionId: string;
  command: string;
  state: string;
  cwd: string;
  name: string;
  dna: string | null;
  needsInput: boolean;
  inputType: "approval" | "question" | null;
  jsonlFile: string | null;
}

// --- Data ---

function readManifests(): Map<string, SessionManifest> {
  const manifests = new Map<string, SessionManifest>();
  try {
    for (const f of readdirSync(paths.sessionsDir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = readFileSync(join(paths.sessionsDir, f), "utf-8");
        const m = JSON.parse(data) as SessionManifest;
        manifests.set(m.id, m);
      } catch {}
    }
  } catch {}
  return manifests;
}

async function fetchAgents(): Promise<AgentInfo[]> {
  let sessions: DaemonSession[] = [];
  let inputNeeded: InputNeeded[] = [];

  try {
    const statusRes = await daemonRequest("/status");
    sessions = (statusRes.sessions as DaemonSession[]) || [];
  } catch {
    return [];
  }

  try {
    const inputRes = await daemonRequest("/input-needed");
    inputNeeded = (inputRes.sessions as InputNeeded[]) || [];
  } catch {}

  const inputMap = new Map<string, InputNeeded>();
  for (const inp of inputNeeded) inputMap.set(inp.sessionId, inp);

  const manifests = readManifests();
  const agents: AgentInfo[] = [];

  for (const s of sessions) {
    const manifest = manifests.get(s.id);
    const cwd = manifest?.cwd || "";
    let name = s.command.split(" ")[0];
    let dna: string | null = null;

    if (cwd) {
      try {
        const soulRes = await daemonRequest(`/agent-soul?cwd=${encodeURIComponent(cwd)}`);
        const soul = soulRes.soul as AgentSoul | null;
        if (soul?.name) name = soul.name;
        if (soul?.dna) dna = soul.dna;
      } catch {}
    }

    const inp = inputMap.get(s.id);
    agents.push({
      sessionId: s.id,
      command: s.command.split(" ")[0],
      state: s.state,
      cwd,
      name,
      dna,
      needsInput: !!inp,
      inputType: inp?.type || null,
      jsonlFile: manifest?.jsonlFile || null,
    });
  }

  return agents;
}

// --- Peek (JSONL parsing) ---

interface DisplayEntry {
  role: "assistant" | "user" | "tool";
  text: string;
}

function extractEntries(msg: Record<string, unknown>): DisplayEntry[] {
  const entries: DisplayEntry[] = [];
  if (msg.type === "assistant") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (m?.content && Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") {
          const text = (block.text as string).trim();
          if (text) entries.push({ role: "assistant", text });
        }
        if (block.type === "tool_use" && typeof block.name === "string") {
          entries.push({ role: "tool", text: `${block.name}` });
        }
      }
    }
  } else if (msg.type === "user") {
    const m = msg.message as Record<string, unknown> | undefined;
    if (m?.content && Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") {
          const text = (block.text as string).trim();
          if (text) entries.push({ role: "user", text });
        }
      }
    }
  }
  return entries;
}

function getLastEntries(jsonlFile: string, count: number): DisplayEntry[] {
  let raw: string;
  try {
    raw = readFileSync(jsonlFile, "utf-8");
  } catch {
    return [];
  }
  const lines = raw.trim().split("\n").slice(-(count * 5));
  const all: DisplayEntry[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      all.push(...extractEntries(JSON.parse(line)));
    } catch {}
  }
  return all.slice(-count);
}

// --- Avatar Rendering into FrameBuffer ---

const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0);

function pixelColor(
  cell: Pixel,
  faceRgba: RGBA,
  darkRgba: RGBA,
  hatRgba: RGBA,
): { char: string; fg: RGBA; bg: RGBA } | null {
  switch (cell) {
    case "f": return { char: "█", fg: faceRgba, bg: TRANSPARENT };
    case "e": case "d": return { char: "█", fg: darkRgba, bg: TRANSPARENT };
    case "s": return { char: "▄", fg: darkRgba, bg: faceRgba };
    case "n": return { char: "▐", fg: darkRgba, bg: faceRgba };
    case "m": return { char: "▀", fg: darkRgba, bg: faceRgba };
    case "q": return { char: "▗", fg: darkRgba, bg: faceRgba };
    case "r": return { char: "▖", fg: darkRgba, bg: faceRgba };
    case "a": return { char: "▄", fg: faceRgba, bg: TRANSPARENT };
    case "h": return { char: "█", fg: hatRgba, bg: TRANSPARENT };
    case "l": return { char: "▌", fg: faceRgba, bg: TRANSPARENT };
    case "k": return { char: "▐", fg: hatRgba, bg: TRANSPARENT };
    case "_": return null;
    default: return null;
  }
}

function paintAvatar(
  fb: FrameBufferRenderable,
  grid: Pixel[][],
  faceRgba: RGBA,
  darkRgba: RGBA,
  hatRgba: RGBA,
  offsetX = 0,
  offsetY = 0,
) {
  fb.frameBuffer.clear();
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const p = pixelColor(grid[r][c], faceRgba, darkRgba, hatRgba);
      if (!p) continue;
      // Each pixel = 2 chars wide in grid view
      const x = offsetX + c * 2;
      const y = offsetY + r;
      fb.frameBuffer.setCell(x, y, p.char, p.fg, p.bg);
      fb.frameBuffer.setCell(x + 1, y, p.char, p.fg, p.bg);
    }
  }
}

function rgbToRGBA(rgb: [number, number, number]): RGBA {
  return RGBA.fromInts(rgb[0], rgb[1], rgb[2]);
}

// --- Main ---

export async function runOffice(): Promise<void> {
  await ensureDaemon();

  let agents = await fetchAgents();
  let selectedIndex = -1; // -1 = grid view, 0+ = detail view
  let animTick = 0;

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
    targetFps: 10,
    backgroundColor: "#1a1a2e",
  });

  const root = renderer.root;
  root.flexDirection = "column";
  root.padding = 1;
  (root as any).gap = 1;

  // --- Header ---
  const header = new TextRenderable(renderer, {
    id: "header",
    content: "",
  });
  root.add(header);

  // --- Content area ---
  const content = new BoxRenderable(renderer, {
    id: "content",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
    flexGrow: 1,
    alignItems: "flex-start",
  });
  root.add(content);

  // --- Footer ---
  const footer = new TextRenderable(renderer, {
    id: "footer",
    content: "",
  });
  root.add(footer);

  // --- Agent cell cache ---
  interface AgentCell {
    box: BoxRenderable;
    avatar: FrameBufferRenderable;
    nameText: TextRenderable;
    toolText: TextRenderable;
    statusText: TextRenderable;
    traits: DecodedDNA | null;
    faceRgba: RGBA;
    darkRgba: RGBA;
    hatRgba: RGBA;
    legFrames: number;
  }

  const cells: AgentCell[] = [];

  // --- Detail view components ---
  const detailBox = new BoxRenderable(renderer, {
    id: "detail",
    flexDirection: "column",
    gap: 1,
    flexGrow: 1,
    visible: false,
  });

  const detailHeader = new TextRenderable(renderer, { id: "detail-header", content: "" });
  const detailAvatarRow = new BoxRenderable(renderer, {
    id: "detail-avatar-row",
    flexDirection: "row",
    gap: 3,
    alignItems: "flex-start",
  });
  const detailAvatar = new FrameBufferRenderable(renderer, {
    id: "detail-avatar",
    width: 18,
    height: 12,
    respectAlpha: true,
  });
  const detailInfo = new TextRenderable(renderer, { id: "detail-info", content: "" });
  detailAvatarRow.add(detailAvatar);
  detailAvatarRow.add(detailInfo);

  const detailActivityLabel = new TextRenderable(renderer, { id: "detail-activity-label", content: "" });
  const detailActivity = new TextRenderable(renderer, { id: "detail-activity", content: "" });
  const detailFooter = new TextRenderable(renderer, { id: "detail-footer", content: "" });

  detailBox.add(detailHeader);
  detailBox.add(detailAvatarRow);
  detailBox.add(detailActivityLabel);
  detailBox.add(detailActivity);
  detailBox.add(detailFooter);
  root.add(detailBox);

  // --- Build grid cells ---
  function buildGridCells() {
    // Clear old cells
    for (const cell of cells) {
      content.remove(cell.box.id);
      cell.box.destroyRecursively();
    }
    cells.length = 0;

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      let traits: DecodedDNA | null = null;
      let faceRgba = RGBA.fromHex("#888888");
      let darkRgba = RGBA.fromHex("#444444");
      let hatRgba = RGBA.fromHex("#666666");
      let legFrames = 2;

      if (agent.dna) {
        try {
          traits = decodeDNA(agent.dna);
          faceRgba = rgbToRGBA(hslToRgb(traits.faceHue * 30, 0.5, 0.5));
          darkRgba = rgbToRGBA(hslToRgb(traits.faceHue * 30, 0.5, 0.28));
          hatRgba = rgbToRGBA(hslToRgb(traits.hatHue * 30, 0.5, 0.5));
          legFrames = LEGS[traits.legs].length;
        } catch {}
      }

      const box = new BoxRenderable(renderer, {
        id: `cell-${i}`,
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
        width: 22,
        padding: 1,
      });

      const label = new TextRenderable(renderer, {
        id: `cell-label-${i}`,
        content: `[${i + 1}]`,
      });

      const avatar = new FrameBufferRenderable(renderer, {
        id: `cell-avatar-${i}`,
        width: 18,
        height: 12,
        respectAlpha: true,
      });

      const nameText = new TextRenderable(renderer, {
        id: `cell-name-${i}`,
        content: truncate(agent.name, 12),
      });

      const toolText = new TextRenderable(renderer, {
        id: `cell-tool-${i}`,
        content: agent.command,
      });

      const statusIcon = agent.needsInput ? "! input" : agent.state === "running" || agent.state === "remote" ? "working" : agent.state;
      const statusText = new TextRenderable(renderer, {
        id: `cell-status-${i}`,
        content: statusIcon,
      });

      box.add(label);
      box.add(avatar);
      box.add(nameText);
      box.add(toolText);
      box.add(statusText);
      content.add(box);

      cells.push({ box, avatar, nameText, toolText, statusText, traits, faceRgba, darkRgba, hatRgba, legFrames });
    }
  }

  function updateHeader() {
    const count = agents.length;
    header.content = `  ⛳ touchgrass office                          ${count} agent${count !== 1 ? "s" : ""}`;
  }

  function updateFooter() {
    if (selectedIndex >= 0) {
      footer.content = "  Esc back · w write message · p peek full";
    } else {
      footer.content = "  1-9 select · q quit · r refresh";
    }
  }

  function animateGridAvatars() {
    animTick++;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const agent = agents[i];
      if (!cell.traits) continue;

      let walkFrame = 0;
      let waveFrame = 0;

      if (agent.needsInput) {
        // Waving
        waveFrame = (animTick % 2) + 1;
      } else if (agent.state === "running" || agent.state === "remote") {
        // Walking
        walkFrame = animTick % cell.legFrames;
      }
      // Idle = frame 0,0,0

      const grid = generateGrid(cell.traits, walkFrame, 0, waveFrame);
      paintAvatar(cell.avatar, grid, cell.faceRgba, cell.darkRgba, cell.hatRgba);
    }
    renderer.requestRender();
  }

  function showGrid() {
    selectedIndex = -1;
    content.visible = true;
    detailBox.visible = false;
    updateFooter();
    renderer.requestRender();
  }

  function showDetail(index: number) {
    if (index < 0 || index >= agents.length) return;
    selectedIndex = index;
    const agent = agents[index];
    const cell = cells[index];

    content.visible = false;
    detailBox.visible = true;

    const inputLabel = agent.needsInput ? `  ⚠ Needs ${agent.inputType || "input"}` : "";
    detailHeader.content = `  [${index + 1}] ${agent.name} — ${agent.command}${inputLabel}`;

    // Paint detail avatar
    if (cell?.traits) {
      const grid = generateGrid(cell.traits, 0, 0, agent.needsInput ? 1 : 0);
      paintAvatar(detailAvatar, grid, cell.faceRgba, cell.darkRgba, cell.hatRgba);
    } else {
      detailAvatar.frameBuffer.clear();
    }

    const shortId = agent.sessionId.length > 20 ? agent.sessionId.slice(0, 20) + "..." : agent.sessionId;
    const cwdShort = agent.cwd.replace(process.env.HOME || "", "~");
    const dnaStr = agent.dna || "none";
    detailInfo.content = `Session:  ${shortId}\nCWD:      ${cwdShort}\nDNA:      ${dnaStr}`;

    // Last activity from JSONL
    if (agent.jsonlFile) {
      const entries = getLastEntries(agent.jsonlFile, 5);
      if (entries.length > 0) {
        detailActivityLabel.content = "  Last activity:";
        const lines = entries.map((e) => {
          const label = e.role === "assistant" ? "[Assistant]" : e.role === "user" ? "[User]" : "[Tool]";
          const text = e.text.length > 60 ? e.text.slice(0, 60) + "..." : e.text;
          return `    ${label} ${text}`;
        });
        detailActivity.content = lines.join("\n");
      } else {
        detailActivityLabel.content = "";
        detailActivity.content = "    No activity yet.";
      }
    } else {
      detailActivityLabel.content = "";
      detailActivity.content = "    No JSONL file.";
    }

    detailFooter.content = "  Esc back · w write message";
    updateFooter();
    renderer.requestRender();
  }

  // --- Empty state ---
  const emptyText = new TextRenderable(renderer, {
    id: "empty",
    content: "  No active sessions. Start one with: tg claude",
    visible: false,
  });
  root.add(emptyText);

  function refreshView() {
    if (agents.length === 0) {
      content.visible = false;
      detailBox.visible = false;
      emptyText.visible = true;
    } else {
      emptyText.visible = false;
      if (selectedIndex < 0) {
        content.visible = true;
        detailBox.visible = false;
      }
    }
    updateHeader();
    updateFooter();
    renderer.requestRender();
  }

  // --- Initial build ---
  buildGridCells();
  refreshView();
  animateGridAvatars();

  // --- Keyboard ---
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.name === "q" && !key.ctrl && selectedIndex < 0) {
      clearInterval(animTimer);
      clearInterval(refreshTimer);
      renderer.stop();
      return;
    }

    if (key.name === "Escape" && selectedIndex >= 0) {
      showGrid();
      return;
    }

    if (key.name === "r" && selectedIndex < 0) {
      // Manual refresh
      fetchAgents().then((a) => {
        agents = a;
        buildGridCells();
        refreshView();
        animateGridAvatars();
      });
      return;
    }

    // Number keys 1-9
    const num = parseInt(key.name, 10);
    if (num >= 1 && num <= 9 && num <= agents.length && selectedIndex < 0) {
      showDetail(num - 1);
      return;
    }

    // Write message from detail view
    if (key.name === "w" && selectedIndex >= 0) {
      const agent = agents[selectedIndex];
      clearInterval(animTimer);
      clearInterval(refreshTimer);
      renderer.stop();
      // Print instruction for user to write
      console.log(`\nTo write to ${agent.name}:`);
      console.log(`  tg write ${agent.sessionId} "your message"`);
      return;
    }

    // Peek from detail view
    if (key.name === "p" && selectedIndex >= 0) {
      const agent = agents[selectedIndex];
      clearInterval(animTimer);
      clearInterval(refreshTimer);
      renderer.stop();
      console.log(`\nTo peek at ${agent.name}:`);
      console.log(`  tg peek ${agent.sessionId}`);
      return;
    }
  });

  // --- Timers ---
  const animTimer = setInterval(animateGridAvatars, 400);
  const refreshTimer = setInterval(async () => {
    try {
      const newAgents = await fetchAgents();
      agents = newAgents;
      if (selectedIndex < 0) {
        buildGridCells();
        refreshView();
      } else if (selectedIndex < agents.length) {
        // Refresh detail view data
        showDetail(selectedIndex);
      } else {
        // Selected agent disappeared
        showGrid();
        buildGridCells();
        refreshView();
      }
    } catch {}
  }, 2000);

  // Start rendering
  renderer.start();
  await renderer.idle();

  clearInterval(animTimer);
  clearInterval(refreshTimer);
  renderer.destroy();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
