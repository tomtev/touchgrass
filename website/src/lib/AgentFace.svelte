<script>
  import { onMount } from 'svelte';

  let { dna, size = 'lg', walking = false } = $props();

  // Pixel types: f=face, e=eye(dark), m=mouth(dark), h=hat, l=thin leg, k=thin hat, _=transparent
  const F = ['_','f','f','f','f','f','f','f','_'];

  const EYES = [
    ['_','f','e','f','f','f','e','f','_'],
    ['_','e','f','f','f','f','f','e','_'],
    ['_','f','f','e','f','e','f','f','_'],
    ['_','f','e','f','f','f','e','f','_'],
    ['_','e','e','f','f','f','e','e','_'],
    ['_','f','e','e','f','e','e','f','_'],
  ];

  const MOUTHS = [
    [['_','f','f','f','f','f','f','f','_'],['_','f','f','m','m','m','f','f','_']],
    [['_','f','f','f','f','f','f','f','_'],['_','f','f','m','m','m','f','f','_']],
    [['_','f','f','f','f','f','f','f','_'],['_','f','f','f','m','m','f','f','_']],
    [['_','f','f','f','f','f','f','f','_'],['_','f','f','f','m','m','m','f','_']],
    [['_','f','f','f','f','f','f','f','_'],['_','f','m','m','m','m','m','f','_']],
    [['_','f','f','f','f','f','f','f','_'],['_','f','f','f','m','f','f','f','_']],
  ];

  const HATS = [
    [],
    [['_','_','_','h','h','h','_','_','_'],['_','_','_','h','h','h','_','_','_'],['_','h','h','h','h','h','h','h','_']],
    [['_','_','_','h','h','h','_','_','_'],['_','_','h','h','h','h','h','_','_']],
    [['_','_','h','_','h','_','h','_','_'],['_','_','h','h','h','h','h','_','_']],
    [['_','_','h','h','h','h','h','_','_'],['h','h','h','h','h','h','h','_','_']],
    [['_','h','_','_','_','_','_','h','_'],['_','h','h','_','_','_','h','h','_']],
    [['_','_','_','_','h','_','_','_','_'],['_','_','_','h','h','h','_','_','_']],
    [['_','_','_','_','h','_','_','_','_'],['_','_','_','_','h','_','_','_','_']],
    [['_','_','_','h','h','h','_','_','_']],
    [['_','f','f','f','f','f','f','f','_'],['_','h','h','h','h','h','h','h','_']],
    [['_','_','h','h','h','h','h','_','_'],['h','h','h','h','h','h','h','h','h']],
    [['_','_','_','_','h','_','_','_','_'],['_','_','_','_','h','_','_','_','_'],['_','_','_','_','h','_','_','_','_']],
    [['_','h','h','_','_','_','h','h','_']],
    [['_','h','_','h','_','h','_','h','_'],['_','h','h','h','h','h','h','h','_']],
    [['_','_','_','_','h','_','_','_','_'],['_','_','_','h','h','h','_','_','_'],['_','_','h','h','h','h','h','_','_']],
    [['_','h','h','h','h','h','h','h','_'],['_','h','h','h','h','h','h','h','_']],
    [['_','_','k','h','h','h','k','_','_'],['_','k','h','h','h','h','h','k','_']],
    [['_','k','_','k','_','k','_','k','_'],['_','h','h','h','h','h','h','h','_']],
    [['_','_','_','_','h','h','h','k','_'],['_','h','h','h','h','h','h','h','_']],
    [['_','_','_','h','_','h','_','_','_'],['_','f','h','h','h','h','h','f','_']],
    [['_','_','h','h','h','h','h','_','_'],['_','_','h','h','h','h','h','_','_'],['h','h','h','h','h','h','h','h','h']],
    [['_','_','_','h','h','h','_','_','_'],['_','_','h','h','h','h','h','_','_'],['_','h','f','h','f','h','f','h','_']],
    [['h','h','_','_','_','_','_','h','h'],['h','h','h','_','_','_','h','h','h']],
    [['_','h','h','h','h','h','h','h','_'],['_','h','h','h','h','h','h','h','_'],['_','h','h','h','h','h','h','h','_'],['_','m','m','m','m','m','m','m','_'],['h','h','h','h','h','h','h','h','h']],
  ];

  const BODIES = [
    [['_','f','f','f','f','f','f','f','_'],['_','f','f','f','f','f','f','f','_']],
    [['_','f','f','f','f','f','f','f','_'],['f','f','f','f','f','f','f','f','f']],
    [['f','f','f','f','f','f','f','f','f'],['_','f','f','f','f','f','f','f','_']],
    [['f','f','f','f','f','f','f','f','f'],['_','_','f','f','f','f','f','_','_']],
    [['_','_','f','f','f','f','f','_','_'],['_','f','f','f','f','f','f','f','_']],
    [['_','_','f','f','f','f','f','_','_'],['_','_','f','f','f','f','f','_','_']],
    [['_','f','f','f','f','f','f','f','_'],['_','_','f','f','f','f','f','_','_']],
  ];

  const LEGS = [
    [['_','_','f','_','_','f','_','_','_'],['_','f','_','_','_','_','f','_','_']],
    [['_','f','_','f','_','f','_','f','_'],['_','f','f','_','_','_','f','f','_']],
    [['_','_','f','_','f','_','f','_','_'],['_','f','_','f','_','f','_','_','_']],
    [['_','f','f','f','_','f','f','f','_'],['f','f','_','f','_','f','_','f','f']],
    [['_','_','f','f','_','f','f','_','_'],['_','f','f','_','_','_','f','f','_']],
    [['_','f','_','_','f','_','_','f','_'],['f','_','_','f','_','f','_','_','_']],
    [['_','f','_','_','_','_','_','f','_'],['_','_','f','_','_','_','f','_','_']],
    [['_','l','l','_','_','_','l','l','_'],['_','l','_','l','_','l','_','l','_']],
  ];

  const SLOTS = { eyes: 12, mouths: 12, hats: 24, bodies: 8, legs: 8, hues: 12 };

  function decodeDNA(hex) {
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

  function generateAvatar(traits, frame = 0) {
    const legFrames = LEGS[traits.legs];
    const legRow = legFrames[frame % legFrames.length];
    return [
      ...HATS[traits.hat],
      F,
      EYES[traits.eyes],
      ...MOUTHS[traits.mouth],
      ...BODIES[traits.body],
      legRow,
    ];
  }

  let walkFrame = $state(0);

  $effect(() => {
    if (!walking) { walkFrame = 0; return; }
    const id = setInterval(() => { walkFrame = (walkFrame + 1) % 2; }, 400);
    return () => clearInterval(id);
  });

  const traits = $derived(decodeDNA(dna));
  const grid   = $derived(generateAvatar(traits, walkFrame));
  const rows   = $derived(grid.length);

  const hue       = $derived(traits.faceHue * 30);
  const hatHueDeg = $derived(traits.hatHue * 30);
  const faceColor = $derived(`hsl(${hue}, 50%, 50%)`);
  const darkColor = $derived(`hsl(${hue}, 50%, 28%)`);
  const hatColor  = $derived(`hsl(${hatHueDeg}, 50%, 50%)`);

  const pxSize = $derived(size === 'xl' ? 14 : size === 'sm' ? 5 : 8);
  const idleDelay = Math.random() * 3;

  let faceEl = $state();
  let eyeOffsetX = $state(0);
  let eyeOffsetY = $state(0);
  const maxOffset = $derived(size === 'sm' ? 1 : size === 'xl' ? 3 : 2);

  function handleMouseMove(e) {
    if (!faceEl) return;
    const rect = faceEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (window.innerWidth / 2);
    const dy = (e.clientY - cy) / (window.innerHeight / 2);
    eyeOffsetX = Math.max(-1, Math.min(1, dx)) * maxOffset;
    eyeOffsetY = Math.max(-1, Math.min(1, dy)) * maxOffset;
  }

  function pixelColor(type) {
    if (type === 'e' || type === 'm') return darkColor;
    if (type === 'f' || type === 'l') return faceColor;
    if (type === 'h' || type === 'k') return hatColor;
    return 'transparent';
  }
</script>

<svelte:window onmousemove={handleMouseMove} />

<div class="avatar" bind:this={faceEl}>
  <div class="grid" class:idle={!walking} style:--px="{pxSize}px" style:--idle-delay="{idleDelay}s">
    {#each grid as row}
      {#each row as cell}
        <span
          class="px"
          class:eye={cell === 'e'}
          style:background={pixelColor(cell)}
          style:transform={cell === 'e' ? `translate(${eyeOffsetX}px, ${eyeOffsetY}px)` : undefined}
        ></span>
      {/each}
    {/each}
  </div>
</div>

<style>
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(9, var(--px));
    grid-auto-rows: var(--px);
    user-select: none;
  }

  .px {
    width: var(--px);
    height: var(--px);
    display: block;
  }

  .eye {
    transition: transform 0.15s ease-out;
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
