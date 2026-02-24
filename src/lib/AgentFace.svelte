<script lang="ts">
  interface Props {
    name: string;
    size: 'sm' | 'lg' | 'xl';
    dna?: string;
    animated?: boolean;
    walking?: boolean;
    talking?: boolean;
    waving?: boolean;
  }

  let { name, size, dna, animated = false, walking = false, talking = false, waving = false }: Props = $props();

  type Pixel = 'f' | 'e' | 's' | 'n' | 'm' | 'd' | 'h' | 'l' | 'k' | 'q' | 'r' | 'a' | '_';
  //  f = face/body color, e = eye (dark), s = squint eye (thin horiz),
  //  n = narrow eye (thin vert), m = mouth (thin dark),
  //  h = hat color (secondary hue), l = thin leg (face color),
  //  k = thin hat (hat color), q = smile corner left, r = smile corner right,
  //  a = arm (thin horiz face color), _ = transparent

  // Face row template (7px wide head centered in 9-col grid)
  const F: Pixel[] = ['_','f','f','f','f','f','f','f','_'];

  // --- Eye variants (1 row each) ---
  const EYES: Pixel[][] = [
    ['_','f','e','f','f','f','e','f','_'],   // normal
    ['_','e','f','f','f','f','f','e','_'],   // wide
    ['_','f','f','e','f','e','f','f','_'],   // close
    ['_','f','e','f','f','f','e','f','_'],   // normal-alt
    ['_','e','e','f','f','f','e','e','_'],   // big
    ['_','f','e','e','f','e','e','f','_'],   // big close
    ['_','f','s','f','f','f','s','f','_'],   // squint
    ['_','s','f','f','f','f','f','s','_'],   // squint wide
    ['_','f','n','f','f','f','n','f','_'],   // narrow
    ['_','n','f','f','f','f','f','n','_'],   // narrow wide
    ['_','f','f','n','f','n','f','f','_'],   // narrow close
  ];

  // --- Mouth variants (2 rows: gap + mouth) ---
  // Uses thin half-block rendering: m=thin dark, q=corner left, r=corner right
  const MOUTHS: Pixel[][][] = [
    [ // smile (default)
      ['_','f','q','f','f','f','r','f','_'],
      ['_','f','f','m','m','m','f','f','_'],
    ],
    [ // smirk left
      ['_','f','q','f','f','f','f','f','_'],
      ['_','f','f','m','m','m','f','f','_'],
    ],
    [ // smirk right
      ['_','f','f','f','f','f','r','f','_'],
      ['_','f','f','m','m','m','f','f','_'],
    ],
    [ // narrow
      ['_','f','f','q','f','r','f','f','_'],
      ['_','f','f','f','m','f','f','f','_'],
    ],
    [ // wide smile
      ['_','q','f','f','f','f','f','r','_'],
      ['_','f','m','m','m','m','m','f','_'],
    ],
    [ // wide smirk left
      ['_','q','f','f','f','f','f','f','_'],
      ['_','f','m','m','m','m','m','f','_'],
    ],
    [ // wide smirk right
      ['_','f','f','f','f','f','f','r','_'],
      ['_','f','m','m','m','m','m','f','_'],
    ],
  ];

  // --- Hat variants (0–3 rows) ---
  const HATS: Pixel[][][] = [
    [], // none
    [ // tophat
      ['_','_','_','h','h','h','_','_','_'],
      ['_','_','_','h','h','h','_','_','_'],
      ['_','h','h','h','h','h','h','h','_'],
    ],
    [ // beanie
      ['_','_','_','h','h','h','_','_','_'],
      ['_','_','h','h','h','h','h','_','_'],
    ],
    [ // crown
      ['_','_','h','_','h','_','h','_','_'],
      ['_','_','h','h','h','h','h','_','_'],
    ],
    [ // cap
      ['_','_','h','h','h','h','h','_','_'],
      ['h','h','h','h','h','h','h','_','_'],
    ],
    [ // horns
      ['_','h','_','_','_','_','_','h','_'],
      ['_','h','h','_','_','_','h','h','_'],
    ],
    [ // mohawk
      ['_','_','_','_','h','_','_','_','_'],
      ['_','_','_','h','h','h','_','_','_'],
    ],
    [ // antenna
      ['_','_','_','_','h','_','_','_','_'],
      ['_','_','_','_','h','_','_','_','_'],
    ],
    [ // halo
      ['_','_','_','h','h','h','_','_','_'],
    ],
    [ // bandage
      ['_','f','f','f','f','f','f','f','_'],
      ['_','h','h','h','h','h','h','h','_'],
    ],
    [ // wide brim
      ['_','_','h','h','h','h','h','_','_'],
      ['h','h','h','h','h','h','h','h','h'],
    ],
    [ // unicorn horn
      ['_','_','_','_','k','_','_','_','_'],
      ['_','_','_','_','h','_','_','_','_'],
      ['_','_','_','h','h','h','_','_','_'],
    ],
    [ // ears
      ['_','h','h','_','_','_','h','h','_'],
    ],
    [ // spikes
      ['_','h','_','h','_','h','_','h','_'],
      ['_','h','h','h','h','h','h','h','_'],
    ],
    [ // party hat
      ['_','_','_','_','h','_','_','_','_'],
      ['_','_','_','h','h','h','_','_','_'],
      ['_','_','h','h','h','h','h','_','_'],
    ],
    [ // flat top
      ['_','h','h','h','h','h','h','h','_'],
      ['_','h','h','h','h','h','h','h','_'],
    ],
    [ // afro
      ['_','_','k','h','h','h','k','_','_'],
      ['_','k','h','h','h','h','h','k','_'],
    ],
    [ // spiky thin
      ['_','k','_','k','_','k','_','k','_'],
      ['_','h','h','h','h','h','h','h','_'],
    ],
    [ // side sweep
      ['_','_','_','_','h','h','h','k','_'],
      ['_','h','h','h','h','h','h','h','_'],
    ],
    [ // tiara
      ['_','_','_','h','_','h','_','_','_'],
      ['_','f','h','h','h','h','h','f','_'],
    ],
    [ // cowboy hat
      ['_','_','h','h','h','h','h','_','_'],
      ['_','_','h','h','h','h','h','_','_'],
      ['h','h','h','h','h','h','h','h','h'],
    ],
    [ // knitted hat
      ['_','_','_','h','h','h','_','_','_'],
      ['_','_','h','h','h','h','h','_','_'],
      ['_','h','f','h','f','h','f','h','_'],
    ],
    [ // clown hair
      ['h','h','_','_','_','_','_','h','h'],
      ['h','h','h','_','_','_','h','h','h'],
    ],
    [ // stovepipe
      ['_','h','h','h','h','h','h','h','_'],
      ['_','h','h','h','h','h','h','h','_'],
      ['_','h','h','h','h','h','h','h','_'],
      ['_','d','d','d','d','d','d','d','_'],
      ['h','h','h','h','h','h','h','h','h'],
    ],
  ];

  // --- Body variants (static, no animation frames) ---
  const BODIES: Pixel[][][] = [
    [ // normal
      ['_','f','f','f','f','f','f','f','_'],
      ['_','f','f','f','f','f','f','f','_'],
    ],
    [ // normal-arms
      ['a','f','f','f','f','f','f','f','a'],
      ['_','f','f','f','f','f','f','f','_'],
    ],
    [ // narrow
      ['_','_','f','f','f','f','f','_','_'],
      ['_','_','f','f','f','f','f','_','_'],
    ],
    [ // narrow-arms
      ['_','a','f','f','f','f','f','a','_'],
      ['_','_','f','f','f','f','f','_','_'],
    ],
    [ // tapered
      ['_','f','f','f','f','f','f','f','_'],
      ['_','_','f','f','f','f','f','_','_'],
    ],
    [ // tapered-arms
      ['a','f','f','f','f','f','f','f','a'],
      ['_','_','f','f','f','f','f','_','_'],
    ],
  ];

  // --- Leg variants (multi-frame for walking animation) ---
  const LEGS: Pixel[][][] = [
    [ // biped
      ['_','_','f','_','_','f','_','_','_'],
      ['_','f','_','_','_','_','f','_','_'],
    ],
    [ // quad (thin, alternating pairs)
      ['_','l','_','_','_','_','_','l','_'],
      ['_','_','_','l','_','l','_','_','_'],
    ],
    [ // tentacles (thin, cycle visibility)
      ['_','l','_','l','_','l','_','l','_'],
      ['_','_','l','_','l','_','l','_','_'],
      ['_','l','_','l','_','l','_','_','_'],
    ],
    [ // thin biped
      ['_','_','l','_','_','_','l','_','_'],
      ['_','_','_','l','_','l','_','_','_'],
    ],
    [ // wide stance
      ['_','f','_','_','_','_','_','f','_'],
      ['_','_','f','_','_','_','f','_','_'],
    ],
    [ // thin narrow
      ['_','_','_','l','_','l','_','_','_'],
      ['_','_','l','_','_','_','l','_','_'],
    ],
  ];

  interface DecodedDNA {
    eyes: number;
    mouth: number;
    hat: number;
    body: number;
    legs: number;
    faceHue: number;
    hatHue: number;
  }

  // Fixed slot sizes — must match avatar.ts SLOTS
  // 12 * 12 * 24 * 8 * 8 * 12 * 12 = 15,925,248 (~16M, 6 hex chars)
  const SLOTS = { eyes: 12, mouths: 12, hats: 24, bodies: 8, legs: 8, hues: 12 };

  function decodeDNAString(hex: string): DecodedDNA {
    let n = parseInt(hex, 16);
    const hatHue = n % SLOTS.hues; n = Math.floor(n / SLOTS.hues);
    const faceHue = n % SLOTS.hues; n = Math.floor(n / SLOTS.hues);
    const legs = n % SLOTS.legs; n = Math.floor(n / SLOTS.legs);
    const body = n % SLOTS.bodies; n = Math.floor(n / SLOTS.bodies);
    const hat = n % SLOTS.hats; n = Math.floor(n / SLOTS.hats);
    const mouth = n % SLOTS.mouths; n = Math.floor(n / SLOTS.mouths);
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

  function hashName(n: string): number {
    let hash = 0;
    for (let i = 0; i < n.length; i++) {
      hash = n.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  }

  // Wave animation frames (override body when waving)
  const WAVE_FRAMES: Pixel[][][] = [
    [['a','f','f','f','f','f','f','f','_'],['_','f','f','f','f','f','f','f','a']],  // left up, right down
    [['_','f','f','f','f','f','f','f','a'],['a','f','f','f','f','f','f','f','_']],  // left down, right up
  ];

  // Talk animation frames (universal, override mouth when talking)
  const TALK_FRAMES: Pixel[][][] = [
    [['_','f','f','f','f','f','f','f','_'],['_','f','f','d','d','d','f','f','_']],  // open
  ];

  function generateAvatar(traits: DecodedDNA, frame = 0, talkFrame = 0, waveFrame = 0): Pixel[][] {
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

  function traitsFromHash(h: number): DecodedDNA {
    return {
      eyes:    h % EYES.length,
      mouth:   (h >>> 4) % MOUTHS.length,
      hat:     (h >>> 8) % HATS.length,
      body:    (h >>> 14) % BODIES.length,
      legs:    (h >>> 18) % LEGS.length,
      faceHue: (h >>> 22) % 12,
      hatHue:  (h >>> 26) % 12,
    };
  }

  let walkFrame = $state(0);
  let talkFrame = $state(0);
  let waveFrame = $state(0);

  $effect(() => {
    if (!walking) { walkFrame = 0; return; }
    const id = setInterval(() => { walkFrame = (walkFrame + 1) % 6; }, 400);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (!talking) { talkFrame = 0; return; }
    let timeout: ReturnType<typeof setTimeout>;
    function tick() {
      talkFrame = (talkFrame + 1) % 2;
      timeout = setTimeout(tick, 100 + Math.random() * 200);
    }
    timeout = setTimeout(tick, 100 + Math.random() * 200);
    return () => clearTimeout(timeout);
  });

  $effect(() => {
    if (!waving) { waveFrame = 0; return; }
    waveFrame = 1;
    const id = setInterval(() => { waveFrame = waveFrame === 1 ? 2 : 1; }, 600);
    return () => clearInterval(id);
  });

  const traits = $derived(
    dna ? decodeDNAString(dna) : traitsFromHash(hashName(name))
  );
  const grid   = $derived(generateAvatar(traits, walkFrame, talkFrame, waveFrame));
  const rows   = $derived(grid.length);

  const hue       = $derived(traits.faceHue * 30);
  const hatHueDeg = $derived(traits.hatHue * 30);
  const faceColor = $derived(`hsl(${hue}, 50%, 50%)`);
  const darkColor = $derived(`hsl(${hue}, 50%, 28%)`);
  const hatColor  = $derived(`hsl(${hatHueDeg}, 50%, 50%)`);

  const xlPx = 14;
  const lgPx = 8;
  const smPx = 3;
  const smScale = $derived(27 / Math.max(9 * smPx, rows * smPx));
  const pxSize = $derived(size === 'xl' ? xlPx : size === 'sm' ? smPx : lgPx);
  const idleDelay = Math.random() * 3;

  function pixelColor(type: Pixel): string {
    if (type === 'e' || type === 'd') return darkColor;
    if (type === 'f' || type === 'q' || type === 'r') return faceColor;
    if (type === 'h' || type === 'k') return hatColor;
    if (type === 'm' || type === 's' || type === 'n') return faceColor; // bg is face, dark part via CSS
    if (type === 'l' || type === 'a') return 'transparent'; // drawn via CSS pseudo-element
    return 'transparent';
  }
</script>

<div
  class="avatar"
  class:sm={size === 'sm'}
>
  <div
    class="grid"
    class:idle={!walking && !talking}
    style:--px="{pxSize}px"
    style:--idle-delay="{idleDelay}s"
    style:transform={size === 'sm' && smScale < 1 ? `scale(${smScale})` : undefined}
  >
    {#each grid as row}
      {#each row as cell}
        <span
          class="px"
          class:squint-eye={cell === 's'}
          class:narrow-eye={cell === 'n'}
          class:mouth={cell === 'm'}
          class:corner-l={cell === 'q'}
          class:corner-r={cell === 'r'}
          class:thin-leg={cell === 'l'}
          class:thin-arm={cell === 'a'}
          style:background={pixelColor(cell)}
          style:--dark={cell === 'm' || cell === 'q' || cell === 'r' || cell === 's' || cell === 'n' ? darkColor : undefined}
          style:--face={cell === 'l' || cell === 'a' ? faceColor : undefined}
        ></span>
      {/each}
    {/each}
  </div>
</div>

<style>
  .avatar.sm {
    width: 27px;
    height: 27px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(9, var(--px));
    grid-auto-rows: var(--px);
    user-select: none;
    transform-origin: center;
  }

  .px {
    width: var(--px);
    height: var(--px);
    display: block;
  }

  /* Slightly oversized pixels in sm mode to fill sub-pixel gaps from scaling */
  .avatar.sm .px {
    width: calc(var(--px) + 1px);
    height: calc(var(--px) + 1px);
  }

  /* Squint eye: dark bottom half */
  .squint-eye {
    position: relative;
    overflow: hidden;
  }
  .squint-eye::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 50%;
    background: var(--dark);
  }

  /* Narrow eye: dark center vertical strip */
  .narrow-eye {
    position: relative;
    overflow: hidden;
  }
  .narrow-eye::after {
    content: '';
    position: absolute;
    top: 0;
    left: 25%;
    width: 50%;
    height: 100%;
    background: var(--dark);
  }

  /* Thin mouth: dark top half */
  .mouth {
    position: relative;
    overflow: hidden;
  }
  .mouth::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 50%;
    background: var(--dark);
  }

  /* Smile corner left (▗): dark bottom-right quarter */
  .corner-l {
    position: relative;
    overflow: hidden;
  }
  .corner-l::after {
    content: '';
    position: absolute;
    bottom: 0;
    right: 0;
    width: 50%;
    height: 50%;
    background: var(--dark);
  }

  /* Smile corner right (▖): dark bottom-left quarter */
  .corner-r {
    position: relative;
    overflow: hidden;
  }
  .corner-r::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 50%;
    height: 50%;
    background: var(--dark);
  }

  /* Thin arm: face color bottom half only (▄) */
  .thin-arm {
    position: relative;
    overflow: hidden;
  }
  .thin-arm::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 50%;
    background: var(--face);
  }

  /* Thin leg: face color left half only (▌) */
  .thin-leg {
    position: relative;
    overflow: hidden;
  }
  .thin-leg::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 50%;
    height: 100%;
    background: var(--face);
  }

  @keyframes idle-bob {
    0%, 30%, 100% { transform: translateY(0); }
    35%, 65% { transform: translateY(1px); }
  }

  .grid.idle > :not(:nth-last-child(-n+9)) {
    animation: idle-bob 3s steps(1) infinite;
    animation-delay: var(--idle-delay, 0s);
  }
</style>
