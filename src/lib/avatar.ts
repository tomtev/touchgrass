// Agent DNA avatar system
// Encodes visual identity as a 6-hex-char string (~16M combinations)

export type Pixel = "f" | "e" | "m" | "h" | "l" | "k" | "_";
// f = face/body, e = eye (dark), m = mouth (dark), h = hat (secondary hue),
// l = thin leg (face color, ▌ in terminal), k = thin hat (hat color, ▐▌ in terminal),
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
];

// --- Mouth variants (2 rows: gap + mouth) ---
export const MOUTHS: Pixel[][][] = [
  [
    // smile
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "m", "m", "m", "f", "f", "_"],
  ],
  [
    // flat
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "m", "m", "m", "f", "f", "_"],
  ],
  [
    // open
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "f", "m", "m", "f", "f", "_"],
  ],
  [
    // smirk
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "f", "m", "m", "m", "f", "_"],
  ],
  [
    // grin
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "m", "m", "m", "m", "m", "f", "_"],
  ],
  [
    // dot
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "f", "m", "f", "f", "f", "_"],
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
    ["_", "_", "_", "_", "h", "_", "_", "_", "_"],
    ["_", "_", "_", "_", "h", "_", "_", "_", "_"],
    ["_", "_", "_", "_", "h", "_", "_", "_", "_"],
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
    ["_", "m", "m", "m", "m", "m", "m", "m", "_"],
    ["h", "h", "h", "h", "h", "h", "h", "h", "h"],
  ],
];

// --- Body variants (flat, no animation frames) ---
export const BODIES: Pixel[][][] = [
  [
    // normal - no arms
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
  ],
  [
    // arms down
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["f", "f", "f", "f", "f", "f", "f", "f", "f"],
  ],
  [
    // arms out
    ["f", "f", "f", "f", "f", "f", "f", "f", "f"],
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
  ],
  [
    // stubby arms
    ["f", "f", "f", "f", "f", "f", "f", "f", "f"],
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
  ],
  [
    // pear
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
  ],
  [
    // round - no arms
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
  ],
  [
    // tapered - no arms
    ["_", "f", "f", "f", "f", "f", "f", "f", "_"],
    ["_", "_", "f", "f", "f", "f", "f", "_", "_"],
  ],
];

// --- Leg variants (flat, no animation frames) ---
export const LEGS: Pixel[][] = [
  ["_", "_", "f", "_", "_", "f", "_", "_", "_"], // biped
  ["_", "f", "_", "f", "_", "f", "_", "f", "_"], // quad
  ["_", "_", "f", "_", "f", "_", "f", "_", "_"], // tentacles
  ["_", "f", "f", "f", "_", "f", "f", "f", "_"], // hexapod
  ["_", "_", "f", "f", "_", "f", "f", "_", "_"], // wheels
  ["_", "f", "_", "_", "f", "_", "_", "f", "_"], // tripod
  ["_", "f", "_", "_", "_", "_", "_", "f", "_"], // wide stance
  ["_", "l", "l", "_", "_", "_", "l", "l", "_"], // animal
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
 * Encode trait indices into a 6-character hex DNA string.
 * Uses fixed slot sizes so adding traits doesn't break existing DNAs.
 */
export function encodeDNA(traits: DecodedDNA): string {
  let n = traits.hatHue;
  n += traits.faceHue * SLOTS.hues;
  n += traits.legs * SLOTS.hues * SLOTS.hues;
  n += traits.body * SLOTS.legs * SLOTS.hues * SLOTS.hues;
  n += traits.hat * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;
  n += traits.mouth * SLOTS.hats * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;
  n += traits.eyes * SLOTS.mouths * SLOTS.hats * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;
  return n.toString(16).padStart(6, "0");
}

/**
 * Decode a 6-character hex DNA string into trait indices.
 * Also accepts legacy 7-char strings for backward compatibility.
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

/**
 * Generate the pixel grid from decoded DNA traits.
 */
export function generateGrid(traits: DecodedDNA): Pixel[][] {
  return [
    ...HATS[traits.hat],
    F,
    EYES[traits.eyes],
    ...MOUTHS[traits.mouth],
    ...BODIES[traits.body],
    LEGS[traits.legs],
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
export function renderSVG(dna: string, pixelSize = 10): string {
  const traits = decodeDNA(dna);
  const grid = generateGrid(traits);

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

  const rects: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = grid[y][x];
      let fill: string | null = null;
      if (cell === "f" || cell === "l") fill = faceHex;
      else if (cell === "e" || cell === "m") fill = darkHex;
      else if (cell === "h" || cell === "k") fill = hatHex;
      if (fill) {
        const rx = (x + pad) * pixelSize;
        const ry = (y + pad) * pixelSize;
        rects.push(`<rect x="${rx}" y="${ry}" width="${pixelSize}" height="${pixelSize}" fill="${fill}"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">\n${rects.join("\n")}\n</svg>`;
}

/**
 * Render a DNA string as ANSI colored pixel art for the terminal.
 * Uses `██` per pixel (2 chars wide for square proportions).
 */
export function renderTerminal(dna: string): string {
  const traits = decodeDNA(dna);
  const grid = generateGrid(traits);

  const faceHueDeg = traits.faceHue * 30;
  const hatHueDeg = traits.hatHue * 30;

  const faceRgb = hslToRgb(faceHueDeg, 0.5, 0.5);
  const darkRgb = hslToRgb(faceHueDeg, 0.5, 0.28);
  const hatRgb = hslToRgb(hatHueDeg, 0.5, 0.5);

  const faceAnsi = `\x1b[38;2;${faceRgb[0]};${faceRgb[1]};${faceRgb[2]}m`;
  const darkAnsi = `\x1b[38;2;${darkRgb[0]};${darkRgb[1]};${darkRgb[2]}m`;
  const hatAnsi = `\x1b[38;2;${hatRgb[0]};${hatRgb[1]};${hatRgb[2]}m`;
  const reset = "\x1b[0m";

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
      } else if (cell === "e" || cell === "m") {
        line += `${darkAnsi}██${reset}`;
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
