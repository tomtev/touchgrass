// Agent DNA avatar system
// Encodes visual identity as a 6-hex-char string (~16M combinations)

export type Pixel = "f" | "e" | "s" | "n" | "m" | "d" | "h" | "l" | "k" | "q" | "r" | "a" | "_";
// f = face/body, e = eye (dark, full block), s = squint eye (dark, thin horizontal ▄▄),
// n = narrow eye (dark, thin vertical ▐▌),
// m = mouth (dark, thin ▀▀ in terminal),
// d = dark accent (full-block dark, for hat bands etc.),
// h = hat (secondary hue), l = thin leg (face color, ▌ in terminal),
// k = thin hat (hat color, ▐▌ in terminal),
// q = smile corner left (dark ▗ on face bg), r = smile corner right (dark ▖ on face bg),
// a = arm (face color, thin horizontal ▄▄ in terminal),
// _ = transparent

// Face row template (7px wide head centered in 9-col grid)
const F: Pixel[] = ["_", "f", "f", "f", "f", "f", "f", "f", "_"];

// --- Eye variants (1 row each) ---
export const EYES: Pixel[][] = [
  ["_", "f", "e", "f", "f", "f", "e", "f", "_"], // normal
  ["_", "e", "f", "f", "f", "f", "f", "e", "_"], // wide
  ["_", "f", "f", "e", "f", "e", "f", "f", "_"], // close
  ["_", "f", "e", "f", "f", "f", "e", "f", "_"], // normal-alt
  ["_", "e", "e", "f", "f", "f", "e", "e", "_"], // big
  ["_", "f", "e", "e", "f", "e", "e", "f", "_"], // big close
  ["_", "f", "s", "f", "f", "f", "s", "f", "_"], // squint
  ["_", "s", "f", "f", "f", "f", "f", "s", "_"], // squint wide
  ["_", "f", "n", "f", "f", "f", "n", "f", "_"], // narrow
  ["_", "n", "f", "f", "f", "f", "f", "n", "_"], // narrow wide
  ["_", "f", "f", "n", "f", "n", "f", "f", "_"], // narrow close
];

// --- Mouth variants (2 rows: gap + mouth) ---
// Uses thin half-block rendering: m=▀▀, q=▗ corner left, r=▖ corner right
export const MOUTHS: Pixel[][][] = [
  [
    // smile (default)
    ["_", "f", "q", "f", "f", "f", "r", "f", "_"],
    ["_", "f", "f", "m", "m", "m", "f", "f", "_"],
  ],
  [
    // smirk left
    ["_", "f", "q", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "m", "m", "m", "f", "f", "_"],
  ],
  [
    // smirk right
    ["_", "f", "f", "f", "f", "f", "r", "f", "_"],
    ["_", "f", "f", "m", "m", "m", "f", "f", "_"],
  ],
  [
    // narrow
    ["_", "f", "f", "q", "f", "r", "f", "f", "_"],
    ["_", "f", "f", "f", "m", "f", "f", "f", "_"],
  ],
  [
    // wide smile
    ["_", "q", "f", "f", "f", "f", "f", "r", "_"],
    ["_", "f", "m", "m", "m", "m", "m", "f", "_"],
  ],
  [
    // wide smirk left
    ["_", "q", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "m", "m", "m", "m", "m", "f", "_"],
  ],
  [
    // wide smirk right
    ["_", "f", "f", "f", "f", "f", "f", "r", "_"],
    ["_", "f", "m", "m", "m", "m", "m", "f", "_"],
  ],
];

// --- Hat variants (0-3 rows) ---
export const HATS: Pixel[][][] = [
  [], // none
  [
    // tophat
    ["_", "_", "_", "h", "h", "h", "_", "_", "_"],
    ["_", "_", "_", "h", "h", "h", "_", "_", "_"],
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
  ],
  [
    // beanie
    ["_", "_", "_", "h", "h", "h", "_", "_", "_"],
    ["_", "_", "h", "h", "h", "h", "h", "_", "_"],
  ],
  [
    // crown
    ["_", "_", "h", "_", "h", "_", "h", "_", "_"],
    ["_", "_", "h", "h", "h", "h", "h", "_", "_"],
  ],
  [
    // cap
    ["_", "_", "h", "h", "h", "h", "h", "_", "_"],
    ["h", "h", "h", "h", "h", "h", "h", "_", "_"],
  ],
  [
    // horns
    ["_", "h", "_", "_", "_", "_", "_", "h", "_"],
    ["_", "h", "h", "_", "_", "_", "h", "h", "_"],
  ],
  [
    // mohawk
    ["_", "_", "_", "_", "h", "_", "_", "_", "_"],
    ["_", "_", "_", "h", "h", "h", "_", "_", "_"],
  ],
  [
    // antenna
    ["_", "_", "_", "_", "h", "_", "_", "_", "_"],
    ["_", "_", "_", "_", "h", "_", "_", "_", "_"],
  ],
  [
    // halo
    ["_", "_", "_", "h", "h", "h", "_", "_", "_"],
  ],
  [
    // bandage
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
  ],
  [
    // wide brim
    ["_", "_", "h", "h", "h", "h", "h", "_", "_"],
    ["h", "h", "h", "h", "h", "h", "h", "h", "h"],
  ],
  [
    // unicorn horn
    ["_", "_", "_", "_", "k", "_", "_", "_", "_"],
    ["_", "_", "_", "_", "h", "_", "_", "_", "_"],
    ["_", "_", "_", "h", "h", "h", "_", "_", "_"],
  ],
  [
    // ears
    ["_", "h", "h", "_", "_", "_", "h", "h", "_"],
  ],
  [
    // spikes
    ["_", "h", "_", "h", "_", "h", "_", "h", "_"],
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
  ],
  [
    // party hat
    ["_", "_", "_", "_", "h", "_", "_", "_", "_"],
    ["_", "_", "_", "h", "h", "h", "_", "_", "_"],
    ["_", "_", "h", "h", "h", "h", "h", "_", "_"],
  ],
  [
    // flat top
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
  ],
  [
    // afro
    ["_", "_", "k", "h", "h", "h", "k", "_", "_"],
    ["_", "k", "h", "h", "h", "h", "h", "k", "_"],
  ],
  [
    // spiky thin
    ["_", "k", "_", "k", "_", "k", "_", "k", "_"],
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
  ],
  [
    // side sweep
    ["_", "_", "_", "_", "h", "h", "h", "k", "_"],
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
  ],
  [
    // tiara
    ["_", "_", "_", "h", "_", "h", "_", "_", "_"],
    ["_", "f", "h", "h", "h", "h", "h", "f", "_"],
  ],
  [
    // cowboy hat
    ["_", "_", "h", "h", "h", "h", "h", "_", "_"],
    ["_", "_", "h", "h", "h", "h", "h", "_", "_"],
    ["h", "h", "h", "h", "h", "h", "h", "h", "h"],
  ],
  [
    // knitted hat
    ["_", "_", "_", "h", "h", "h", "_", "_", "_"],
    ["_", "_", "h", "h", "h", "h", "h", "_", "_"],
    ["_", "h", "f", "h", "f", "h", "f", "h", "_"],
  ],
  [
    // clown hair
    ["h", "h", "_", "_", "_", "_", "_", "h", "h"],
    ["h", "h", "h", "_", "_", "_", "h", "h", "h"],
  ],
  [
    // stovepipe
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
    ["_", "h", "h", "h", "h", "h", "h", "h", "_"],
    ["_", "d", "d", "d", "d", "d", "d", "d", "_"],
    ["h", "h", "h", "h", "h", "h", "h", "h", "h"],
  ],
];

// --- Body variants (flat, no animation frames) ---
export const BODIES: Pixel[][][] = [
  [
    // normal
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
  ],
  [
    // normal-arms
    ["a", "f", "f", "f", "f", "f", "f", "f", "a"],
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
  ],
  [
    // narrow
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
  ],
  [
    // narrow-arms
    ["_", "a", "f", "f", "f", "f", "f", "a", "_"],
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
  ],
  [
    // tapered
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
  ],
  [
    // tapered-arms
    ["a", "f", "f", "f", "f", "f", "f", "f", "a"],
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
  ],
];

// --- Leg variants (multi-frame for walking animation) ---
// Each variant is an array of frames. Frame 0 = standing pose.
export const LEGS: Pixel[][][] = [
  [ // biped
    ["_", "_", "f", "_", "_", "f", "_", "_", "_"],
    ["_", "f", "_", "_", "_", "_", "f", "_", "_"],
  ],
  [ // quad (thin, alternating pairs)
    ["_", "l", "_", "_", "_", "_", "_", "l", "_"],
    ["_", "_", "_", "l", "_", "l", "_", "_", "_"],
  ],
  [ // tentacles (thin, cycle visibility)
    ["_", "l", "_", "l", "_", "l", "_", "l", "_"],
    ["_", "_", "l", "_", "l", "_", "l", "_", "_"],
    ["_", "l", "_", "l", "_", "l", "_", "_", "_"],
  ],
  [ // thin biped
    ["_", "_", "l", "_", "_", "_", "l", "_", "_"],
    ["_", "_", "_", "l", "_", "l", "_", "_", "_"],
  ],
  [ // wide stance
    ["_", "f", "_", "_", "_", "_", "_", "f", "_"],
    ["_", "_", "f", "_", "_", "_", "f", "_", "_"],
  ],
  [ // thin narrow
    ["_", "_", "_", "l", "_", "l", "_", "_", "_"],
    ["_", "_", "l", "_", "_", "_", "l", "_", "_"],
  ],
];

// Fixed slot sizes for stable DNA encoding.
// Adding new variants within these limits won't break existing DNA strings.
// 12 * 12 * 24 * 8 * 8 * 12 * 12 = 15,925,248 (~16M, fits in 6 hex chars)
export const SLOTS = {
  eyes: 12,
  mouths: 12,
  hats: 24,
  bodies: 8,
  legs: 8,
  hues: 12,
};

export interface DecodedDNA {
  eyes: number;
  mouth: number;
  hat: number;
  body: number;
  legs: number;
  faceHue: number; // 0-11 index -> multiply by 30 for degrees
  hatHue: number; // 0-11 index -> multiply by 30 for degrees
}

/**
 * Encode trait indices into a 7-character hex DNA string.
 * Uses fixed slot sizes so adding traits doesn't break existing DNAs.
 * Existing 6-char DNAs are decoded identically (leading zero is implicit).
 */
export function encodeDNA(traits: DecodedDNA): string {
  let n = traits.hatHue;
  n += traits.faceHue * SLOTS.hues;
  n += traits.legs * SLOTS.hues * SLOTS.hues;
  n += traits.body * SLOTS.legs * SLOTS.hues * SLOTS.hues;
  n += traits.hat * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;
  n += traits.mouth * SLOTS.hats * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;
  n += traits.eyes * SLOTS.mouths * SLOTS.hats * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;
  return n.toString(16).padStart(7, "0");
}

/**
 * Decode a hex DNA string (6-7 chars) into trait indices.
 * Clamps to actual array lengths for forward compatibility.
 */
export function decodeDNA(hex: string): DecodedDNA {
  let n = parseInt(hex, 16);
  const hatHue = n % SLOTS.hues;
  n = Math.floor(n / SLOTS.hues);
  const faceHue = n % SLOTS.hues;
  n = Math.floor(n / SLOTS.hues);
  const legs = n % SLOTS.legs;
  n = Math.floor(n / SLOTS.legs);
  const body = n % SLOTS.bodies;
  n = Math.floor(n / SLOTS.bodies);
  const hat = n % SLOTS.hats;
  n = Math.floor(n / SLOTS.hats);
  const mouth = n % SLOTS.mouths;
  n = Math.floor(n / SLOTS.mouths);
  const eyes = n % SLOTS.eyes;
  return {
    eyes: eyes % EYES.length,
    mouth: mouth % MOUTHS.length,
    hat: hat % HATS.length,
    body: body % BODIES.length,
    legs: legs % LEGS.length,
    faceHue: faceHue % SLOTS.hues,
    hatHue: hatHue % SLOTS.hues,
  };
}

/**
 * Generate a random valid DNA string.
 */
export function generateRandomDNA(): string {
  return encodeDNA({
    eyes: Math.floor(Math.random() * EYES.length),
    mouth: Math.floor(Math.random() * MOUTHS.length),
    hat: Math.floor(Math.random() * HATS.length),
    body: Math.floor(Math.random() * BODIES.length),
    legs: Math.floor(Math.random() * LEGS.length),
    faceHue: Math.floor(Math.random() * SLOTS.hues),
    hatHue: Math.floor(Math.random() * SLOTS.hues),
  });
}

// --- Wave animation frames (override body when waving) ---
export const WAVE_FRAMES: Pixel[][][] = [
  [
    // left up, right down
    ["a", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "f", "f", "f", "f", "f", "a"],
  ],
  [
    // left down, right up
    ["_", "f", "f", "f", "f", "f", "f", "f", "a"],
    ["a", "f", "f", "f", "f", "f", "f", "f", "_"],
  ],
];

// --- Talk animation frames (universal, override mouth when talking) ---
// Cycle: agent's normal mouth (talkFrame=0) → open → repeat
export const TALK_FRAMES: Pixel[][][] = [
  [
    // open mouth (full dark, no corners)
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "d", "d", "d", "f", "f", "_"],
  ],
];

/**
 * Generate the pixel grid from decoded DNA traits.
 * @param frame Walking animation frame index (0 = standing). Wraps automatically.
 * @param talkFrame Talk animation frame (0 = normal mouth, 1+ = talk frames). Wraps automatically.
 * @param waveFrame Wave animation frame (0 = normal body, 1+ = wave frames). Wraps automatically.
 */
export function generateGrid(traits: DecodedDNA, frame = 0, talkFrame = 0, waveFrame = 0): Pixel[][] {
  const legFrames = LEGS[traits.legs];
  const legRow = legFrames[frame % legFrames.length];
  const mouthRows = talkFrame === 0
    ? MOUTHS[traits.mouth]
    : TALK_FRAMES[(talkFrame - 1) % TALK_FRAMES.length];
  const bodyRows = waveFrame === 0
    ? BODIES[traits.body]
    : WAVE_FRAMES[(waveFrame - 1) % WAVE_FRAMES.length];
  return [
    ...HATS[traits.hat],
    F,
    EYES[traits.eyes],
    ...mouthRows,
    ...bodyRows,
    legRow,
  ];
}

/**
 * Convert HSL to RGB. h in [0,360], s and l in [0,1]. Returns [r,g,b] each in [0,255].
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1: number, g1: number, b1: number;
  if (h < 60) {
    [r1, g1, b1] = [c, x, 0];
  } else if (h < 120) {
    [r1, g1, b1] = [x, c, 0];
  } else if (h < 180) {
    [r1, g1, b1] = [0, c, x];
  } else if (h < 240) {
    [r1, g1, b1] = [0, x, c];
  } else if (h < 300) {
    [r1, g1, b1] = [x, 0, c];
  } else {
    [r1, g1, b1] = [c, 0, x];
  }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

/**
 * Render a DNA string as an SVG string with transparent background.
 * Each pixel is rendered as a square rect. 1-cell padding around the grid.
 */
export function renderSVG(dna: string, pixelSize = 10, frame = 0): string {
  const traits = decodeDNA(dna);
  const grid = generateGrid(traits, frame);

  const faceHueDeg = traits.faceHue * 30;
  const hatHueDeg = traits.hatHue * 30;

  const faceRgb = hslToRgb(faceHueDeg, 0.5, 0.5);
  const darkRgb = hslToRgb(faceHueDeg, 0.5, 0.28);
  const hatRgb = hslToRgb(hatHueDeg, 0.5, 0.5);

  const toHex = (r: number, g: number, b: number) =>
    `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

  const faceHex = toHex(...faceRgb);
  const darkHex = toHex(...darkRgb);
  const hatHex = toHex(...hatRgb);

  const cols = 9;
  const rows = grid.length;
  const pad = 1; // 1-cell padding
  const w = (cols + pad * 2) * pixelSize;
  const h = (rows + pad * 2) * pixelSize;

  const half = Math.round(pixelSize / 2);
  const quarter = Math.round(pixelSize / 4);
  const rects: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = grid[y][x];
      const rx = (x + pad) * pixelSize;
      const ry = (y + pad) * pixelSize;
      if (cell === "f") {
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${faceHex}"/>`);
      } else if (cell === "l") {
        rects.push(`<rect x="${rx}" y="${ry}" width="${half}" height="${pixelSize}" fill="${faceHex}"/>`);
      } else if (cell === "a") {
        rects.push(`<rect x="${rx}" y="${ry + half}" width="${pixelSize}" height="${half}" fill="${faceHex}"/>`);
      } else if (cell === "e" || cell === "d") {
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${darkHex}"/>`);
      } else if (cell === "s") {
        // Squint eye: face bg + dark bottom half
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${faceHex}"/>`);
        rects.push(`<rect x="${rx}" y="${ry + half}" width="${pixelSize}" height="${half}" fill="${darkHex}"/>`);
      } else if (cell === "n") {
        // Narrow eye: face bg + dark center half-width
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${faceHex}"/>`);
        rects.push(`<rect x="${rx + quarter}" y="${ry}" width="${half}" height="${pixelSize}" fill="${darkHex}"/>`);
      } else if (cell === "m") {
        // Thin mouth: face bg + dark top half
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${faceHex}"/>`);
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${half}" fill="${darkHex}"/>`);
      } else if (cell === "q") {
        // Corner left: face bg + dark bottom-right quarter
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${faceHex}"/>`);
        rects.push(`<rect x="${rx + half}" y="${ry + half}" width="${half}" height="${half}" fill="${darkHex}"/>`);
      } else if (cell === "r") {
        // Corner right: face bg + dark bottom-left quarter
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${faceHex}"/>`);
        rects.push(`<rect x="${rx}" y="${ry + half}" width="${half}" height="${half}" fill="${darkHex}"/>`);
      } else if (cell === "h") {
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${hatHex}"/>`);
      } else if (cell === "k") {
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${hatHex}"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">\n${rects.join("\n")}\n</svg>`;
}

/**
 * Render a DNA string as ANSI colored pixel art for the terminal.
 * Uses `██` per pixel (2 chars wide for square proportions).
 */
export function renderTerminal(dna: string, frame = 0): string {
  const traits = decodeDNA(dna);
  const grid = generateGrid(traits, frame);

  const faceHueDeg = traits.faceHue * 30;
  const hatHueDeg = traits.hatHue * 30;

  const faceRgb = hslToRgb(faceHueDeg, 0.5, 0.5);
  const darkRgb = hslToRgb(faceHueDeg, 0.5, 0.28);
  const hatRgb = hslToRgb(hatHueDeg, 0.5, 0.5);

  const faceAnsi = `\x1b[38;2;${faceRgb[0]};${faceRgb[1]};${faceRgb[2]}m`;
  const darkAnsi = `\x1b[38;2;${darkRgb[0]};${darkRgb[1]};${darkRgb[2]}m`;
  const hatAnsi = `\x1b[38;2;${hatRgb[0]};${hatRgb[1]};${hatRgb[2]}m`;
  const reset = "\x1b[0m";

  const faceBg = `\x1b[48;2;${faceRgb[0]};${faceRgb[1]};${faceRgb[2]}m`;

  const lines: string[] = [];
  for (const row of grid) {
    let line = "";
    for (const cell of row) {
      if (cell === "_") {
        line += "  ";
      } else if (cell === "f") {
        line += `${faceAnsi}██${reset}`;
      } else if (cell === "l") {
        line += `${faceAnsi}▌${reset} `;
      } else if (cell === "e" || cell === "d") {
        line += `${darkAnsi}██${reset}`;
      } else if (cell === "s") {
        line += `${darkAnsi}${faceBg}▄▄${reset}`;
      } else if (cell === "n") {
        line += `${darkAnsi}${faceBg}▐▌${reset}`;
      } else if (cell === "m") {
        line += `${darkAnsi}${faceBg}▀▀${reset}`;
      } else if (cell === "q") {
        line += `${darkAnsi}${faceBg} ▗${reset}`;
      } else if (cell === "r") {
        line += `${darkAnsi}${faceBg}▖ ${reset}`;
      } else if (cell === "a") {
        line += `${faceAnsi}▄▄${reset}`;
      } else if (cell === "h") {
        line += `${hatAnsi}██${reset}`;
      } else if (cell === "k") {
        line += `${hatAnsi}▐▌${reset}`;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Compact terminal renderer using half-block characters.
 * Packs two pixel rows into one terminal line using ▀/▄ with fg/bg colors.
 * Roughly half the height and width of renderTerminal.
 */
export function renderTerminalSmall(dna: string, frame = 0): string {
  const traits = decodeDNA(dna);
  const grid = generateGrid(traits, frame);

  const faceHueDeg = traits.faceHue * 30;
  const hatHueDeg = traits.hatHue * 30;

  const faceRgb = hslToRgb(faceHueDeg, 0.5, 0.5);
  const darkRgb = hslToRgb(faceHueDeg, 0.5, 0.28);
  const hatRgb = hslToRgb(hatHueDeg, 0.5, 0.5);

  function cellRgb(cell: Pixel): [number, number, number] | null {
    if (cell === "f" || cell === "l" || cell === "a" || cell === "q" || cell === "r" || cell === "m") return faceRgb;
    if (cell === "e" || cell === "s" || cell === "n" || cell === "d") return darkRgb;
    if (cell === "h" || cell === "k") return hatRgb;
    return null; // transparent
  }

  const reset = "\x1b[0m";
  const lines: string[] = [];

  // Process two rows at a time using ▀ (upper half block)
  for (let r = 0; r < grid.length; r += 2) {
    const topRow = grid[r];
    const botRow = r + 1 < grid.length ? grid[r + 1] : null;
    let line = "";
    for (let c = 0; c < topRow.length; c++) {
      const top = cellRgb(topRow[c]);
      const bot = botRow ? cellRgb(botRow[c]) : null;
      if (top && bot) {
        // ▀ with fg=top, bg=bot
        line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m\x1b[48;2;${bot[0]};${bot[1]};${bot[2]}m▀${reset}`;
      } else if (top) {
        // ▀ with fg=top, no bg
        line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m▀${reset}`;
      } else if (bot) {
        // ▄ with fg=bot, no bg
        line += `\x1b[38;2;${bot[0]};${bot[1]};${bot[2]}m▄${reset}`;
      } else {
        line += " ";
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}
