# termlings

Pixel-art avatar system for [touchgrass.sh](https://touchgrass.sh). Each avatar is encoded as a **7-character hex DNA string** (~32M combinations) that deterministically renders a unique character with hat, eyes, mouth, body, legs, and two independent color hues.

## Install

```bash
npm install termlings
# or
bun add termlings
```

## Usage

### Core (framework-agnostic)

```ts
import {
  generateRandomDNA,
  decodeDNA,
  encodeDNA,
  generateGrid,
  traitsFromName,
  renderSVG,
  renderTerminal,
  renderTerminalSmall,
  hslToRgb,
  SLOTS,
  EYES, MOUTHS, HATS, BODIES, LEGS,
} from 'termlings';
```

#### Generate a random avatar

```ts
const dna = generateRandomDNA(); // e.g. "0a3f201"
```

#### Decode / encode DNA

```ts
const traits = decodeDNA('0a3f201');
// { eyes: 0, mouth: 2, hat: 5, body: 1, legs: 3, faceHue: 8, hatHue: 2 }

const dna = encodeDNA(traits); // "0a3f201"
```

#### Derive avatar from a name (no DNA needed)

```ts
const traits = traitsFromName('my-agent');
// Deterministic — same name always produces same traits
```

#### Render to SVG string

```ts
const svg = renderSVG('0a3f201');           // default 10px per pixel
const svg = renderSVG('0a3f201', 20);       // 20px per pixel
const svg = renderSVG('0a3f201', 10, 1);    // walking frame 1
```

Returns a complete `<svg>` string with transparent background. Use it as `innerHTML`, write to a `.svg` file, or embed in an `<img>` via data URI.

#### Render to terminal (ANSI)

```ts
const ansi = renderTerminal('0a3f201');      // full size (██ per pixel)
const ansi = renderTerminalSmall('0a3f201'); // compact (half-block ▀▄)

console.log(ansi);
```

#### Generate the pixel grid directly

```ts
const grid = generateGrid(traits, walkFrame, talkFrame, waveFrame);
// Pixel[][] — 9 columns wide, variable rows tall
```

### Svelte

```svelte
<script>
  import { Avatar } from 'termlings/svelte';
</script>

<!-- From DNA string -->
<Avatar dna="0a3f201" />

<!-- From name (deterministic hash) -->
<Avatar name="my-agent" />

<!-- Sizes: sm (3px), lg (8px, default), xl (14px) -->
<Avatar dna="0a3f201" size="xl" />

<!-- Animations -->
<Avatar dna="0a3f201" walking />
<Avatar dna="0a3f201" talking />
<Avatar dna="0a3f201" waving />
```

Props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `dna` | `string` | — | 7-char hex DNA string |
| `name` | `string` | — | Fallback: derive traits from name hash |
| `size` | `'sm' \| 'lg' \| 'xl'` | `'lg'` | Pixel size (3/8/14px per cell) |
| `walking` | `boolean` | `false` | Animate legs |
| `talking` | `boolean` | `false` | Animate mouth |
| `waving` | `boolean` | `false` | Animate arms |

Either `dna` or `name` should be provided. If both are set, `dna` takes priority.

## DNA Encoding

7 traits packed into a single integer using mixed-radix encoding with **fixed slot sizes** for forward compatibility:

| Trait | Variants | Slot size | Description |
|-------|----------|-----------|-------------|
| eyes | 11 | 12 | normal, wide, close, big, squint, narrow, etc. |
| mouths | 7 | 12 | smile, smirk, narrow, wide variants |
| hats | 24 | 24 | none, tophat, beanie, crown, cap, horns, mohawk, etc. |
| bodies | 6 | 8 | normal, narrow, tapered (each with/without arms) |
| legs | 6 | 8 | biped, quad, tentacles, thin, wide stance |
| faceHue | 12 | 12 | 0-330 degrees in 30-degree steps |
| hatHue | 12 | 12 | independent from face hue |

Total slot space: `12 x 12 x 24 x 8 x 8 x 12 x 12 = 31,850,496` (~32M, 7 hex chars).

New variants can be added within slot limits without breaking existing DNA strings. Legacy 6-char DNAs decode identically (leading zero is implicit).

## Pixel Grid

The avatar is a 9-column grid with variable height (depends on hat). Each cell is a `Pixel` type:

| Pixel | Meaning | Rendering |
|-------|---------|-----------|
| `f` | Face/body | Solid face color |
| `e` | Eye | Solid dark color |
| `s` | Squint eye | Face bg + dark bottom half |
| `n` | Narrow eye | Face bg + dark center strip |
| `m` | Mouth | Face bg + dark top half |
| `q` | Smile corner left | Face bg + dark bottom-right quarter |
| `r` | Smile corner right | Face bg + dark bottom-left quarter |
| `d` | Dark accent | Solid dark (hat bands, etc.) |
| `h` | Hat | Solid hat color |
| `l` | Thin leg | Half-width face color |
| `k` | Thin hat detail | Half-width hat color |
| `a` | Arm | Half-height face color |
| `_` | Transparent | Empty |

## Colors

Each avatar has 3 colors derived from two hue indices (0-11, mapped to 0-330 degrees):

- **Face color**: `hsl(faceHue * 30, 50%, 50%)`
- **Dark color**: `hsl(faceHue * 30, 50%, 28%)` — eyes, mouth
- **Hat color**: `hsl(hatHue * 30, 50%, 50%)`

## Animations

The grid generator supports three animation types via frame parameters:

- **Walking** (`frame`): Cycles through leg variant frames
- **Talking** (`talkFrame`): 0 = normal mouth, 1+ = open mouth animation
- **Waving** (`waveFrame`): 0 = normal body, 1+ = alternating arm positions

## Exports

```
termlings          — Core TypeScript (DNA, grid, SVG, terminal, colors)
termlings/svelte   — Svelte 5 component (Avatar)
```

## License

MIT
