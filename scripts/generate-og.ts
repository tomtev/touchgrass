/**
 * Generate OG image for touchgrass.sh website
 * Replicates the website's ASCII art landscape: sky, sun, clouds, grass
 *
 * Usage: bun run scripts/generate-og.ts
 */
import { renderSVG } from 'termlings';
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';
import { join } from 'path';

const WIDTH = 2400;
const HEIGHT = 1260;

// Same character as the website hero
const AVATAR_DNA = '0a3f201';

// Grid dimensions (matches website's monospace char approach)
const FONT_SIZE = 16;
const CHAR_W = FONT_SIZE * 0.602; // Menlo advance width ratio
const LINE_H = FONT_SIZE * 1.2;
const COLS = Math.ceil(WIDTH / CHAR_W) + 2;
const ROWS = Math.ceil(HEIGHT / LINE_H) + 2;

// Character palettes (same as GrassHero.svelte)
const SKY_CHARS = [' ', ' ', ' ', '.', "'", ':'];
const CLOUD_CHARS = ['.', 'o', '~'];
const GRASS_CHARS = ["'", ',', ';', ':', '.', '^'];

// Deterministic PRNG
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(98765);
const pick = (arr: string[]) => arr[Math.floor(rand() * arr.length)];

// ── Sky grid ──
function buildSkyGrid(): string[][] {
  const grid: string[][] = [];
  const horizon = Math.floor(ROWS * 0.63);

  for (let r = 0; r < ROWS; r++) {
    const row: string[] = [];
    for (let c = 0; c < COLS; c++) {
      if (r < horizon) {
        const density = 0.03 + (r / Math.max(1, horizon)) * 0.02;
        row.push(rand() < density ? pick(SKY_CHARS) : ' ');
      } else {
        const density = 0.06 + ((r - horizon) / Math.max(1, ROWS - horizon)) * 0.08;
        row.push(rand() < density ? pick(['.', ':', '\u00b7']) : ' ');
      }
    }
    grid.push(row);
  }

  // Twinkling stars in upper portion
  const maxRow = Math.max(1, Math.floor(ROWS * 0.45));
  const starCount = Math.max(8, Math.floor(COLS * 0.035));
  for (let i = 0; i < starCount; i++) {
    const r = Math.floor(rand() * maxRow);
    const c = Math.floor(rand() * COLS);
    grid[r][c] = pick(['*', '+', '*']);
  }

  return grid;
}

// ── Sun grid ──
function buildSunGrid(): string[][] {
  const grid: string[][] = Array.from({ length: ROWS }, () =>
    new Array(COLS).fill(' ')
  );

  const cx = Math.floor(COLS * 0.79);
  const cy = Math.floor(ROWS * 0.2);
  const radius = Math.max(3, Math.floor(Math.min(COLS, ROWS) * 0.065));

  for (let r = cy - radius - 2; r <= cy + radius + 2; r++) {
    for (let c = cx - radius - 4; c <= cx + radius + 4; c++) {
      if (r < 0 || c < 0 || r >= ROWS || c >= COLS) continue;
      const dx = c - cx;
      const dy = (r - cy) * 1.25;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius * 0.45) grid[r][c] = '@';
      else if (d < radius * 0.8) grid[r][c] = 'O';
      else if (d < radius * 1.05) grid[r][c] = 'o';
      else if (d < radius * 1.4 && rand() < 0.35) grid[r][c] = '.';
    }
  }

  return grid;
}

// ── Cloud grid (static frame) ──
function buildCloudGrid(frame: number): string[][] {
  const grid: string[][] = Array.from({ length: ROWS }, () =>
    new Array(COLS).fill(' ')
  );

  const bands = [
    { y: 0.12, phase: 0.5, speed: 0.65, threshold: 1.05 },
    { y: 0.2, phase: 1.2, speed: 0.52, threshold: 1.0 },
    { y: 0.3, phase: 2.1, speed: 0.44, threshold: 1.12 },
  ];

  for (const band of bands) {
    const center = Math.floor(ROWS * band.y);
    for (let c = 0; c < COLS; c++) {
      const shift = frame * band.speed;
      const wave =
        Math.sin((c + shift) / 6 + band.phase) +
        Math.sin((c + shift) / 13 + band.phase * 1.7);
      if (wave <= band.threshold) continue;

      for (let dy = -1; dy <= 1; dy++) {
        const r = center + dy;
        if (r < 0 || r >= ROWS) continue;
        if (rand() < (dy === 0 ? 0.82 : 0.4)) {
          grid[r][c] = dy === 0 ? pick(CLOUD_CHARS) : '.';
        }
      }
    }
  }

  return grid;
}

// ── Grass grid ──
function buildGrassGrid(): string[][] {
  const grid: string[][] = Array.from({ length: ROWS }, () =>
    new Array(COLS).fill(' ')
  );

  // Only fill bottom portion (matches hero-grass-fixed at bottom 42vh → ~40% of image)
  const grassStartRow = Math.floor(ROWS * 0.58);

  for (let r = grassStartRow; r < ROWS; r++) {
    const grassRows = ROWS - grassStartRow;
    const y = (r - grassStartRow) / Math.max(1, grassRows - 1);

    for (let c = 0; c < COLS; c++) {
      if (y < 0.15) {
        grid[r][c] = rand() < 0.08 ? pick(['.', ':']) : ' ';
      } else if (y < 0.3) {
        grid[r][c] = rand() < 0.18 ? pick(['.', ':', ';']) : ' ';
      } else if (y < 0.5) {
        grid[r][c] = rand() < 0.35 ? pick(['.', ':', ';', "'", ',']) : ' ';
      } else {
        grid[r][c] = rand() < 0.7 ? pick(GRASS_CHARS) : ' ';
      }
    }
  }

  return grid;
}

// ── Render a character grid as SVG text ──
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gridToSvgText(
  grid: string[][],
  fill: string,
  opacity: number,
  filterId?: string
): string {
  const tspans: string[] = [];
  for (let r = 0; r < grid.length; r++) {
    const line = grid[r].join('');
    // Skip entirely empty rows for performance
    if (line.trim() === '') continue;
    const y = LINE_H * (r + 1);
    tspans.push(`<tspan x="0" y="${y.toFixed(1)}">${escapeXml(line)}</tspan>`);
  }

  let attrs = `font-family="Menlo, monospace" font-size="${FONT_SIZE}" fill="${fill}" opacity="${opacity}" xml:space="preserve"`;
  if (filterId) attrs += ` filter="url(#${filterId})"`;

  return `<text ${attrs}>${tspans.join('')}</text>`;
}

function buildSvg(): string {
  const defs: string[] = [];
  const layers: string[] = [];

  // ── Glow filters (mimic text-shadow from CSS) ──
  defs.push(`
    <filter id="sun-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="1 0 0 0 0.2  0 1 0 0 0.15  0 0 1 0 0  0 0 0 0.5 0" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="grass-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="0 0 0 0 0.06  0 0 0 0 0.73  0 0 0 0 0.51  0 0 0 0.35 0" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  `);

  // ── Background ──
  layers.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#04090a"/>`);

  // ── Sky layer ── (website color: rgba(104, 182, 255, 0.58))
  const skyGrid = buildSkyGrid();
  layers.push(gridToSvgText(skyGrid, 'rgb(104, 182, 255)', 0.58));

  // ── Sun layer ── (website color: rgba(255, 225, 122, 0.9))
  const sunGrid = buildSunGrid();
  layers.push(gridToSvgText(sunGrid, 'rgb(255, 225, 122)', 0.9, 'sun-glow'));

  // ── Cloud layer ── (website color: rgba(255, 210, 156, 0.62))
  const cloudGrid = buildCloudGrid(8); // frozen at frame 8 for a nice cloud position
  layers.push(gridToSvgText(cloudGrid, 'rgb(255, 210, 156)', 0.62));

  // ── Grass layer ── (website color: rgba(14, 209, 149, 0.78))
  const grassGrid = buildGrassGrid();
  layers.push(gridToSvgText(grassGrid, 'rgb(14, 209, 149)', 0.78, 'grass-glow'));

  // ── Avatar (centered, sitting on the grass) ──
  const pixelSize = 36;
  const avatarSvg = renderSVG(AVATAR_DNA, pixelSize, 0, null);
  const wMatch = avatarSvg.match(/width="(\d+)"/);
  const hMatch = avatarSvg.match(/height="(\d+)"/);
  const avW = wMatch ? parseInt(wMatch[1]) : 9 * pixelSize;
  const avH = hMatch ? parseInt(hMatch[1]) : 12 * pixelSize;

  const avX = (WIDTH - avW) / 2;
  const avY = HEIGHT * 0.14;

  const innerContent = avatarSvg
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  layers.push(
    `<svg x="${avX}" y="${avY}" width="${avW}" height="${avH}" viewBox="0 0 ${avW} ${avH}">${innerContent}</svg>`
  );

  // ── Title: "touchgrass.sh" ──
  const titleY = avY + avH + 66;
  layers.push(`
    <text x="${WIDTH / 2}" y="${titleY}"
          font-family="Menlo, monospace"
          font-size="120" font-weight="700"
          fill="#ecfdf5" text-anchor="middle"
          letter-spacing="-1">touchgrass.sh</text>
  `);

  // ── Subtitle ──
  const subtitleY = titleY + 58;
  layers.push(`
    <text x="${WIDTH / 2}" y="${subtitleY}"
          font-family="Menlo, monospace"
          font-size="34"
          fill="#94a3b8" text-anchor="middle">Manage AI agents from your phone.</text>
  `);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>${defs.join('\n')}</defs>
  ${layers.join('\n')}
</svg>`;
}

const svg = buildSvg();

// Write SVG for inspection
const svgPath = join(import.meta.dir, '..', 'packages', 'web', 'static', 'touchgrass-og.svg');
writeFileSync(svgPath, svg);
console.log(`SVG written to ${svgPath}`);

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: WIDTH },
  font: {
    loadSystemFonts: true,
    defaultFontFamily: 'Menlo',
  },
});

const pngData = resvg.render();
const pngBuffer = pngData.asPng();

const outPath = join(
  import.meta.dir,
  '..',
  'packages',
  'web',
  'static',
  'touchgrass-og.png'
);
writeFileSync(outPath, pngBuffer);
console.log(
  `PNG written to ${outPath} (${(pngBuffer.length / 1024).toFixed(0)} KB, ${pngData.width}x${pngData.height})`
);
